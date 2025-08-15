// ===== Config =====
const CHANNELS_URL = 'channels.json';
const TIMEZONE = 'Asia/Bangkok';
jwplayer.key = 'XSuP4qMl+9tK17QNb+4+th2Pm9AWgMO/cYH8CI0HGGr7bdjo';

// Tabs
const TABS = ['ทั้งหมด','ข่าว','บันเทิง','กีฬา','สารคดี','เพลง'];
let currentFilter = 'ทั้งหมด';

// ===== State =====
let channels = [];
let currentIndex = -1;
let scrollOnNextPlay = false;

// ===== Clock =====
const clockEl = document.getElementById('clock');
function tick(){
  const now = new Date();
  clockEl.textContent = new Intl.DateTimeFormat('th-TH',{
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hour12:false, timeZone: TIMEZONE
  }).format(now).replace(',', '');
}
tick(); setInterval(tick,1000);

// optional: Now Playing element under clock (if in DOM)
let nowPlayingEl = document.getElementById('now-playing');
if (!nowPlayingEl && clockEl && clockEl.parentNode) {
  nowPlayingEl = document.createElement('div');
  nowPlayingEl.id = 'now-playing';
  nowPlayingEl.className = 'now-playing';
  nowPlayingEl.setAttribute('aria-live','polite');
  clockEl.after(nowPlayingEl);
}
function setNowPlaying(name){
  if(!nowPlayingEl) return;
  nowPlayingEl.textContent = name || '';
  nowPlayingEl.title = name || '';
  nowPlayingEl.classList.remove('swap'); void nowPlayingEl.offsetWidth;
  nowPlayingEl.classList.add('swap');
}

// ===== Load channels =====
fetch(CHANNELS_URL,{cache:'no-store'})
  .then(r=>r.json())
  .then(data=>{
    channels = Array.isArray(data) ? data : (data.channels || []);

    enhanceTabButtons();      // build colorful icon tiles
    wireTabs();               // events & keyboard
    centerTabsIfPossible();   // center if they fit
    render();

    const start = Math.max(0, Math.min(channels.length-1, parseInt(localStorage.getItem('lastIndex')||'0',10)));
    if (channels.length) play(start,{scroll:false}); else setNowPlaying('');
  })
  .catch(e=>{
    console.error('โหลด channels.json ไม่สำเร็จ:', e);
    alert('โหลดรายการช่องไม่สำเร็จ ตรวจสอบไฟล์ channels.json และ CORS');
  });

// ===== Build colorful icon tabs =====
function enhanceTabButtons(){
  const tabsRoot = document.getElementById('tabs');
  if(!tabsRoot) return;
  tabsRoot.querySelectorAll('.tab').forEach(btn=>{
    if (btn.querySelector('.tab-card')) return; // already enhanced
    const label = (btn.textContent || btn.dataset.filter || '').trim();
    btn.innerHTML = `
      <span class="tab-card">
        <span class="tab-icon" aria-hidden="true">${getIconSVG(btn.dataset.filter)}</span>
        <span class="tab-label">${label}</span>
      </span>`;
  });
}

