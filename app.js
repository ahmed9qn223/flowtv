/* ======================= app.js (final – stagger category switch) ======================= */
/* - JW Player (HLS/DASH + ClearKey) + no title overlay
   - Glass tabs, equal-size channel grid
   - Histats counter on right inside header (.h-wrap), mode 10024
   - Category switch effect: exit -> render -> enter with stagger
*/

const CHANNELS_URL = 'channels.json';
const TIMEZONE = 'Asia/Bangkok';
const TABS = ['ทั้งหมด','ข่าว','บันเทิง','กีฬา','สารคดี','เพลง'];

const SWITCH_OUT_MS = 140;   // ระยะเวลาช่วง "ออก"
const STAGGER_STEP_MS = 22;  // ดีเลย์ต่อใบตอน "เข้า"

// ใส่คีย์ถ้ายังไม่ได้ตั้งใน HTML
try { jwplayer.key = jwplayer.key || 'XSuP4qMl+9tK17QNb+4+th2Pm9AWgMO/cYH8CI0HGGr7bdjo'; } catch {}

let channels = [];
let currentFilter = 'ทั้งหมด';
let currentIndex = -1;
let scrollOnNextPlay = false;

document.addEventListener('DOMContentLoaded', init);

/* -------------------- INIT -------------------- */
function init(){
  // Clock
  const clockEl = document.getElementById('clock');
  function tick(){
    if(!clockEl) return;
    const now = new Date();
    clockEl.textContent = new Intl.DateTimeFormat('th-TH',{
      day:'2-digit', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      hour12:false, timeZone: TIMEZONE
    }).format(now).replace(',', '');
  }
  if(clockEl){ tick(); setInterval(tick,1000); }

  // Now Playing (ใต้เวลา)
  const oldSub = document.querySelector('.sub'); if (oldSub) oldSub.remove();
  let nowEl = document.getElementById('now-playing');
  if(!nowEl && clockEl && clockEl.parentNode){
    nowEl = document.createElement('div');
    nowEl.id = 'now-playing';
    nowEl.className = 'now-playing';
    nowEl.setAttribute('aria-live','polite');
    clockEl.after(nowEl);
  }
  window.__setNowPlaying = (name='')=>{
    if(!nowEl) return;
    nowEl.textContent = name;
    nowEl.title = name;
    nowEl.classList.remove('swap'); void nowEl.offsetWidth; nowEl.classList.add('swap');
  };

  // Histats ด้านขวาใน header
  mountHistatsTopRight();

  // Tabs
  enhanceTabButtons(); wireTabs(); centerTabsIfPossible();
  addEventListener('resize', debounce(centerTabsIfPossible,150));
  addEventListener('load', centerTabsIfPossible);

  // Load channels
  fetch(CHANNELS_URL,{cache:'no-store'})
    .then(r=>r.json())
    .then(data=>{
      channels = Array.isArray(data) ? data : (data.channels || []);
      render(); // first render (no enter anim)
      const start = Math.max(0, Math.min(channels.length-1, parseInt(localStorage.getItem('lastIndex')||'0',10)));
      if(channels.length) play(start,{scroll:false}); else window.__setNowPlaying('');
    })
    .catch(err=>{
      console.error('โหลด channels.json ไม่สำเร็จ:', err);
      const grid = document.getElementById('channel-list');
      if(grid) grid.innerHTML = `<div style="color:#fff;opacity:.85;text-align:center;padding:24px">โหลดรายการช่องไม่สำเร็จ</div>`;
    });
}

