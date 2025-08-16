/* ========= Utils ========= */
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

/* ========= Header clock ========= */
function startClock() {
  const el = $('#clock');
  if (!el) return;
  const fmt = (n)=> n.toString().padStart(2,'0');
  const tick = () => {
    const d = new Date();
    const th = new Intl.DateTimeFormat('th-TH', {
      year:'numeric', month:'short', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      hour12:false, timeZone:'Asia/Bangkok'
    }).format(d).replace(/\s+/g,' ');
    el.textContent = th.replace(',', '');
  };
  tick(); setInterval(tick, 1000);
}
startClock();

/* ========= Now Playing text (ใต้เวลา) ========= */
function ensureNowPlayingEl(){
  let el = $('#now-playing');
  if (!el) {
    el = document.createElement('div');
    el.id = 'now-playing';
    $('.h-wrap')?.appendChild(el);
  }
  return el;
}

/* ========= JW Player helpers ========= */
function destroyPlayerSafely() {
  try {
    const p = window.jwplayer && jwplayer('player');
    if (!p || typeof p.getState !== 'function') return;
    try { p.pause(true); } catch(_) {}
    try { p.stop(); } catch(_) {}
    try { p.remove(); } catch(_) {}
  } catch (_) {}
}

function setupJW(cfg) {
  destroyPlayerSafely();

  const base = {
    width: '100%',
    aspectratio: '16:9',
    autostart: true,
    mute: false,
    controls: true,
    preload: 'metadata',
    cast: false,
    enableStartupScreenshot: false
  };

  const player = jwplayer('player').setup({ ...base, ...cfg });

  // error guard
  player.on('error', e => {
    console.warn('JW error:', e);
    showNotice('ไม่สามารถเล่นสตรีมนี้ได้ (อาจติด CORS/สิทธิ์ DRM/สตรีมล่ม)', 'error');
  });

  // โชว์ชื่อช่องเล็ก ๆ บนวิดีโอ (มือถือด้วย)
  const toast = getToast();
  player.on('play', () => {
    if (currentChannel) showToast(toast, currentChannel.name);
  });

  return player;
}

/* ========= Toast บนวิดีโอ ========= */
function getToast() {
  let t = $('#mini-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'mini-toast';
    $('#player').appendChild(t);
  }
  return t;
}
function showToast(el, text) {
  el.textContent = text || '';
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ========= Notice (ถ้ามีโซน .notice-host) ========= */
function showNotice(text, type='info') {
  const host = $('.notice-host');
  if (!host) return;
  host.innerHTML = `<div class="notice notice--${type}">${text}</div>`;
  setTimeout(()=>{ if (host.firstChild) host.firstChild.style.opacity=.85; }, 0);
}

/* ========= Channels ========= */
let channels = [];
let currentPlayer = null;
let currentChannel = null;

async function loadChannels() {
  // หากมี version.json จะใช้ค่าอัปเดตมา bust cache
  let v = '';
  try {
    const vr = await fetch('version.json', { cache:'no-store' });
    if (vr.ok) {
      const j = await vr.json();
      v = '?v=' + encodeURIComponent(j.updatedAt || j.commit || Date.now());
    }
  } catch(_) {}
  const res = await fetch('channels.json' + v, { cache:'no-store' });
  channels = await res.json().then(j => j.channels || j);
}

function renderGrid(list) {
  const grid = $('#channel-list');
  if (!grid) return;

  grid.innerHTML = '';
  (list || channels).forEach((ch, idx) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'channel';
    item.dataset.idx = idx;
    if (ch.category) item.dataset.category = ch.category;

    item.innerHTML = `
      <div class="ch-card">
        <img loading="lazy" src="${ch.logo}" alt="${ch.name}">
        <div class="ch-name">${ch.name}</div>
      </div>
    `;

    // คลิก = ripple + เปลี่ยนสถานะ + เล่น
    item.addEventListener('click', (e) => {
      makeRipple(item, e);
      setPlaying(item);
      playChannel(ch);
    }, { passive:true });

    grid.appendChild(item);
  });
}

function setPlaying(cardEl){
  $$('.channel.playing').forEach(el => el.classList.remove('playing'));
  cardEl.classList.add('playing');
}

/* ripple ตามตำแหน่งคลิก */
function makeRipple(card, e){
  const r = card.getBoundingClientRect();
  const cx = (e.touches?.[0]?.clientX ?? e.clientX ?? (r.left + r.width/2));
  const cy = (e.touches?.[0]?.clientY ?? e.clientY ?? (r.top + r.height/2));
  const x = ((cx - r.left) / r.width) * 100;
  const y = ((cy - r.top)  / r.height) * 100;
  card.style.setProperty('--x', `${x}%`);
  card.style.setProperty('--y', `${y}%`);
  card.classList.add('pressed');
  setTimeout(() => card.classList.remove('pressed'), 420);
}

function playChannel(ch){
  currentChannel = ch;
  ensureNowPlayingEl().textContent = ch?.name || '';

  const cfg = {
    file: ch.src || ch.file,
    type: ch.type || 'dash'
  };
  if (ch.drm) cfg.drm = ch.drm;

  currentPlayer = setupJW(cfg);
}

/* ========= Tabs (ตัวกรอง – มีหรือไม่มีใน HTML ก็ได้) ========= */
function initTabs(){
  const tabs = $$('#tabs .tab');
  if (!tabs.length) return;

  const grid = $('#channel-list');
  const apply = (label) => {
    grid.classList.add('filtering');
    if (!label || label === 'ทั้งหมด') {
      renderGrid(channels);
    } else {
      const filtered = channels.filter(c => c.category === label || c.tags?.includes(label));
      renderGrid(filtered.length ? filtered : channels);
    }
    setTimeout(()=>grid.classList.remove('filtering'), 180);
  };

  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabs.forEach(b=>b.setAttribute('aria-selected','false'));
      btn.setAttribute('aria-selected','true');
      apply(btn.dataset.filter || btn.textContent.trim());
    });
  });
}

/* ========= Bootstrap ========= */
(async function main(){
  try {
    await loadChannels();
    renderGrid(channels);
    initTabs();
    // เล่นช่องแรก
    const first = $('.channel');
    if (first) {
      setPlaying(first);
      playChannel(channels[parseInt(first.dataset.idx,10)]);
    }
  } catch (err) {
    console.error(err);
    showNotice('โหลดรายการช่องไม่สำเร็จ', 'error');
  }
})();
