import type { LiveLocation } from './types';

export type MapPoint = { uid: string; lat: number; lng: number; name: string; updatedMs: number; me: boolean };

/**
 * A simple OpenStreetMap (Leaflet) map drawn in a WebView — free, no API key, no billing.
 * The app sends {type:'points', points} to draw everyone, and {type:'focus', uid} to jump to a person.
 */
export function mapHtml(): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>html,body,#map{margin:0;height:100%;background:#0b0f0d}
.pin{background:#16A34A;color:#fff;font-weight:700;border:2px solid #fff;border-radius:14px;padding:2px 8px;font-family:sans-serif;font-size:12px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5);transform:translate(-50%,-120%)}
.pin.me{background:#2563EB}
.pin.stale{opacity:.6}
.dot{width:12px;height:12px;border-radius:6px;background:#16A34A;border:2px solid #fff;transform:translate(-50%,-50%)}
.dot.me{background:#2563EB}
#layers{position:absolute;top:10px;right:10px;z-index:1000;display:flex;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.4);font-family:sans-serif}
#layers button{border:0;background:#fff;color:#111;font-weight:700;font-size:13px;padding:8px 12px}
#layers button.on{background:#16A34A;color:#fff}
.leaflet-control-attribution{font-size:9px}</style>
</head><body><div id="map"></div>
<div id="layers"><button id="b-map" class="on">Map</button><button id="b-sat">Satellite</button></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([26.14, 91.74], 12);
map.attributionControl.setPrefix(false);
// Street map (OpenStreetMap) and satellite photos (Esri World Imagery) with place names on top.
var street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
var sat = L.layerGroup([
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
]);
street.addTo(map);
function setLayer(name){
  if (name === 'sat') { map.removeLayer(street); sat.addTo(map); } else { map.removeLayer(sat); street.addTo(map); }
  document.getElementById('b-map').className = name === 'sat' ? '' : 'on';
  document.getElementById('b-sat').className = name === 'sat' ? 'on' : '';
  try { localStorage.setItem('layer', name); } catch (e) {}
}
document.getElementById('b-map').onclick = function(){ setLayer('map'); };
document.getElementById('b-sat').onclick = function(){ setLayer('sat'); };
try { if (localStorage.getItem('layer') === 'sat') setLayer('sat'); } catch (e) {}
var markers = {}, dots = {}, pts = {}, fitted = false;
function send(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
function ago(ms){ var s=Math.round(ms/1000); if(s<60)return 'now'; var m=Math.round(s/60); if(m<60)return m+' min ago'; var h=Math.round(m/60); return h+' h ago'; }
function esc(t){ return String(t).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
function render(points){
  var seen = {}, group = [];
  points.forEach(function(p){
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
    seen[p.uid] = true; pts[p.uid] = p; group.push([p.lat, p.lng]);
    var old = p.updatedMs ? (Date.now() - p.updatedMs > 300000) : false;
    var label = (p.me ? 'You' : esc(p.name || 'Member')) + (old ? ' · ' + ago(Date.now() - p.updatedMs) : '');
    var pin = L.divIcon({ className: '', html: '<div class="pin' + (p.me ? ' me' : '') + (old ? ' stale' : '') + '">' + label + '</div>', iconSize: [0, 0] });
    var dot = L.divIcon({ className: '', html: '<div class="dot' + (p.me ? ' me' : '') + '"></div>', iconSize: [0, 0] });
    if (markers[p.uid]) { markers[p.uid].setLatLng([p.lat, p.lng]).setIcon(pin); dots[p.uid].setLatLng([p.lat, p.lng]).setIcon(dot); }
    else {
      dots[p.uid] = L.marker([p.lat, p.lng], { icon: dot }).addTo(map);
      markers[p.uid] = L.marker([p.lat, p.lng], { icon: pin }).addTo(map).on('click', function(){ send({ tap: p.uid }); });
    }
  });
  Object.keys(markers).forEach(function(uid){ if(!seen[uid]){ map.removeLayer(markers[uid]); map.removeLayer(dots[uid]); delete markers[uid]; delete dots[uid]; delete pts[uid]; } });
  if (!fitted && group.length){ fitted = true; if (group.length === 1) map.setView(group[0], 16); else map.fitBounds(group, { padding: [50, 50] }); }
}
function onMsg(e){
  try {
    var m = JSON.parse(e.data);
    if (m.type === 'points') render(m.points);
    else if (m.type === 'focus' && pts[m.uid]) map.setView([pts[m.uid].lat, pts[m.uid].lng], 17);
  } catch (x) {}
}
document.addEventListener('message', onMsg);
window.addEventListener('message', onMsg);
send({ ready: true });
</script></body></html>`;
}

export function pointsForMap(points: LiveLocation[], myUid: string): MapPoint[] {
  return points
    .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
    .map((p) => ({ uid: p.uid, lat: p.lat, lng: p.lng, name: p.name, updatedMs: p.updatedAt?.toMillis?.() ?? Date.now(), me: p.uid === myUid }));
}
