/**
 * The web page our exercise player runs inside (a WebView).
 *
 * Why our own page: the old player library's hosted page ignored "play"/"pause"
 * from the app, so the play button didn't work.
 *
 * Quality: YouTube no longer lets apps pick a quality directly; it picks one from the
 * size of the player in real screen pixels (and the internet speed). So for e.g. 360p we
 * draw the YouTube player at about 360 real pixels tall and stretch it to fill the box.
 */
export function ytPlayerHtml(videoId: string, targetHeightPx: number | null): string {
  const id = videoId.replace(/[^\w-]/g, '');
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#wrap{position:absolute;left:0;top:0;transform-origin:0 0}#wrap iframe{display:block;border:0}</style>
</head><body><div id="wrap"><div id="player"></div></div>
<script>
var TARGET = ${targetHeightPx ? Math.round(targetHeightPx) : 0};
function send(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
function box(){
  var W = window.innerWidth || 360, H = window.innerHeight || 203, dpr = window.devicePixelRatio || 1, s = 1;
  if (TARGET) { var need = TARGET / (H * dpr); if (need < 1) s = need; }
  var w = Math.round(W * s), h = Math.round(H * s), wrap = document.getElementById('wrap');
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px'; wrap.style.transform = 'scale(' + (W / w) + ',' + (H / h) + ')';
  return [w, h];
}
var player, state = -1;
function onYouTubeIframeAPIReady(){
  var d = box();
  player = new YT.Player('player', {
    width: d[0], height: d[1], videoId: '${id}',
    playerVars: { playsinline: 1, controls: 0, rel: 0, iv_load_policy: 3, fs: 0, disablekb: 1, modestbranding: 1, origin: location.origin },
    events: {
      onReady: function(){ send({ t: 'ready', duration: player.getDuration() }); player.playVideo(); },
      onStateChange: function(e){ state = e.data; send({ t: 'state', s: e.data, time: player.getCurrentTime(), duration: player.getDuration() }); },
      onError: function(e){ send({ t: 'error', code: e.data }); }
    }
  });
}
setInterval(function(){
  if (player && player.getCurrentTime && state === 1) send({ t: 'time', time: player.getCurrentTime(), duration: player.getDuration() });
}, 500);
var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
tag.onerror = function(){ send({ t: 'error', code: 'offline' }); };
</script></body></html>`;
}

/** JavaScript the app injects to control the page. */
export const ytCmd = {
  play: 'try{player.playVideo()}catch(e){};true;',
  pause: 'try{player.pauseVideo()}catch(e){};true;',
  seek: (t: number) => `try{player.seekTo(${Number(t) || 0},true)}catch(e){};true;`,
  speed: (r: number) => `try{player.setPlaybackRate(${Number(r) || 1})}catch(e){};true;`,
};