function getIconSVG(name){
  const stroke = 'currentColor';
  const sw = 2;
  switch (name) {
    case 'ทั้งหมด': // grid
      return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" fill="${stroke}"/><rect x="14" y="3" width="7" height="7" rx="1" fill="${stroke}"/><rect x="3" y="14" width="7" height="7" rx="1" fill="${stroke}"/><rect x="14" y="14" width="7" height="7" rx="1" fill="${stroke}"/></svg>`;
    case 'ข่าว': // newspaper
      return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="14" height="14" rx="2" stroke="${stroke}" stroke-width="${sw}"/><path d="M7 9h8M7 13h8M7 17h8" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
    case 'บันเทิง': // star
      return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 4l2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8-5.3 2.8 1-6L3.3 10.4l6-.9L12 4z" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/></svg>`;
    case 'กีฬา': // ball
      return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="${stroke}" stroke-width="${sw}"/><path d="M3 12h18" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 1 0 18" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 0 0 18" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
    case 'สารคดี': // book
      return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h7a3 3 0 0 1 3 3v11H7a3 3 0 0 0-3 3V6z" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/><path d="M13 6h7a3 3 0 0 1 3 3v11h-7a3 3 0 0 0-3 3V6z" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/></svg>`;
    case 'เพลง': // music note
      return `<svg viewBox="0 0 24 24" fill="none"><path d="M14 4v9.5a2.5 2.5 0 1 1-2-2.45V8l-4 1v7a2 2 0 1 1-2-2V8.5l8-2.5Z" fill="${stroke}"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  }
}

// ===== Tabs: events & accessibility =====
function wireTabs(){
  const tabsRoot = document.getElementById('tabs');
  if(!tabsRoot) return;

  // Click to switch
  tabsRoot.addEventListener('click', (e)=>{
    const btn = e.target.closest('.tab'); if(!btn) return;
    setActiveTab(btn.dataset.filter);
  });

  // Arrow key navigation (L/R)
  tabsRoot.addEventListener('keydown', (e)=>{
    if(e.key!=='ArrowRight' && e.key!=='ArrowLeft') return;
    const arr = Array.from(tabsRoot.querySelectorAll('.tab'));
    const idx = arr.findIndex(b=>b.getAttribute('aria-selected')==='true');
    let next = e.key==='ArrowRight' ? idx+1 : idx-1;
    if(next<0) next = arr.length-1;
    if(next>=arr.length) next = 0;
    arr[next].focus();
    setActiveTab(arr[next].dataset.filter);
    e.preventDefault();
  });
}

function setActiveTab(name){
  if(!TABS.includes(name)) name = 'ทั้งหมด';
  currentFilter = name;

  // ARIA + scroll to center
  document.querySelectorAll('#tabs .tab').forEach(btn=>{
    const sel = btn.dataset.filter===name;
    btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    if(sel) btn.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
  });

  // re-render with grid fade
  const grid = document.getElementById('channel-list');
  grid.classList.remove('fade-in'); void grid.offsetWidth;
  render();
  grid.classList.add('fade-in');
}

// ===== Center tabs only when they don't overflow =====
function centerTabsIfPossible(){
  const el = document.getElementById('tabs');
  if (!el) return;
  const canCenter = el.scrollWidth <= el.clientWidth + 1;
  el.classList.toggle('tabs--center', canCenter);
}
function debounce(fn, wait=150){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
window.addEventListener('load', centerTabsIfPossible);
window.addEventListener('resize', debounce(centerTabsIfPossible, 150));

// ===== Filtering =====
function filterChannels(list, tab){
  if(tab==='ทั้งหมด') return list;
  return list.filter(ch => (ch.category || guessCategory(ch)) === tab);
}
function guessCategory(ch){
  const s = (ch.name||'').toLowerCase();
  if (/(ข่าว|tnn|nation|thairath|thairat|nbt|pbs|jkn|spring|voice)/.test(s)) return 'ข่าว';
  if (/(sport|กีฬา|t\s?sports|3bb\s?sports|bein|true\s?sport|pptv\s?hd\s?36)/.test(s)) return 'กีฬา';
  if (/(สารคดี|discovery|animal|nat.?geo|history|documentary|bbc earth|cgnc)/.test(s)) return 'สารคดี';
  if (/(เพลง|music|mtv|channel\s?v|music\s?hits)/.test(s)) return 'เพลง';
  return 'บันเทิง';
}

// ===== Render grid =====
function render(){
  const wrap = document.getElementById('channel-list');
  const list = filterChannels(channels, currentFilter);
  wrap.innerHTML = '';

  list.forEach((ch) => {
    const btn = document.createElement('button');
    btn.className = 'channel';
    btn.title = ch.name || 'ช่อง';
    btn.dataset.globalIndex = String(channels.indexOf(ch));

    btn.innerHTML = `
      <div class="card">
        <div class="logo-wrap">
          <img class="logo" loading="lazy" decoding="async"
               src="${escapeHtml(ch.logo||'')}"
               alt="${escapeHtml(ch.name||'โลโก้ช่อง')}">
        </div>
        <div class="name">${escapeHtml(ch.name||'ช่อง')}</div>
      </div>`;

    btn.addEventListener('click', (e) => {
      makeRipple(e, btn.querySelector('.card'));
      scrollOnNextPlay = true;
      playByChannel(ch);
    });

    wrap.appendChild(btn);
  });

  highlight(currentIndex);
}

// ===== Play helpers =====
function playByChannel(ch){
  const idx = channels.indexOf(ch);
  if (idx >= 0) play(idx);
}
function play(i, opt={scroll:true}){
  const ch = channels[i]; if(!ch) return;
  currentIndex = i;

  const source = buildSource(ch);
  const player = jwplayer('player').setup({
    playlist:[{ title: ch.name||'', image: ch.poster||ch.logo||undefined, sources:[source]}],
    width:'100%', aspectratio:'16:9', autostart:true,
    mute:/iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    preload:'metadata', playbackRateControls:true
  });

  player.once('playAttemptFailed',()=>{ player.setMute(true); player.play(true); });
  player.on('error', e => console.warn('Player error:', e));

  setNowPlaying(ch.name || '');

  highlight(i);
  try{ localStorage.setItem('lastIndex', String(i)); }catch{}

  if ((opt.scroll ?? true) && scrollOnNextPlay) {
    scrollToPlayer();
    scrollOnNextPlay = false;
  }
}

// ===== JW source builders =====
function buildSource(ch){
  const url = buildUrlWithProxyIfNeeded(ch);
  const t = (ch.type || detectType(url) || 'auto').toLowerCase();
  const src = { file: url };
  if (t === 'dash'){
    src.type = 'dash';
    const ck = ch.drm?.clearkey || (ch.keyId && ch.key ? { keyId: ch.keyId, key: ch.key } : null);
    if (ck?.keyId && ck?.key) src.drm = { clearkey: { keyId: ck.keyId, key: ck.key } };
  } else if (t === 'hls'){ src.type = 'hls'; }
  return src;
}
function detectType(u){
  const p = (u||'').split('?')[0].toLowerCase();
  if (p.endsWith('.m3u8')) return 'hls';
  if (p.endsWith('.mpd'))  return 'dash';
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

// ===== UI helpers =====
function makeRipple(event, container){
  if(!container) return;
  const rect = container.getBoundingClientRect();
  const max = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${max}px`;
  ripple.style.left = `${event.clientX - rect.left - max/2}px`;
  ripple.style.top  = `${event.clientY - rect.top  - max/2}px`;
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
