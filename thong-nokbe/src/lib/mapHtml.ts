import type { LiveLocation } from './types';

/** A simple OpenStreetMap (Leaflet) map drawn in a WebView — free, no API key, no billing. */
export function mapHtml(): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>html,body,#map{margin:0;height:100%;background:#0b0f0d}
.pin{background:#16A34A;color:#fff;font-weight:700;border:2px solid #fff;border-radius:14px;padding:2px 8px;font-family:sans-serif;font-size:12px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.pin.off{background:#64748b}
.stale{opacity:.55}</style>
</head><body><div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([20.59, 78.96], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
var markers = {}, fitted = false;
function send(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
function ago(ms){ var s=Math.round(ms/1000); if(s<60)return 'now'; var m=Math.round(s/60); if(m<60)return m+'m ago'; var h=Math.round(m/60); return h+'h ago'; }
function render(points){
  var seen = {}, group = [];
  points.forEach(function(p){
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
    seen[p.uid] = true; group.push([p.lat, p.lng]);
    var stale = p.updatedMs ? (Date.now() - p.updatedMs > 300000) : false;
    var cls = 'pin' + (p.sharing ? '' : ' off') + (stale ? ' stale' : '');
    var label = (p.name || 'Member') + (p.sharing ? (stale ? ' · ' + ago(Date.now()-p.updatedMs) : '') : ' · off');
    var icon = L.divIcon({ className: '', html: '<div class="'+cls+'">'+label+'</div>', iconAnchor: [0, 0] });
    if (markers[p.uid]) { markers[p.uid].setLatLng([p.lat, p.lng]).setIcon(icon); }
    else { markers[p.uid] = L.marker([p.lat, p.lng], { icon: icon }).addTo(map).on('click', function(){ send({ tap: p.uid }); }); }
  });
  Object.keys(markers).forEach(function(uid){ if(!seen[uid]){ map.removeLayer(markers[uid]); delete markers[uid]; } });
  if (!fitted && group.length){ fitted = true; if(group.length===1) map.setView(group[0], 16); else map.fitBounds(group, { padding: [50,50] }); }
}
document.addEventListener('message', function(e){ try { render(JSON.parse(e.data)); } catch(x){} });
window.addEventListener('message', function(e){ try { render(JSON.parse(e.data)); } catch(x){} });
send({ ready: true });
</script></body></html>`;
}

export function pointsForMap(points: LiveLocation[]) {
  return points.map((p) => ({
    uid: p.uid,
    lat: p.lat,
    lng: p.lng,
    name: p.name,
    sharing: p.sharing !== false,
    updatedMs: p.updatedAt?.toMillis?.() ?? 0,
  }));
}