/* -------------------- TABS (Glass) -------------------- */
function enhanceTabButtons(){
  const root = document.getElementById('tabs'); if(!root) return;
  root.querySelectorAll('.tab').forEach(btn=>{
    if(btn.querySelector('.tab-card')) return;
    const label = (btn.textContent || btn.dataset.filter || '').trim();
    btn.innerHTML = `
      <span class="tab-card">
        <span class="tab-icon" aria-hidden="true">${getIconSVG(btn.dataset.filter)}</span>
        <span class="tab-label">${label}</span>
      </span>`;
  });
}
function wireTabs(){
  const root = document.getElementById('tabs'); if(!root) return;
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
  if(!TABS.includes(name)) name='ทั้งหมด';
  currentFilter = name;

  // ไฮไลต์แท็บ
  document.querySelectorAll('#tabs .tab').forEach(b=>{
    const sel = b.dataset.filter===name;
    b.setAttribute('aria-selected', sel ? 'true':'false');
    if(sel) b.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
  });

  const grid = document.getElementById('channel-list'); 
  if(!grid) return;

  // 1) เล่นเอฟเฟกต์ "ออก"
  grid.classList.add('switch-out');

  // 2) หลังจากออกเสร็จ -> render ใหม่ + เล่น "เข้า"
  setTimeout(()=>{
    grid.classList.remove('switch-out');
    render({ withEnter:true });
  }, SWITCH_OUT_MS);
}
function centerTabsIfPossible(){
  const el = document.getElementById('tabs'); if(!el) return;
  el.classList.toggle('tabs--center', el.scrollWidth <= el.clientWidth + 1);
}
function getIconSVG(n){
  const s='currentColor', w=2;
  switch(n){
    case 'ทั้งหมด': return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" fill="${s}"/><rect x="14" y="3" width="7" height="7" rx="1" fill="${s}"/><rect x="3" y="14" width="7" height="7" rx="1" fill="${s}"/><rect x="14" y="14" width="7" height="7" rx="1" fill="${s}"/></svg>`;
    case 'ข่าว': return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="14" height="14" rx="2" stroke="${s}" stroke-width="${w}"/><path d="M7 9h8M7 13h8M7 17h8" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
    case 'บันเทิง': return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 4l2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8-5.3 2.8 1-6L3.3 10.4l6-.9L12 4z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/></svg>`;
    case 'กีฬา': return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="${s}" stroke-width="${w}"/><path d="M3 12h18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 1 0 18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 0 0 18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
    case 'สารคดี': return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h7a3 3 0 0 1 3 3v11H7a3 3 0 0 0-3 3V6z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/><path d="M13 6h7a3 3 0 0 1 3 3v11h-7a3 3 0 0 0-3 3V6z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/></svg>`;
    case 'เพลง': return `<svg viewBox="0 0 24 24" fill="none"><path d="M14 4v9.5a2.5 2.5 0 1 1-2-2.45V8l-4 1v7a2 2 0 1 1-2-2V8.5l8-2.5Z" fill="${s}"/></svg>`;
    default: return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="${s}" stroke-width="${w}"/></svg>`;
  }
}
function debounce(fn,wait=150){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}}

/* -------------------- DATA / FILTER -------------------- */
function filterChannels(list, tab){
  if(tab==='ทั้งหมด') return list;
  return list.filter(ch => (ch.category || guessCategory(ch)) === tab);
}
function guessCategory(ch){
  const s=(ch.name||'').toLowerCase();
  if (/(ข่าว|tnn|nation|thairath|nbt|pbs|jkn|spring|voice)/.test(s)) return 'ข่าว';
  if (/(sport|กีฬา|t\s?sports|3bb\s?sports|bein|true\s?sport|pptv\s?hd\s?36)/.test(s)) return 'กีฬา';
  if (/(สารคดี|discovery|animal|nat.?geo|history|documentary|bbc earth|cgnc)/.test(s)) return 'สารคดี';
  if (/(เพลง|music|mtv|channel\s?v|music\s?hits)/.test(s)) return 'เพลง';
  return 'บันเทิง';
}

/* -------------------- RENDER GRID (with stagger) -------------------- */
function render(opt={withEnter:false}){
  const wrap = document.getElementById('channel-list'); 
  if(!wrap) return;

  const list = filterChannels(channels, currentFilter);
  wrap.innerHTML = '';

  // คอลัมน์คร่าว ๆ เพื่อคำนวณดีเลย์แบบทแยง
  const cols = computeGridCols(wrap);

  list.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'channel';
    btn.title = ch.name || 'ช่อง';
    btn.dataset.globalIndex = String(channels.indexOf(ch));
    btn.innerHTML = `
      <div class="ch-card">
        <div class="logo-wrap">
          <img class="logo" loading="lazy" decoding="async"
               src="${escapeHtml(ch.logo||'')}"
               alt="${escapeHtml(ch.name||'โลโก้ช่อง')}">
        </div>
        <div class="name">${escapeHtml(ch.name||'ช่อง')}</div>
      </div>`;

    // ripple + เล่นช่อง
    btn.addEventListener('click', e=>{
      makeRipple(e, btn.querySelector('.ch-card'));
      scrollOnNextPlay = true;
      playByChannel(ch);
    });

    // order ดีเลย์แบบ wave-diagonal
    const row = Math.floor(i / Math.max(cols,1));
    const col = i % Math.max(cols,1);
    const order = row + col;
    btn.style.setProperty('--i', order);

    wrap.appendChild(btn);
  });

  // กำหนด stagger ต่อใบ
  wrap.style.setProperty('--stagger', `${STAGGER_STEP_MS}ms`);

  // เล่น "เข้า" ถ้าระบุ
  if(opt.withEnter){
    wrap.classList.add('switch-in');
    // คำนวณเวลาสูงสุดแบบคร่าว ๆ แล้วลบคลาสออก เพื่อครั้งต่อไปจะเล่นได้อีก
    const maxOrder = Math.max(...Array.from(wrap.children).map(el => +getComputedStyle(el).getPropertyValue('--i') || 0), 0);
    const total = (maxOrder * STAGGER_STEP_MS) + 420;
    setTimeout(()=> wrap.classList.remove('switch-in'), Math.min(total, 1200));
  }

  highlight(currentIndex);
}
function computeGridCols(container){
  const cs = getComputedStyle(document.documentElement);
  const tileW = parseFloat(cs.getPropertyValue('--tile-w')) || parseFloat(cs.getPropertyValue('--tile-min')) || 110;
  const gap   = parseFloat(cs.getPropertyValue('--tile-g')) || 10;
  const fullW = container.clientWidth;
  return Math.max(1, Math.floor((fullW + gap) / (tileW + gap)));
}

/* -------------------- PLAYER (no title overlay) -------------------- */
function playByChannel(ch){
  const i = channels.indexOf(ch);
  if(i>=0) play(i);
}
function play(i, opt={scroll:true}){
  const ch = channels[i]; if(!ch) return;
  currentIndex = i;

  const player = jwplayer('player').setup({
    playlist:[{
      image: ch.poster || ch.logo || undefined,
      sources: [buildSource(ch)]
    }],
    width:'100%',
    aspectratio:'16:9',
    autostart:true,
    mute:/iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    preload:'metadata',
    playbackRateControls:true,
    displaytitle:false,
    displaydescription:false
  });

  player.once('playAttemptFailed',()=>{ player.setMute(true); player.play(true); });
  player.on('error', e=>console.warn('Player error:', e));

  window.__setNowPlaying(ch.name || '');
  highlight(i);
  try{ localStorage.setItem('lastIndex', String(i)); }catch{}

  if((opt.scroll ?? true) && scrollOnNextPlay){ scrollToPlayer(); scrollOnNextPlay=false; }
}

/* ---- Build JW Source ---- */
function buildSource(ch){
  const url = buildUrlWithProxyIfNeeded(ch);
  const t = (ch.type || detectType(url) || 'auto').toLowerCase();
  const src = { file:url };
  if(t==='dash'){
    src.type='dash';
    const ck = ch.drm?.clearkey || (ch.keyId && ch.key ? {keyId:ch.keyId, key:ch.key} : null);
    if(ck?.keyId && ck?.key) src.drm = { clearkey:{ keyId:ck.keyId, key:ck.key } };
  }else if(t==='hls'){ src.type='hls'; }
  return src;
}
function detectType(u){
  const p=(u||'').split('?')[0].toLowerCase();
  if(p.endsWith('.m3u8')) return 'hls';
  if(p.endsWith('.mpd'))  return 'dash';
  return 'auto';
}
function buildUrlWithProxyIfNeeded(ch){
  const raw = ch.src || ch.file || '';
  if (window.PROXY_BASE && ch.proxy){
    const payload = { src: raw, referrer: ch.referrer||'', ua: ch.ua||'', headers: ch.headers||{} };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return `${window.PROXY_BASE}/p/${b64}`;
  }
  return raw;
}

/* -------------------- UI HELPERS -------------------- */
function makeRipple(event, container){
  if(!container) return;
  const r = container.getBoundingClientRect();
  const max = Math.max(r.width, r.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${max}px`;
  ripple.style.left = `${event.clientX - r.left - max/2}px`;
  ripple.style.top  = `${event.clientY - r.top  - max/2}px`;
  const old = container.querySelector('.ripple'); if(old) old.remove();
  container.appendChild(ripple);
  ripple.addEventListener('animationend', ()=>ripple.remove(), { once:true });
}
function scrollToPlayer(){
  const el = document.getElementById('player');
  const header = document.querySelector('header');
  const y = el.getBoundingClientRect().top + window.pageYOffset - ((header?.offsetHeight)||0) - 8;
  window.scrollTo({ top:y, behavior:'smooth' });
}
function highlight(globalIndex){
  document.querySelectorAll('.channel').forEach(el=>{
    const idx = Number(el.dataset.globalIndex);
    el.classList.toggle('active', idx === globalIndex);
    el.setAttribute('aria-pressed', idx === globalIndex ? 'true':'false');
  });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"'`=\/]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'
  }[c]));
}

