/* ========================= app.js (IMPROVED, no-proxy) =========================
   - คง UI/หมวดหมู่/กริด/Histats ของเดิม
   - เพิ่ม fallback เอนจิน: JW → Shaka (DASH) → hls.js (HLS)
   - บังคับเอนจินผ่าน URL: ?player=jw|shaka|hls|auto  (ค่าเริ่มต้น: auto)
   - auto ลองตามลำดับ + เปลี่ยนแหล่งถัดไปถ้าล้มเหลว
   - แสดงชื่อช่องใต้เวลา + toast มือถือ
================================================================================= */

const CH_URL  = 'channels.json';
const CAT_URL = 'categories.json';
const TIMEZONE = 'Asia/Bangkok';

// บังคับเอนจินด้วย query param: ?player=jw|shaka|hls|auto
const PREFERRED_PLAYER = (new URLSearchParams(location.search).get('player') || 'auto').toLowerCase();

const SWITCH_OUT_MS   = 140;
const STAGGER_STEP_MS = 22;

let categories = null;
let channels   = [];
let currentFilter = '';
let currentIndex  = -1;

// ปรับขนาด player
let currentEngine = null;   // 'jw' | 'shaka' | 'hls' | 'native'
let currentInstance = null; // jwplayer() | shaka.Player | Hls | HTMLVideoElement

try { jwplayer.key = jwplayer.key || 'XSuP4qMl+9tK17QNb+4+th2Pm9AWgMO/cYH8CI0HGGr7bdjo'; } catch {}

/* ------------------------ Boot ------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  mountClock();
  mountNowPlayingContainer();
  mountHistatsTopRight();

  await loadData();

  buildTabs();
  setActiveTab((categories?.order?.[0]) || categories?.default || 'บันเทิง');
  centerTabsIfPossible();
  addEventListener('resize', debounce(centerTabsIfPossible,150));
  addEventListener('load', centerTabsIfPossible);

  const lastId = safeGet('lastId');
  if (lastId) {
    const idx = channels.findIndex(c => c.id === lastId);
    if (idx >= 0) playByIndex(idx, {scroll:false});
  }
});

/* ------------------------ Load / Cache ------------------------ */
async function loadData(){
  const cacheKey = 'TV_DATA_CACHE_V1';
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cache && Date.now() - cache.t < 12*60*60*1000) {
      categories = cache.cat;
      channels   = cache.ch;
      return;
    }
  } catch {}

  const [catRes, chRes] = await Promise.all([
    fetch(CAT_URL, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(CH_URL, {cache:'no-store'}).then(r=>r.json())
  ]);

  categories = catRes || {
    order: ['ข่าว','บันเทิง','กีฬา','สารคดี','เพลง','หนัง'],
    default: 'บันเทิง',
    rules: []
  };
  channels = Array.isArray(chRes) ? chRes : (chRes.channels || []);
  channels.forEach((c,i)=>{ if(!c.id) c.id = genIdFrom(c, i); });

  localStorage.setItem('TV_DATA_CACHE_V1', JSON.stringify({t:Date.now(), cat:categories, ch:channels}));
}

/* ------------------------ Header: Clock & Now Playing ------------------------ */
function mountClock(){
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = new Intl.DateTimeFormat('th-TH',{
      day:'2-digit', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      hour12:false, timeZone: TIMEZONE
    }).format(now).replace(',', '');
  };
  tick();
  setInterval(tick, 1000);
}
function mountNowPlayingContainer(){
  const clock = document.getElementById('clock');
  if (!clock) return;
  let now = document.getElementById('now-playing');
  if (!now) {
    now = document.createElement('div');
    now.id = 'now-playing';
    now.className = 'now-playing';
    now.setAttribute('aria-live','polite');
    clock.after(now);
  }
  window.__setNowPlaying = (name='')=>{
    now.textContent = name;
    now.title = name;
    now.classList.remove('swap'); void now.offsetWidth; now.classList.add('swap');
  };
}

