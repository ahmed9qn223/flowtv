/* Flow TV Hybrid Presence v3.1 (no-preflight, TDZ-safe) */
(function(){
  const API_BASE = "https://flow-tv.infy.uk/api";
  const VIEWER_TTL_SECONDS = 30;

  // ---- DOM ----
  const video = document.getElementById('video');
  if (video) window.video = video;
  const viewerEl = document.getElementById('viewer-count-display');
  if (viewerEl) viewerEl.style.display = 'block';

  // ---- Identity ----
  let viewerId = localStorage.getItem('webtv_viewerId');
  if (!viewerId) {
    viewerId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2));
    localStorage.setItem('webtv_viewerId', viewerId);
  }

  // ---- Presence timers (declare BEFORE any call to startPresence) ----
  let hbTimer = null, vcTimer = null;

  async function sendHeartbeat(){
    if (!window.currentChannelId) return;
    const url = `${API_BASE}/heartbeat.php?channel_id=${encodeURIComponent(window.currentChannelId)}&viewer_id=${encodeURIComponent(viewerId)}`;
    try { await fetch(url, { method:'GET', mode:'cors', cache:'no-store' }); } catch(e){}
  }

  async function refreshViewerCount(){
    if (!window.currentChannelId) { if (viewerEl) viewerEl.textContent=''; return; }
    const url = `${API_BASE}/get_viewers.php?channel_id=${encodeURIComponent(window.currentChannelId)}&ttl=${VIEWER_TTL_SECONDS}`;
    try {
      const res = await fetch(url, { method:'GET', mode:'cors', cache:'no-store' });
      const data = await res.json();
      if (data && data.ok && viewerEl) viewerEl.textContent = `👥 กำลังดู: ${data.viewers}`;
    } catch(e){}
  }

  function startPresence(){
    clearInterval(hbTimer); clearInterval(vcTimer);
    hbTimer = setInterval(sendHeartbeat, 15000);
    vcTimer = setInterval(refreshViewerCount, 15000);
    sendHeartbeat(); refreshViewerCount();
  }

  function stopPresence(){
    clearInterval(hbTimer); clearInterval(vcTimer);
    hbTimer = vcTimer = null;
  }

  // ---- Channel handling ----
  function setCurrentChannel(id){
    if (!id) return;
    window.currentChannelId = id;
    try { localStorage.setItem('webtv_lastChannelId', id); } catch {}
    startPresence(); // safe now
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
      }
    } catch(e){}
  }
  tryWrapLoadChannel();
  const wrapTimer = setInterval(tryWrapLoadChannel, 1000);
  setTimeout(()=>clearInterval(wrapTimer), 10000);

  document.addEventListener('click', (ev)=>{
    const tile = ev.target && ev.target.closest ? ev.target.closest('.channel-tile') : null;
    if (tile && tile.dataset && tile.dataset.channelId){
      setCurrentChannel(tile.dataset.channelId);
    }
  }, true);

  // Restore last channel after everything is ready
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