/* -------------------- HISTATS (RIGHT in header) -------------------- */
function mountHistatsTopRight(){
  // ใช้ .h-wrap เป็น anchor ให้ชิดขวาใน header (อยู่แถวเดียวกับเวลา)
  const anchor = document.querySelector('.h-wrap') ||
                 document.querySelector('header') ||
                 document.body;

  let holder = document.getElementById('histats_counter');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'histats_counter';
    anchor.appendChild(holder);
  } else if (holder.parentElement !== anchor) {
    anchor.appendChild(holder);
  }

  // ใช้โหมด 10024 (ริบบอนขวา) และบังคับไม่ให้สคริปต์ fixed ทั้งหน้า
  window._Hasync = window._Hasync || [];
  window._Hasync.push([
    'Histats.startgif',
    '1,4970267,4,10024,"div#histatsC {position: absolute; top:0; right:0;} body>div#histatsC {position: static;}"'
  ]);
  window._Hasync.push(['Histats.fasi','1']);
  window._Hasync.push(['Histats.track_hits','']);

  const hs = document.createElement('script');
  hs.type = 'text/javascript';
  hs.async = true;
  hs.src = '//s10.histats.com/js15_giftop_as.js';
  (document.head || document.body).appendChild(hs);

  // ย้าย #histatsC (ที่สคริปต์สร้าง) เข้าไปอยู่ใน holder ของเรา
  const move = () => {
    const c = document.getElementById('histatsC');
    if (c && !holder.contains(c)) { holder.appendChild(c); return; }
    requestAnimationFrame(move);
  };
  move();
}