/* ------------------------ Tabs ------------------------ */
function buildTabs(){
  const root = document.getElementById('tabs'); if(!root) return;
  root.innerHTML = '';
  (categories?.order || []).forEach(name=>{
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.filter = name;
    btn.setAttribute('aria-selected','false');
    btn.innerHTML = `
      <span class="tab-card">
        <span class="tab-icon">${getIconSVG(name)}</span>
        <span class="tab-label">${name}</span>
      </span>`;
    root.appendChild(btn);
  });
  wireTabs(root);
}
function wireTabs(root){
  root.addEventListener('click', e=>{
    const b = e.target.closest('.tab'); if(!b) return;
    setActiveTab(b.dataset.filter);
  });
  root.addEventListener('keydown', e=>{
    if(e.key!=='ArrowRight' && e.key!=='ArrowLeft') return;
    const all = Array.from(root.querySelectorAll('.tab'));
    const i = all.findIndex(b=>b.getAttribute('aria-selected')==='true');
    let n = e.key==='ArrowRight' ? i+1 : i-1;
    if(n<0) n = all.length-1; if(n>=all.length) n = 0;
    all[n].focus(); setActiveTab(all[n].dataset.filter); e.preventDefault();
  });
}
function setActiveTab(name){
  currentFilter = name;
  const root = document.getElementById('tabs');
  root.querySelectorAll('.tab').forEach(b=>{
    const sel = b.dataset.filter===name;
    b.setAttribute('aria-selected', sel?'true':'false');
    if(sel) b.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
  });

  const grid = ensureGrid();
  grid.classList.add('switch-out');
  setTimeout(()=>{
    grid.classList.remove('switch-out');
    render({withEnter:true});
  }, SWITCH_OUT_MS);
}
function centerTabsIfPossible(){
  const el = document.getElementById('tabs'); if(!el) return;
  el.classList.toggle('tabs--center', el.scrollWidth <= el.clientWidth + 1);
}

/* ------------------------ Category logic ------------------------ */
function getCategory(ch){
  if (ch.category) return ch.category;
  if (Array.isArray(ch.tags)) {
    const t = ch.tags.map(x=>String(x).toLowerCase());
    if (t.includes('news')) return 'ข่าว';
    if (t.includes('sports')) return 'กีฬา';
    if (t.includes('music')) return 'เพลง';
    if (t.includes('documentary')) return 'สารคดี';
    if (t.includes('movie') || t.includes('film')) return 'หนัง';
  }
  const hay = `${ch.name||''} ${ch.logo||''} ${JSON.stringify(ch.tags||[])}`.toLowerCase();
  const src0 = String((ch.sources?.[0]?.src) || ch.src || ch.file || '').toLowerCase();
  for (const r of (categories?.rules || [])) {
    const ok = (r.include||[]).some(pat=>{
      try {
        if (pat.startsWith('/') && pat.endsWith('/')) {
          const re = new RegExp(pat.slice(1,-1),'i');
          return re.test(hay) || re.test(src0);
        }
        const p = pat.toLowerCase();
        return hay.includes(p) || src0.includes(p);
      } catch { return false; }
    });
    if (ok) return r.category;
  }
  return categories?.default || 'บันเทิง';
}
function useWideLogo(ch){
  if (ch.logoWide) return true;
  const cat = getCategory(ch);
  const rule = (categories?.rules||[]).find(r=>r.category===cat && r.useWideLogo);
  return !!rule;
}

/* ------------------------ Render grid ------------------------ */
function ensureGrid(){
  const grid = document.getElementById('channel-list');
  if (!grid.classList.contains('grid')) grid.classList.add('grid');
  return grid;
}
function render(opt={withEnter:false}){
  const grid = ensureGrid(); grid.innerHTML='';

  const list = channels.filter(c => getCategory(c) === currentFilter);
  const cols = computeGridCols(grid);

  list.forEach((ch,i)=>{
    const btn = document.createElement('button');
    btn.className = 'channel';
    btn.dataset.category = getCategory(ch);
    btn.dataset.globalIndex = String(channels.indexOf(ch));
    if (useWideLogo(ch)) btn.dataset.wide = 'true';
    btn.title = ch.name || 'ช่อง';

    btn.innerHTML = `
      <div class="ch-card">
        <div class="logo-wrap">
          <img class="logo" loading="lazy" decoding="async"
               src="${escapeHtml(ch.logo || '')}" alt="${escapeHtml(ch.name||'โลโก้ช่อง')}">
        </div>
        <div class="name">${escapeHtml(ch.name||'ช่อง')}</div>
      </div>`;

    btn.addEventListener('click', e=>{
      ripple(e, btn.querySelector('.ch-card'));
      playByChannel(ch);
      scrollToPlayer();
    });

    const row = Math.floor(i / Math.max(cols,1));
    const col = i % Math.max(cols,1);
    const order = row + col;
    btn.style.setProperty('--i', order);

    grid.appendChild(btn);
  });

  grid.style.setProperty('--stagger', `${STAGGER_STEP_MS}ms`);

  if (opt.withEnter){
    grid.classList.add('switch-in');
    const maxOrder = Math.max(...Array.from(grid.children).map(el => +getComputedStyle(el).getPropertyValue('--i') || 0), 0);
    const total = (maxOrder * STAGGER_STEP_MS) + 420;
    setTimeout(()=> grid.classList.remove('switch-in'), Math.min(total, 1200));
  }

  highlight(currentIndex);
}
function computeGridCols(container){
  const cs = getComputedStyle(document.documentElement);
  const tileW = parseFloat(cs.getPropertyValue('--tile-w')) || 110;
  const gap   = parseFloat(cs.getPropertyValue('--tile-g')) || 10;
  const fullW = container.clientWidth;
  return Math.max(1, Math.floor((fullW + gap) / (tileW + gap)));
}

