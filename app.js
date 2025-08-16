/* ======================= app.js (no "ทั้งหมด" + add "หนัง") ======================= */
const CHANNELS_URL = 'channels.json';
const TIMEZONE = 'Asia/Bangkok';

/* ลำดับแท็บใหม่: ไม่มี "ทั้งหมด" */
const TABS = ['ข่าว', 'บันเทิง', 'กีฬา', 'สารคดี', 'เพลง', 'หนัง'];

const SWITCH_OUT_MS = 140;
const STAGGER_STEP_MS = 22;

try { jwplayer.key = jwplayer.key || 'XSuP4qMl+9tK17QNb+4+th2Pm9AWgMO/cYH8CI0HGGr7bdjo'; } catch {}

let channels = [];
let currentFilter = TABS[0];
let currentIndex = -1;
let scrollOnNextPlay = false;

document.addEventListener('DOMContentLoaded', init);

function init(){
  // clock
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

  // now playing text (ใต้เวลา)
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

  // Histats badge (ขวาบน)
  mountHistatsTopRight();

  // สร้างแท็บใหม่จาก TABS (ล้างของเดิม -> ไม่มี "ทั้งหมด")
  buildTabs();
  centerTabsIfPossible();
  addEventListener('resize', debounce(centerTabsIfPossible,150));
  addEventListener('load', centerTabsIfPossible);

  // โหลดช่อง
  fetch(CHANNELS_URL,{cache:'no-store'})
    .then(r=>r.json())
    .then(data=>{
      channels = Array.isArray(data) ? data : (data.channels || []);
      setActiveTab(TABS[0]); // โชว์แท็บแรก
      const start = Math.max(0, Math.min(channels.length-1, parseInt(localStorage.getItem('lastIndex')||'0',10)));
      if(channels.length) play(start,{scroll:false}); else window.__setNowPlaying('');
    })
    .catch(err=>{
      console.error('โหลด channels.json ไม่สำเร็จ:', err);
      const grid = document.getElementById('channel-list');
      if(grid) grid.innerHTML = `<div style="color:#fff;opacity:.85;text-align:center;padding:24px">โหลดรายการช่องไม่สำเร็จ</div>`;
    });
}

