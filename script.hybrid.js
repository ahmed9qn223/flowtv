/* Flow TV Hybrid Presence v3.2 */
(function(){
  const API_BASE = "https://flow-tv.infy.uk/api";
  const VIEWER_TTL_SECONDS = 30;
  const DEBUG = true;

  const video = document.getElementById('video');
  if (video) window.video = video;

  let viewerEl = document.getElementById('viewer-count-display');
  if (!viewerEl) {
    viewerEl = document.createElement('div');
    viewerEl.id = 'viewer-count-display';
    viewerEl.style.position = 'absolute';
    viewerEl.style.top = '6px';
    viewerEl.style.right = '8px';
    viewerEl.style.padding = '4px 8px';
    viewerEl.style.borderRadius = '8px';
    viewerEl.style.fontSize = '14px';
    viewerEl.style.background = 'rgba(0,0,0,0.5)';
    viewerEl.style.color = '#fff';
    viewerEl.style.zIndex = 9999;
    viewerEl.textContent = '👥 ...';
    (document.querySelector('.player-container') || document.body).appendChild(viewerEl);
  }

  let viewerId = localStorage.getItem('webtv_viewerId');
  if (!viewerId) {
    viewerId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2));
    localStorage.setItem('webtv_viewerId', viewerId);
  }
  if (DEBUG) console.log('[presence] viewerId =', viewerId);

  let hbTimer = null, vcTimer = null;

  async function sendHeartbeat(){
    if (!window.currentChannelId) return;
    const url = `${API_BASE}/heartbeat.php?channel_id=${encodeURIComponent(window.currentChannelId)}&viewer_id=${encodeURIComponent(viewerId)}&t=${Date.now()}`;
    try {
      await fetch(url, { method:'GET', mode:'no-cors', cache:'no-store' });
      if (DEBUG) console.log('[presence] hb ->', window.currentChannelId);
    } catch(e){ if (DEBUG) console.warn('[presence] hb error', e); }
  }

  async function refreshViewerCount(){
    if (!window.currentChannelId) { if (viewerEl) viewerEl.textContent=''; return; }
    const url = `${API_BASE}/get_viewers.php?channel_id=${encodeURIComponent(window.currentChannelId)}&ttl=${VIEWER_TTL_SECONDS}&t=${Date.now()}`;
    try {
      const res = await fetch(url, { method:'GET', mode:'cors', cache:'no-store' });
      const data = await res.json();
      if (data && data.ok && viewerEl) viewerEl.textContent = `👥 กำลังดู: ${data.viewers}`;
      if (DEBUG) console.log('[presence] vc <-', data);
    } catch(e){ if (DEBUG) console.warn('[presence] vc error', e); }
  }

  function startPresence(){
    clearInterval(hbTimer); clearInterval(vcTimer);
    hbTimer = setInterval(sendHeartbeat, 15000);
    vcTimer = setInterval(refreshViewerCount, 15000);
    sendHeartbeat(); refreshViewerCount();
    if (DEBUG) console.log('[presence] startPresence with', window.currentChannelId);
  }

  function stopPresence(){
    clearInterval(hbTimer); clearInterval(vcTimer);
    hbTimer = vcTimer = null;
    if (DEBUG) console.log('[presence] stopPresence');
  }

  function setCurrentChannel(id){
    if (!id) return;
    window.currentChannelId = id;
    try { localStorage.setItem('webtv_lastChannelId', id); } catch {}
    if (DEBUG) console.log('[presence] setCurrentChannel', id);
    startPresence();
  }

  function tryWrapLoadChannel(){
    try {
      if (window.channelManager && typeof window.channelManager.loadChannel === 'function' && !window.channelManager.loadChannel.__wrapped){
        const orig = window.channelManager.loadChannel.bind(window.channelManager);
        window.channelManager.loadChannel = async (id) => {
          setCurrentChannel(id);
          return orig(id);
        };
        window.channelManager.loadChannel.__wrapped = true;
        if (DEBUG) console.log('[presence] wrapped channelManager.loadChannel');
      }
    } catch(e){}
  }
  tryWrapLoadChannel();
  const wrapTimer = setInterval(tryWrapLoadChannel, 1000);
  setTimeout(()=>clearInterval(wrapTimer), 8000);

  document.addEventListener('click', (ev)=>{
    const tile = ev.target && ev.target.closest ? ev.target.closest('.channel-tile') : null;
    if (tile && tile.dataset && tile.dataset.channelId){
      setCurrentChannel(tile.dataset.channelId);
    }
  }, true);

  const lastId = localStorage.getItem('webtv_lastChannelId');
  if (lastId) setCurrentChannel(lastId);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPresence(); else startPresence();
  });

  if (video){
    video.addEventListener('playing', startPresence);
    video.addEventListener('pause', stopPresence);
  }
})();