/* ------------------------ Player orchestrator ------------------------ */
function playByChannel(ch){
  const i = channels.indexOf(ch);
  if (i >= 0) playByIndex(i);
}
async function playByIndex(i, opt={scroll:true}){
  const ch = channels[i]; if(!ch) return;
  currentIndex = i;
  safeSet('lastId', ch.id);

  // แปลงสคีมา
  const sources = buildSources(ch);

  // ลองทีละแหล่ง + ลองหลายเอนจินต่อแหล่ง
  let played = false, lastErr = null;
  for (const s of sources){
    try {
      await tryEnginesForSource(ch, s);
      played = true; break;
    } catch (e) {
      lastErr = e; console.warn('source fail:', s, e);
    }
  }
  if (!played) {
    alert('ไม่สามารถเล่นสตรีมนี้ได้ (อาจติด CORS/สิทธิ์ DRM/สตรีมล่ม)');
    console.error('All sources failed →', lastErr);
    return;
  }

  window.__setNowPlaying?.(ch.name || '');
  highlight(i);
  if (opt.scroll ?? true) scrollToPlayer();
  showMobileToast(ch.name || '');
}
function buildSources(ch){
  if (Array.isArray(ch.sources) && ch.sources.length){
    return [...ch.sources].sort((a,b)=>(a.priority||99)-(b.priority||99));
  }
  const s = ch.src || ch.file;
  const t = ch.type || detectType(s);
  const drm = ch.drm || (ch.keyId && ch.key ? {clearkey:{keyId:ch.keyId, key:ch.key}} : undefined);
  return [{ src:s, type:t, drm }];
}

/* ---------- Engine selection per source ---------- */
async function tryEnginesForSource(ch, s){
  const file = s.src || s.file || '';
  const type = (s.type || detectType(file)).toLowerCase();
  const drm  = s.drm?.clearkey;

  // forced mode
  if (PREFERRED_PLAYER === 'jw')    return playWithJW({file,type,drm, poster: ch.poster || ch.logo});
  if (PREFERRED_PLAYER === 'shaka') return playWithShaka({file, drm});
  if (PREFERRED_PLAYER === 'hls')   return playWithHls({file});

  // auto mode
  try {
    await playWithJW({file,type,drm, poster: ch.poster || ch.logo});
    return;
  } catch (e) {
    console.warn('JW failed → try native engine', e);
  }
  if (type === 'dash') {
    await playWithShaka({file, drm});
    return;
  }
  if (type === 'hls') {
    await playWithHls({file});
    return;
  }
  throw new Error('unknown stream type');
}

/* ---------- Engine implementations ---------- */
function destroyCurrent(){
  try {
    if (currentEngine === 'jw' && currentInstance && currentInstance.remove) {
      currentInstance.remove();
    } else if (currentEngine === 'shaka' && currentInstance && currentInstance.destroy) {
      currentInstance.destroy();
    } else if (currentEngine === 'hls' && currentInstance && currentInstance.destroy) {
      currentInstance.destroy();
    }
  } catch(e){ console.warn('destroy error', e); }

  currentEngine = null; currentInstance = null;

  const wrap = document.getElementById('player');
  if (wrap) wrap.innerHTML = '<div id="jw-holder"></div>'; // ที่ว่างให้ JW
}

