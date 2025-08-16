/* =========================================================
   FLOWTV • app.js (final)
   - อ่านข้อมูลจาก channels.json หรือ window.__CHANNELS__
   - สร้างแท็บหมวดหมู่อัตโนมัติ (ไม่มี "ทั้งหมด")
   - ช่องขนาดคงที่, ripple, glow, mobile toast, remember last
   - JW Player + ClearKey DRM (ปิด advertising เพื่อกัน error)
========================================================= */

const $ = (id) => document.getElementById(id);
const el = {
  tabs:   $('tabs'),
  grid:   $('channel-list'),
  player: $('player'),
  clock:  $('clock'),
  now:    $('now-playing') // ถ้ามีในหน้า
};

let CHANNELS = [];
let activeCat = null;
let jw = null;
let miniToast;

/* ---------- Clock ---------- */
(function startClock() {
  if (!el.clock) return;
  const fmt = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour12: false,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const tick = () => (el.clock.textContent = fmt.format(new Date()));
  tick(); setInterval(tick, 1000);
})();

/* ---------- Load channels ---------- */
async function loadChannels() {
  if (window.__CHANNELS__?.channels?.length) {
    return window.__CHANNELS__.channels;
  }
  const res = await fetch('channels.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('โหลด channels.json ไม่สำเร็จ');
  const data = await res.json();
  return data.channels || [];
}

/* ---------- Tabs ---------- */
function buildTabs(categories) {
  el.tabs.innerHTML = '';
  // เรียงตามความคุ้นเคย
  const order = ['ข่าว','บันเทิง','กีฬา','สารคดี','เพลง','หนัง'];
  categories.sort((a,b)=> order.indexOf(a) - order.indexOf(b));

  categories.forEach((cat, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected', i===0 ? 'true' : 'false');
    b.dataset.cat = cat;
    b.innerHTML = `<span class="tab-label">${escapeHtml(cat)}</span>`;
    b.addEventListener('click', () => {
      [...el.tabs.querySelectorAll('.tab')].forEach(t=>t.setAttribute('aria-selected','false'));
      b.setAttribute('aria-selected','true');
      activeCat = cat;
      renderGrid();
    });
    el.tabs.appendChild(b);
  });

  activeCat = categories[0] || null;
  if (categories.length <= 1) el.tabs.style.display = 'none';
}

/* ---------- Grid ---------- */
function renderGrid() {
  const list = activeCat ? CHANNELS.filter(c => c.category === activeCat) : CHANNELS;
  el.grid.innerHTML = '';

  list.forEach((ch, idx) => {
    const card = document.createElement('button');
    card.className = 'channel';
    card.dataset.category = ch.category || '';
    card.title = ch.name;

    // ripple จุดคลิก
    card.addEventListener('pointerdown', e=>{
      const r = card.getBoundingClientRect();
      card.style.setProperty('--x', `${e.clientX - r.left}px`);
      card.style.setProperty('--y', `${e.clientY - r.top}px`);
      card.classList.add('pressed');
      setTimeout(()=>card.classList.remove('pressed'), 520);
    });

    // กดเล่น
    card.addEventListener('click', () => {
      el.grid.querySelectorAll('.channel.playing').forEach(n=>n.classList.remove('playing'));
      card.classList.add('playing');
      playChannel(ch);
      showMiniToast(ch.name);
      // จำช่องล่าสุด
      const lid = `${ch.src}|${ch?.drm?.clearkey?.keyId||''}`;
      localStorage.setItem('flowtv:last', lid);
      // เลื่อนไปตัวเล่น
      el.player?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // รองรับคีย์บอร์ด
    card.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
    });

    card.innerHTML = `
      <div class="ch-card">
        <img class="ch-logo" loading="lazy" decoding="async"
             alt="${escapeHtml(ch.name)}" src="${escapeAttr(ch.logo)}"
             onerror="this.style.opacity=0;this.nextElementSibling.classList.add('no-logo');">
        <div class="ch-name">${escapeHtml(ch.name)}</div>
      </div>
    `;
    el.grid.appendChild(card);

    // auto-select ช่องล่าสุดในหมวดเดียวกัน
    const last = localStorage.getItem('flowtv:last');
    if (last && `${ch.src}|${ch?.drm?.clearkey?.keyId||''}` === last) {
      // เล็กน้อยเพื่อให้ DOM สร้างเสร็จ
      setTimeout(()=>card.click(), 0);
    }
  });
}

/* ---------- JW Player ---------- */
function ensureJW() {
  if (jw) return jw;
  jw = jwplayer(el.player).setup({
    width: '100%',
    aspectratio: '16:9',
    autostart: false,
    preload: 'auto',
    controls: true,
    displaytitle: false,
    displaydescription: false,
    advertising: { enabled: false } // กัน error instreamAdapter
  });
  // แสดง error บนหน้าจอถ้ามี
  jw.on('error', e => showMiniToast(`เล่นไม่ได้ (${e?.message||'Error'})`));
  return jw;
}

function playChannel(ch) {
  ensureJW();
  const conf = {
    file: ch.src,
    type: ch.type || 'dash',
    title: ch.name,
    withCredentials: false
  };
  if (ch.drm) conf.drm = ch.drm;

  jw.load(conf);
  jw.play();

  if (el.now) el.now.textContent = ch.name || '';
}

/* ---------- Mini toast (มือถือ) ---------- */
function mountMiniToast() {
  if (miniToast) return miniToast;
  miniToast = document.createElement('div');
  miniToast.id = 'mini-toast';
  el.player.style.position = 'relative';
  el.player.appendChild(miniToast);
  return miniToast;
}
function showMiniToast(text) {
  if (window.innerWidth > 860) return; // โชว์เฉพาะมือถือ/จอเล็ก
  mountMiniToast();
  miniToast.textContent = text;
  miniToast.classList.add('show');
  setTimeout(()=>miniToast.classList.remove('show'), 1600);
}

/* ---------- Utils ---------- */
function escapeHtml(s=''){return s.replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))}
function escapeAttr(s=''){return s.replace(/"/g,'&quot;')}

/* ---------- Boot ---------- */
(async function init(){
  try {
    CHANNELS = await loadChannels();
    const cats = [...new Set(CHANNELS.map(c=>c.category).filter(Boolean))];
    buildTabs(cats);
    renderGrid();
  } catch (err) {
    console.error(err);
    el.grid.innerHTML = `<div style="grid-column:1/-1;padding:20px;text-align:center;color:#ffbcbc">
      ${escapeHtml(err.message || String(err))}
    </div>`;
  }
})();