/* ---------- Tabs ---------- */
function buildTabs(){
  const root = document.getElementById('tabs'); if(!root) return;
  root.innerHTML = '';
  TABS.forEach(name=>{
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.filter = name;
    btn.setAttribute('aria-selected','false');
    btn.innerHTML = `
      <span class="tab-card">
        <span class="tab-icon" aria-hidden="true">${getIconSVG(name)}</span>
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
  if(!TABS.includes(name)) name = TABS[0];
  currentFilter = name;

  const root = document.getElementById('tabs');
  root.querySelectorAll('.tab').forEach(b=>{
    const sel = b.dataset.filter===name;
    b.setAttribute('aria-selected', sel ? 'true':'false');
    if(sel) b.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
  });

  const grid = document.getElementById('channel-list'); 
  if(!grid) return;
  grid.classList.add('switch-out');
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
    case 'ข่าว': return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="14" height="14" rx="2" stroke="${s}" stroke-width="${w}"/><path d="M7 9h8M7 13h8M7 17h8" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
    case 'บันเทิง': return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 4l2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8-5.3 2.8 1-6L3.3 10.4l6-.9L12 4z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/></svg>`;
    case 'กีฬา': return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="${s}" stroke-width="${w}"/><path d="M3 12h18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 1 0 18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 0 0 18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
    case 'สารคดี': return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h7a3 3 0 0 1 3 3v11H7a3 3 0 0 0-3 3V6z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/><path d="M13 6h7a3 3 0 0 1 3 3v11h-7a3 3 0 0 0-3 3V6z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/></svg>`;
    case 'เพลง': return `<svg viewBox="0 0 24 24" fill="none"><path d="M14 4v9.5a2.5 2.5 0 1 1-2-2.45V8l-4 1v7a2 2 0 1 1-2-2V8.5l8-2.5Z" fill="${s}"/></svg>`;
    case 'หนัง': return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="${s}" stroke-width="${w}"/><path d="M7 6v12M17 6v12" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
    default: return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="${s}" stroke-width="${w}"/></svg>`;
  }
}
function debounce(fn,wait=150){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}}

/* ---------- Filter & Category guess ---------- */
function filterChannels(list, tab){
  // คืนเฉพาะหมวดที่เลือก
  return list.filter(ch => (ch.category || guessCategory(ch)) === tab);
}

function guessCategory(ch){
  const s = `${ch.name||''} ${ch.logo||''}`.toLowerCase();
  const src = (ch.src || ch.file || '').toLowerCase();

  // ===== หนัง =====
  // ชื่อ/โลโก้ที่พบบ่อย
  if (/(^|\s)(hbo|cinemax|mono\s?29\s?plus|mono29plus|3bb\s?asian|movie|movies|film|true\s?film|signature|hits|family)(\s|$)/.test(s))
    return 'หนัง';
  // ช่องตัวเลขที่เป็นหนัง: 101, 103–107, 109
  if (/(\/101\/|\/103\/|\/104\/|\/105\/|\/106\/|\/107\/|\/109\/)/.test(src)) return 'หนัง';
  // ไฟล์โลโก้ที่มักเป็นหนัง (เช่น R_0148/0149/0150/0151/0147)
  if (/(r_0148|0149|0150|0151|0147)/.test(s)) return 'หนัง';

  // ===== ข่าว =====
  if (/(ข่าว|tnn|nation|thairath|nbt|pbs|jkn|workpoint\s?news)/.test(s)) return 'ข่าว';

  // ===== กีฬา =====
  if (/(sport|กีฬา|t\s?sports|3bb\s?sports|bein|true\s?sport|pptv\s?hd\s?36)/.test(s)) return 'กีฬา';

  // ===== สารคดี =====
  if (/(สารคดี|discovery|animal|nat.?geo|history|documentary|bbc\s?earth)/.test(s)) return 'สารคดี';

  // ===== เพลง =====
  if (/(เพลง|music|mtv|channel\s?v|music\s?hits)/.test(s)) return 'เพลง';

  // อื่น ๆ จัดเข้าบันเทิง
  return 'บันเทิง';
}

/* ---------- Render Grid ---------- */
function render(opt={withEnter:false}){
  const wrap = document.getElementById('channel-list'); 
  if(!wrap) return;

  const list = filterChannels(channels, currentFilter);
  wrap.innerHTML = '';

  const cols = computeGridCols(wrap);

  list.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'channel';
    btn.title = ch.name || 'ช่อง';

    const cat = (ch.category || guessCategory(ch));
    btn.dataset.category = cat;                           // ใช้ styling เฉพาะหมวด
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

    btn.addEventListener('click', e=>{
      makeRipple(e, btn.querySelector('.ch-card'));
      scrollOnNextPlay = true;
      playByChannel(ch);
    });

    const row = Math.floor(i / Math.max(cols,1));
    const col = i % Math.max(cols,1);
    const order = row + col;
    btn.style.setProperty('--i', order);

    wrap.appendChild(btn);
  });

  wrap.style.setProperty('--stagger', `${STAGGER_STEP_MS}ms`);

  if(opt.withEnter){
    wrap.classList.add('switch-in');
    const maxOrder = Math.max(...Array.from(wrap.children).map(el => +getComputedStyle(el).getPropertyValue('--i') || 0), 0);
    const total = (maxOrder * STAGGER_STEP_MS) + 420;
    setTimeout(()=> wrap.classList.remove('switch-in'), Math.min(total, 1200));
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

/* ---------- Player ---------- */
function playByChannel(ch){ const i = channels.indexOf(ch); if(i>=0) play(i); }
function play(i, opt={scroll:true}){
  const ch = channels[i]; if(!ch) return;
  currentIndex = i;

  const player = jwplayer('player').setup({
    playlist:[{ image: ch.poster || ch.logo || undefined, sources: [buildSource(ch)] }],
    width:'100%', aspectratio:'16:9', autostart:true,
    mute:/iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    preload:'metadata', playbackRateControls:true,
    displaytitle:false, displaydescription:false
  });

  player.once('playAttemptFailed',()=>{ player.setMute(true); player.play(true); });
  player.on('error', e=>console.warn('Player error:', e));

  window.__setNowPlaying(ch.name || '');
  highlight(i);
  try{ localStorage.setItem('lastIndex', String(i)); }catch{}

  if((opt.scroll ?? true) && scrollOnNextPlay){ scrollToPlayer(); scrollOnNextPlay=false; }
}
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
function detectType(u){ u=(u||'').split('?')[0].toLowerCase(); if(u.endsWith('.m3u8'))return'hls'; if(u.endsWith('.mpd'))return'dash'; return'auto'; }
function buildUrlWithProxyIfNeeded(ch){
  const raw = ch.src || ch.file || '';
  if (window.PROXY_BASE && ch.proxy){
    const payload = { src: raw, referrer: ch.referrer||'', ua: ch.ua||'', headers: ch.headers||{} };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return `${window.PROXY_BASE}/p/${b64}`;
  }
  return raw;
}

/* ---------- UI helpers ---------- */
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

/* ---------- Histats in header ---------- */
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