function loadScriptOnce(src, id){
  return new Promise((resolve, reject)=>{
    if (id && document.getElementById(id)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; if (id) s.id = id;
    s.onload = resolve; s.onerror = ()=>reject(new Error('load fail: '+src));
    document.head.appendChild(s);
  });
}

/* JW Player */
function playWithJW({file, type, drm, poster}){
  destroyCurrent();
  if (!window.jwplayer) throw new Error('jw unavailable');

  const sources = [{ file, type }];
  if (type === 'dash' && drm?.keyId && drm?.key) {
    sources[0].drm = { clearkey: { keyId: drm.keyId, key: drm.key } };
  }

  const jw = jwplayer('jw-holder').setup({
    playlist: [{ image: poster, sources }],
    width:'100%', aspectratio:'16:9', autostart:true, mute:isMobile(),
    displaytitle:false, displaydescription:false, playbackRateControls:true,
    primary:'html5', stretching:'uniform'
  });
  currentEngine = 'jw'; currentInstance = jw;

  return new Promise((resolve, reject)=>{
    let failed = false;
    jw.once('playAttemptFailed', ()=>{ jw.setMute(true); jw.play(true); });
    jw.on('error', (e)=>{ failed = true; reject(new Error('jw error '+(e?.code||''))); });
    jw.on('setupError', (e)=>{ failed = true; reject(new Error('jw setupError '+(e?.message||''))); });
    jw.on('play', ()=>{ if(!failed) resolve(); });
    setTimeout(()=>{ if(!failed && jw.getState()==='idle') { failed = true; reject(new Error('jw idle timeout')); } }, 3500);
  });
}

/* Shaka Player (DASH + ClearKey) */
async function playWithShaka({file, drm}){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/shaka-player@4.7.12/dist/shaka-player.compiled.min.js','shaka-lib');
  destroyCurrent();

  const wrap = document.getElementById('player');
  const v = document.createElement('video');
  v.id = 'html5video'; v.controls = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('playsinline',''); v.crossOrigin = 'anonymous';
  v.style.width = '100%'; v.style.maxWidth = '100%';
  wrap.appendChild(v);

  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) throw new Error('shaka not supported');

  const player = new shaka.Player(v);
  if (drm?.keyId && drm?.key) {
    const map = {};
    const keyId = drm.keyId.replace(/-/g,'').toLowerCase();
    const key   = drm.key.replace(/-/g,'').toLowerCase();
    map[keyId] = key;
    player.configure({ drm: { clearKeys: map } });
  }
  await player.load(file);
  try { await v.play(); } catch {}
  currentEngine = 'shaka'; currentInstance = player;
}

/* hls.js (HLS) */
async function playWithHls({file}){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js','hls-lib');
  destroyCurrent();

  const wrap = document.getElementById('player');
  const v = document.createElement('video');
  v.id = 'html5video'; v.controls = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('playsinline',''); v.crossOrigin = 'anonymous';
  v.style.width = '100%'; v.style.maxWidth = '100%';
  wrap.appendChild(v);

  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ lowLatencyMode:true, enableWorker:true });
    hls.loadSource(file); hls.attachMedia(v);
    currentEngine = 'hls'; currentInstance = hls;
  } else {
    // Safari/iOS
    v.src = file; currentEngine = 'native'; currentInstance = v;
  }
  try { await v.play(); } catch {}
}

