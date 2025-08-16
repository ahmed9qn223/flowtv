/* ===========================================================
   app.js — compatible with your index.html (clock/tabs/grid/player)
   - ใช้ปุ่มแท็บที่มีอยู่ (#tabs .tab[data-filter]) รวม "ทั้งหมด"
   - แบนเนอร์อัปเดต/แบนเนอร์ error + ปุ่มสลับเครื่องเล่น (JW/Shaka/HLS)
   - Bust cache ข้อมูลทุก ~2 ชม. (fallback ถ้าโหลด version.json ไม่ได้)
   - เล่นสตรีม: JW → Shaka (DASH/ClearKey) → hls.js (HLS) แบบ fallback
   =========================================================== */

(() => {
  /* ---------- DOM ---------- */
  const els = {
    clock: document.getElementById('clock'),
    tabsRoot: document.getElementById('tabs'),
    grid: document.getElementById('channel-list'),
    playerBox: document.getElementById('player'),
    header: document.querySelector('header'),
  };

  /* ---------- เวอร์ชัน / แคช ---------- */
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  let APP_VERSION = '';
  let DATA_VERSION = '';

  function bucket2h(ts = Date.now()) { return Math.floor(ts / TWO_HOURS); }

  async function loadVersion() {
    try {
      const r = await fetch('version.json', { cache: 'no-store' });
      if (!r.ok) throw 0;
      const v = await r.json();
      APP_VERSION = v.appVersion || '';
      DATA_VERSION = v.dataVersion || '';
      window.APP_VERSION = APP_VERSION;
      window.DATA_VERSION = DATA_VERSION;
    } catch {
      // ถ้าโหลดไม่ได้ ใช้ bucket 2 ชั่วโมงเพื่อ bust cache
      const b = 'auto-' + bucket2h();
      APP_VERSION = APP_VERSION || b;
      DATA_VERSION = DATA_VERSION || b;
      window.APP_VERSION = APP_VERSION;
      window.DATA_VERSION = DATA_VERSION;
    }
  }

  async function getJSON(path) {
    const v = encodeURIComponent(DATA_VERSION || APP_VERSION || bucket2h());
    const r = await fetch(`${path}?v=${v}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`โหลดไม่ได้: ${path}`);
    return r.json();
  }

  async function maybeClearClientCaches() {
    try {
      const KEY = 'flowtv.lastCacheClear';
      const last = Number(localStorage.getItem(KEY) || 0);
      if (Date.now() - last < TWO_HOURS) return;

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys
          .filter(k => /flowtv|shell/i.test(k))
          .map(k => caches.delete(k)));
      }
      localStorage.removeItem('TV_DATA_CACHE_V1');
      localStorage.setItem(KEY, Date.now().toString());
    } catch {}
  }

  /* ---------- เวลา / ชื่อช่อง ---------- */
  function tickClock() {
    try {
      const dt = new Date();
      const date = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: '2-digit'
      }).format(dt);
      const time = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(dt);
      els.clock.textContent = `${date} ${time}`;
    } catch {
      els.clock.textContent = new Date().toLocaleString('th-TH');
    }
  }

  // กล่องแสดงชื่อช่อง (จะถูกสร้างใต้เวลาอัตโนมัติ)
  let nowEl = null;
  function ensureNowPlaying() {
    if (nowEl) return nowEl;
    nowEl = document.createElement('div');
    nowEl.id = 'currentChannel';
    nowEl.style.cssText = 'text-align:center;color:#9fb0c1;font-weight:700;margin-top:2px;font-size:14px';
    els.clock?.parentElement?.appendChild(nowEl);
    return nowEl;
  }
  function setNowPlaying(name) {
    ensureNowPlaying().textContent = name || '';
    // mini toast บนมือถือ
    showToast(name || '');
  }

  /* ---------- แบนเนอร์ (อัปเดต / error) ---------- */
  function hostNotice() {
    let h = document.getElementById('notice-host');
    if (!h) {
      h = document.createElement('div');
      h.id = 'notice-host';
      h.className = 'notice-host';
      (els.header || document.body).insertAdjacentElement('afterend', h);
    }
    return h;
  }
  function clearNotices() { hostNotice().innerHTML = ''; }

  function showUpdateBanner(newVer) {
    const host = hostNotice();
    if (host.querySelector('.notice--update')) return;
    const el = document.createElement('div');
    el.className = 'notice notice--update';
    el.innerHTML = `
      <div class="notice-title">มีเวอร์ชันใหม่</div>
      <div class="notice-msg">อัปเดตล่าสุด (${escapeHtml(newVer || '')}) — โหลดหน้าใหม่เพื่อใช้งาน</div>
      <div class="notice-actions">
        <button class="btn primary" id="btn-reload">โหลดใหม่</button>
        <button class="btn" id="btn-close">ภายหลัง</button>
      </div>`;
    el.querySelector('#btn-reload').onclick = () => location.reload(true);
    el.querySelector('#btn-close').onclick = () => el.remove();
    host.appendChild(el);
  }

  function showErrorBanner(msg) {
    const host = hostNotice();
    host.querySelectorAll('.notice--error').forEach(n => n.remove());
    const el = document.createElement('div');
    el.className = 'notice notice--error';
    el.innerHTML = `
      <div class="notice-title">เล่นวิดีโอไม่สำเร็จ</div>
      <div class="notice-msg">${escapeHtml(msg || 'อาจติด CORS/สิทธิ์/ลิงก์หมดอายุ')}</div>
      <div class="notice-actions">
        <button class="btn danger" id="btn-retry">ลองใหม่</button>
        <button class="btn" id="btn-jw">JW</button>
        <button class="btn" id="btn-shaka">Shaka</button>
        <button class="btn" id="btn-hls">HLS</button>
        <button class="btn" id="btn-close">ปิด</button>
      </div>`;
    el.querySelector('#btn-retry').onclick = () => { el.remove(); if (currentChannel) play(currentChannel); };
    el.querySelector('#btn-jw').onclick    = () => { el.remove(); if (currentChannel) play(currentChannel,{force:'jw'}); };
    el.querySelector('#btn-shaka').onclick = () => { el.remove(); if (currentChannel) play(currentChannel,{force:'shaka'}); };
    el.querySelector('#btn-hls').onclick   = () => { el.remove(); if (currentChannel) play(currentChannel,{force:'hls'}); };
    el.querySelector('#btn-close').onclick = () => el.remove();
    host.appendChild(el);
  }

  async function pollUpdate() {
    try {
      const r = await fetch('version.json', { cache: 'no-store' });
      if (r.ok) {
        const v = await r.json();
        if (APP_VERSION && v.appVersion && v.appVersion !== APP_VERSION) {
          showUpdateBanner(v.appVersion);
        }
      }
    } catch {}
    setTimeout(pollUpdate, 10 * 60 * 1000);
  }

  /* ---------- Tabs & Filter ---------- */
  let channels = [];
  let currentFilter = (els.tabsRoot?.querySelector('.tab[aria-selected="true"]')?.dataset?.filter) || 'ทั้งหมด';

  function wireTabs() {
    if (!els.tabsRoot) return;
    els.tabsRoot.addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      if (b.dataset.filter === currentFilter) return;
      els.tabsRoot.querySelectorAll('.tab[aria-selected="true"]').forEach(n => n.setAttribute('aria-selected','false'));
      b.setAttribute('aria-selected','true');
      currentFilter = b.dataset.filter;
      clearNotices();
      renderGrid();
    });
  }

  function guessCategory(name) {
    const n = (name || '').toLowerCase();
    if (/(news|jkn|nation|nbt|tnn|workpoint|tv5hd|thairath|ไทยรัฐ)/i.test(name)) return 'ข่าว';
    if (/(sport|กีฬา|pptv|t sports|bein|premier|aff)/i.test(name)) return 'กีฬา';
    if (/(music|เพลง|mtv|hits)/i.test(name)) return 'เพลง';
    if (/(movie|หนัง|hbo|mono29 plus|cinema)/i.test(name)) return 'หนัง';
    if (/(discovery|สารคดี|national|animal|docu)/i.test(name)) return 'สารคดี';
    return 'บันเทิง';
  }

  /* ---------- Grid ---------- */
  function renderGrid() {
    els.grid.innerHTML = '';
    const list = channels.filter(c => currentFilter === 'ทั้งหมด' ? true : (c.category === currentFilter));

    const frag = document.createDocumentFragment();
    list.forEach(ch => {
      const btn = document.createElement('button');
      btn.className = 'ch-card';
      btn.type = 'button';
      btn.title = ch.name || '';

      const inner = document.createElement('div');
      inner.className = 'ch-inner';

      const img = document.createElement('img');
      img.className = 'ch-logo';
      img.loading = 'lazy';
      img.alt = ch.name || '';
      img.src = ch.logo || '';
      inner.appendChild(img);

      const name = document.createElement('div');
      name.className = 'ch-name';
      name.textContent = ch.name || '';
      inner.appendChild(name);

      btn.appendChild(inner);
      btn.addEventListener('click', () => {
        play(ch);
        try { els.playerBox?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
      });

      frag.appendChild(btn);
    });
    els.grid.appendChild(frag);
  }

  /* ---------- Player engines ---------- */
  let currentEngine = null;   // 'jw' | 'shaka' | 'hls' | 'native'
  let currentInstance = null; // jwplayer / shaka.Player / Hls / HTMLVideoElement
  let currentChannel = null;

  function destroyCurrent() {
    try {
      if (currentEngine === 'jw' && currentInstance?.remove) currentInstance.remove();
      else if (currentEngine === 'shaka' && currentInstance?.destroy) currentInstance.destroy();
      else if (currentEngine === 'hls' && currentInstance?.destroy) currentInstance.destroy();
    } catch(e){ console.warn('destroy err', e); }
    currentEngine = null; currentInstance = null;
    els.playerBox.innerHTML = '<div id="jw-holder"></div>';
  }

  function detectType(src, explicit) {
    if (explicit) return explicit.toLowerCase();
    const u = (src||'').toLowerCase();
    if (u.includes('.mpd')) return 'dash';
    if (u.includes('.m3u8')) return 'hls';
    return '';
  }
  const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const hexNoDash = s => (s||'').replace(/-/g,'').toLowerCase();

  function loadScriptOnce(src, id){
    return new Promise((res,rej)=>{
      if (id && document.getElementById(id)) return res();
      const s = document.createElement('script');
      s.src = src; s.async = true; if (id) s.id = id;
      s.onload = res; s.onerror = ()=>rej(new Error('load fail: '+src));
      document.head.appendChild(s);
    });
  }

  function playWithJW(cfg){
    destroyCurrent();
    if (!window.jwplayer) throw new Error('jw unavailable');
    const jw = jwplayer('jw-holder').setup({
      file: cfg.file,
      type: cfg.type || undefined,
      drm: cfg.drm || undefined,
      width:'100%', aspectratio:'16:9', autostart:true, mute:isMobile(),
      primary:'html5', stretching:'uniform', controls:true
    });
    currentEngine = 'jw'; currentInstance = jw;
    return new Promise((resolve,reject)=>{
      let failed = false;
      jw.once('playAttemptFailed', ()=>{ jw.setMute(true); jw.play(true); });
      jw.on('error', (e)=>{ failed=true; reject(new Error('jw error '+(e?.code||''))); });
      jw.on('setupError', (e)=>{ failed=true; reject(new Error('jw setupError '+(e?.message||''))); });
      jw.on('play', ()=>{ if(!failed) resolve(); });
      setTimeout(()=>{ if(!failed && jw.getState()==='idle'){ failed=true; reject(new Error('jw idle timeout')); } }, 3500);
    });
  }

  async function playWithShaka(cfg){
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/shaka-player@4.7.12/dist/shaka-player.compiled.min.js', 'shaka-lib');
    destroyCurrent();
    const v = document.createElement('video');
    v.id='html5video'; v.controls=true; v.autoplay=true; v.playsInline=true; v.setAttribute('playsinline','');
    v.crossOrigin='anonymous'; v.style.width='100%'; els.playerBox.appendChild(v);

    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) throw new Error('shaka not supported');
    const player = new shaka.Player(v);

    if (cfg.drm?.clearkey?.keyId && cfg.drm?.clearkey?.key) {
      const map = {}; map[hexNoDash(cfg.drm.clearkey.keyId)] = hexNoDash(cfg.drm.clearkey.key);
      player.configure({ drm: { clearKeys: map } });
    }
    await player.load(cfg.file);
    try{ await v.play(); }catch{}
    currentEngine='shaka'; currentInstance=player;
  }

  async function playWithHls(cfg){
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js','hls-lib');
    destroyCurrent();
    const v = document.createElement('video');
    v.id='html5video'; v.controls=true; v.autoplay=true; v.playsInline=true; v.setAttribute('playsinline','');
    v.crossOrigin='anonymous'; v.style.width='100%'; els.playerBox.appendChild(v);

    if (window.Hls && Hls.isSupported()){
      const hls = new Hls({ lowLatencyMode:true, enableWorker:true });
      hls.on(Hls.Events.ERROR, (_e, data)=>console.warn('hls.js error', data));
      hls.loadSource(cfg.file); hls.attachMedia(v);
      currentEngine='hls'; currentInstance=hls;
    } else {
      v.src = cfg.file; currentEngine='native'; currentInstance=v;
    }
    try{ await v.play(); }catch{}
  }

  async function play(ch, opt = {}) {
    clearNotices();
    currentChannel = ch;

    const file = ch.src || ch.file;
    const type = detectType(file, ch.type);
    const drm = ch.drm || (ch.keyId && ch.key ? { clearkey:{ keyId: ch.keyId, key: ch.key } } : undefined);

    const forced = (opt.force || (new URLSearchParams(location.search).get('player')||'auto')).toLowerCase();

    try {
      if (forced === 'jw')    { await playWithJW({file, type, drm}); setNowPlaying(ch.name); return; }
      if (forced === 'shaka') { await playWithShaka({file, drm});   setNowPlaying(ch.name); return; }
      if (forced === 'hls')   { await playWithHls({file});          setNowPlaying(ch.name); return; }
    } catch (eForced) {
      console.warn('forced engine failed →', eForced);
    }

    try { // auto: JW → (Shaka|HLS)
      await playWithJW({file, type, drm});
      setNowPlaying(ch.name); return;
    } catch (e1) { console.warn('JW failed →', e1?.message||e1); }

    try {
      if (type === 'dash') { await playWithShaka({file, drm}); setNowPlaying(ch.name); return; }
      if (type === 'hls')  { await playWithHls({file});        setNowPlaying(ch.name); return; }
      throw new Error('unknown type');
    } catch (e2) {
      console.error('All engines failed:', e2);
      showErrorBanner('ไม่สามารถเล่นสตรีมนี้ได้ (อาจติด CORS/สิทธิ์ หรือสตรีมล่ม)');
    }
  }

  /* ---------- Toast (มือถือ) ---------- */
  function showToast(text){
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return;
    let t = document.getElementById('nowPlayingToast');
    if (!t){
      t = document.createElement('div');
      t.id = 'nowPlayingToast';
      t.className = 'now-playing-toast';
      (els.playerBox?.parentElement || document.body).appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 1800);
  }

  /* ---------- Boot ---------- */
  let allChannels = [];

  async function boot(){
    // Clock
    tickClock(); setInterval(tickClock, 1000);

    // cache clear client
    await maybeClearClientCaches();

    // version & data
    await loadVersion();
    const chRaw = await getJSON('channels.json');
    allChannels = Array.isArray(chRaw.channels) ? chRaw.channels : (Array.isArray(chRaw) ? chRaw : []);
    channels = allChannels.map(c => ({ ...c, category: guessCategory(c.name||'') }));

    // Tabs
    wireTabs();

    // Grid
    renderGrid();

    // Auto play ช่องแรกในกรองปัจจุบัน
    const first = channels.find(c => currentFilter==='ทั้งหมด' ? true : c.category===currentFilter) || channels[0];
    if (first) play(first);

    // Poll update banner
    pollUpdate();
  }

  /* ---------- Helpers ---------- */
  function escapeHtml(s){
    return String(s).replace(/[&<>"'`=\/]/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'
    }[c]));
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
