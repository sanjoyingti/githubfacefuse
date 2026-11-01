#!/usr/bin/env bash
# Personal WireGuard VPN server, tuned for speed.
# Tested target: Ubuntu 22.04 / 24.04 on Oracle Cloud "Always Free" VMs.
#
# Usage (run as root):
#   bash install.sh              # first install + creates client "phone"
#   bash install.sh add laptop   # add another device
#   bash install.sh show phone   # show QR code again for a device
#   bash install.sh remove laptop
#
# Optional env vars: WG_PORT (default 51820), WG_DNS (default 1.1.1.1, 1.0.0.1),
#                    WG_MTU (client MTU, default 1360)
set -euo pipefail

WG_IF=wg0
WG_DIR=/etc/wireguard
CLIENT_DIR=$WG_DIR/clients
WG_PORT=${WG_PORT:-51820}
WG_DNS=${WG_DNS:-"1.1.1.1, 1.0.0.1"}
WG_MTU=${WG_MTU:-1360}
SUBNET_PREFIX=10.66.66

die() { echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Run with sudo:  sudo bash install.sh"

public_ip() {
  local ip=""
  for url in https://api.ipify.org https://ifconfig.me https://icanhazip.com; do
    ip=$(curl -4 -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]') && [ -n "$ip" ] && break
  done
  [ -n "$ip" ] || die "Could not detect public IP. Re-run with:  WG_ENDPOINT=<your.ip> bash install.sh"
  echo "$ip"
}

install_server() {
  echo "==> Installing packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y wireguard wireguard-tools qrencode iptables curl

  echo "==> Speed tuning (BBR, big buffers, IP forwarding)"
  cat > /etc/sysctl.d/99-vpn-speed.conf <<'EOF'
net.ipv4.ip_forward = 1
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_fastopen = 3
EOF
  sysctl --system >/dev/null

  local nic
  nic=$(ip -4 route show default | awk '{print $5; exit}')
  [ -n "$nic" ] || die "No default network interface found"

  umask 077
  mkdir -p "$CLIENT_DIR"
  wg genkey | tee $WG_DIR/server.key | wg pubkey > $WG_DIR/server.pub
  echo "${WG_ENDPOINT:-$(public_ip)}" > $WG_DIR/endpoint
  echo "$WG_PORT" > $WG_DIR/port

  # Oracle Ubuntu images ship iptables rules that REJECT everything except SSH,
  # so insert our ACCEPT rules at the top (-I) on every start.
  cat > $WG_DIR/$WG_IF.conf <<EOF
[Interface]
Address = $SUBNET_PREFIX.1/24
ListenPort = $WG_PORT
PrivateKey = $(cat $WG_DIR/server.key)
MTU = 1420
PostUp = iptables -I INPUT -p udp --dport $WG_PORT -j ACCEPT; iptables -I FORWARD -i %i -j ACCEPT; iptables -I FORWARD -o %i -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -A POSTROUTING -s $SUBNET_PREFIX.0/24 -o $nic -j MASQUERADE; iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostDown = iptables -D INPUT -p udp --dport $WG_PORT -j ACCEPT; iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -m state --state RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -D POSTROUTING -s $SUBNET_PREFIX.0/24 -o $nic -j MASQUERADE; iptables -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
EOF

  systemctl enable --now wg-quick@$WG_IF
  echo "==> WireGuard server running on UDP port $WG_PORT"
}

next_ip() {
  local n
  for n in $(seq 2 254); do
    grep -q "AllowedIPs = $SUBNET_PREFIX.$n/32" $WG_DIR/$WG_IF.conf || { echo "$SUBNET_PREFIX.$n"; return; }
  done
  die "No free addresses left"
}

add_client() {
  local name=$1
  [[ "$name" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || die "Device name: letters, numbers, - or _ only"
  [ ! -f "$CLIENT_DIR/$name.conf" ] || die "Device '$name' already exists (use: show $name)"
  umask 077
  local key pub psk ip
  key=$(wg genkey); pub=$(echo "$key" | wg pubkey); psk=$(wg genpsk); ip=$(next_ip)

  cat >> $WG_DIR/$WG_IF.conf <<EOF

# client: $name
[Peer]
PublicKey = $pub
PresharedKey = $psk
AllowedIPs = $ip/32
EOF
  wg set $WG_IF peer "$pub" preshared-key <(echo "$psk") allowed-ips "$ip/32"

  cat > "$CLIENT_DIR/$name.conf" <<EOF
[Interface]
PrivateKey = $key
Address = $ip/32
DNS = $WG_DNS
MTU = $WG_MTU

[Peer]
PublicKey = $(cat $WG_DIR/server.pub)
PresharedKey = $psk
Endpoint = $(cat $WG_DIR/endpoint):$(cat $WG_DIR/port)
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF
  show_client "$name"
}

show_client() {
  local f="$CLIENT_DIR/$1.conf"
  [ -f "$f" ] || die "No device named '$1'. Devices: $(ls $CLIENT_DIR 2>/dev/null | sed 's/\.conf//' | tr '\n' ' ')"
  echo
  echo "=================================================================="
  echo " Device: $1"
  echo " Open the WireGuard app -> + -> Scan from QR code -> scan this:"
  echo "=================================================================="
  qrencode -t ansiutf8 < "$f"
  echo "(Config file saved at $f)"
}

remove_client() {
  local f="$CLIENT_DIR/$1.conf"
  [ -f "$f" ] || die "No device named '$1'"
  local pub
  pub=$(grep PrivateKey "$f" | awk '{print $3}' | wg pubkey)
  wg set $WG_IF peer "$pub" remove
  # delete the "# client: name" block (comment + 4 lines) from server config
  sed -i "/^# client: $1\$/,+4d" $WG_DIR/$WG_IF.conf
  rm -f "$f"
  echo "Removed device '$1'"
}

case "${1:-}" in
  "")
    if [ -f $WG_DIR/$WG_IF.conf ]; then
      echo "Already installed. Use:  add <name> | show <name> | remove <name>"
    else
      install_server
      add_client phone
    fi ;;
  add)    [ -n "${2:-}" ] || die "Usage: add <name>";    add_client "$2" ;;
  show)   [ -n "${2:-}" ] || die "Usage: show <name>";   show_client "$2" ;;
  remove) [ -n "${2:-}" ] || die "Usage: remove <name>"; remove_client "$2" ;;
  *) die "Unknown command '$1'. Use: add | show | remove" ;;
esac