/* ------------------------ UI helpers ------------------------ */
function highlight(globalIndex){
  document.querySelectorAll('.channel').forEach(el=>{
    const idx = Number(el.dataset.globalIndex);
    el.classList.toggle('active', idx === globalIndex);
    el.setAttribute('aria-pressed', idx === globalIndex ? 'true':'false');
  });
}
function ripple(event, container){
  if(!container) return;
  const r = container.getBoundingClientRect();
  const max = Math.max(r.width, r.height);
  const x = (event.clientX ?? (r.left + r.width/2)) - r.left;
  const y = (event.clientY ?? (r.top  + r.height/2)) - r.top;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = `${max}px`;
  s.style.left = `${x - max/2}px`;
  s.style.top  = `${y - max/2}px`;
  container.querySelector('.ripple')?.remove();
  container.appendChild(s);
  s.addEventListener('animationend', ()=>s.remove(), { once:true });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"'`=\/]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'
  }[c]));
}
function debounce(fn,wait=150){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}}
function safeGet(k){ try{ return localStorage.getItem(k); }catch{ return null; } }
function safeSet(k,v){ try{ localStorage.setItem(k,v); }catch{} }
function genIdFrom(ch,i){ return (ch.name?.toString().trim() || `ch-${i}`).toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9\-]/g,'') + '-' + i }
function isMobile(){ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) }
function scrollToPlayer(){
  const el = document.getElementById('player');
  const header = document.querySelector('header');
  const y = el.getBoundingClientRect().top + window.pageYOffset - ((header?.offsetHeight)||0) - 8;
  window.scrollTo({ top:y, behavior:'smooth' });
}
function showMobileToast(text){
  if (!isMobile()) return;
  let t = document.getElementById('mini-toast');
  if (!t){
    t = document.createElement('div');
    t.id = 'mini-toast';
    t.style.cssText = `
      position:absolute; left:50%; top:10px; transform:translateX(-50%);
      background:rgba(0,0,0,.65); color:#fff; padding:6px 10px; border-radius:8px;
      font-size:13px; font-weight:600; z-index:9; pointer-events:none; opacity:0; transition:opacity .18s ease`;
    const parent = document.getElementById('player');
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(t);
  }
  t.textContent = text;
  requestAnimationFrame(()=>{ t.style.opacity = '1'; });
  setTimeout(()=>{ t.style.opacity = '0'; }, 1500);
}

/* ------------------------ Icons (filled) ------------------------ */
function getIconSVG(n){
  const c='currentColor';
  switch(n){
    case 'ข่าว':     return `<svg viewBox="0 0 24 24" fill="${c}"><path d="M4 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a3 3 0 0 0 3 3H7a3 3 0 0 1-3-3V6zM8 8h6v2H8V8zm0 4h9v2H8v-2z"/></svg>`;
    case 'บันเทิง':  return `<svg viewBox="0 0 24 24" fill="${c}"><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.6L12 18.7 6.2 21l1.1-6.6-4.7-4.6 6.5-.9L12 3z"/></svg>`;
    case 'กีฬา':     return `<svg viewBox="0 0 24 24" fill="${c}"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 2a8 8 0 0 1 6.9 12.1A8 8 0 0 1 5.1 7.1 8 8 0 0 1 12 4z"/></svg>`;
    case 'สารคดี':   return `<svg viewBox="0 0 24 24" fill="${c}"><path d="M4 5a3 3 0 0 1 3-3h6v18H7a3 3 0 0 0-3 3V5zm10-3h3a3 3 0 0 1 3 3v18a3 3 0 0 0-3-3h-3V2z"/></svg>`;
    case 'เพลง':     return `<svg viewBox="0 0 24 24" fill="${c}"><path d="M14 3v8.8a3.2 3.2 0 1 1-2-3V7L6 8.5V17a3 3 0 1 1-2-2.83V6.9L14 3z"/></svg>`;
    case 'หนัง':     return `<svg viewBox="0 0 24 24" fill="${c}"><path d="M21 10v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7h18zM4.7 4.1l1.7 3.1h4.2L8.9 4.1h3.8l1.7 3.1h4.2L16.8 4.1H19a2 2 0 0 1 2 2v2H3V6.1a2 2 0 0 1 1.7-2z"/></svg>`;
    default:          return `<svg viewBox="0 0 24 24" fill="${c}"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
  }
}

/* ------------------------ Histats (top-right in header) ------------------------ */
function mountHistatsTopRight(){
  const anchor = document.querySelector('.h-wrap') || document.querySelector('header') || document.body;
  let holder = document.getElementById('histats_counter');
  if (!holder) { holder = document.createElement('div'); holder.id = 'histats_counter'; anchor.appendChild(holder); }
  else if (holder.parentElement !== anchor) { anchor.appendChild(holder); }

  window._Hasync = window._Hasync || [];
  window._Hasync.push(['Histats.startgif','1,4970267,4,10024,"div#histatsC {position: absolute; top:0; right:0;} body>div#histatsC {position: static;}"']);
  window._Hasync.push(['Histats.fasi','1']);
  window._Hasync.push(['Histats.track_hits','']);

  const hs = document.createElement('script'); hs.type='text/javascript'; hs.async=true; hs.src='//s10.histats.com/js15_giftop_as.js';
  (document.head || document.body).appendChild(hs);

  const move = ()=>{ const c=document.getElementById('histatsC'); if(c && !holder.contains(c)){ holder.appendChild(c); return; } requestAnimationFrame(move); };
  move();
}
