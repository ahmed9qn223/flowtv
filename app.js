/* =========================================================
   FLOWTV • app.js (clean + compact, category-aware)
   - โหลดรายการช่องจาก channels.json หรือ window.__CHANNELS__
   - สร้างแท็บหมวดหมู่อัตโนมัติ (ไม่มี "ทั้งหมด")
   - เรนเดอร์การ์ดขนาดคงที่ (ให้ไปคุมสไตล์ใน styles.css)
   - JW Player + ClearKey DRM
   - ripple, playing glow, mobile toast, remember last
========================================================= */

const el = {
  tabs:    document.getElementById('tabs'),
  grid:    document.getElementById('channel-list'),
  player:  document.getElementById('player'),
  clock:   document.getElementById('clock'),
  now:     document.getElementById('now-playing')
};

let CHANNELS = [];
let activeCat = null;
let activeIdx = -1;
let jw = null;
let miniToast;

/* ---------- Clock ---------- */
function startClock() {
  const fmt = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour12: false,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const tick = () => el.clock && (el.clock.textContent = fmt.format(new Date()));
  tick(); setInterval(tick, 1000);
}

/* ---------- Load data ---------- */
async function loadChannels() {
  if (window.__CHANNELS__ && Array.isArray(window.__CHANNELS__.channels)) {
    return window.__CHANNELS__.channels;
  }
  const res = await fetch('channels.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('โหลด channels.json ไม่สำเร็จ');
  const data = await res.json();
  return data.channels || [];
}

/* ---------- Build Tabs ---------- */
function buildTabs(categories) {
  el.tabs.innerHTML = '';
  const order = ['ข่าว','บันเทิง','กีฬา','สารคดี','เพลง','หนัง'];
  categories.sort((a,b)=> order.indexOf(a) - order.indexOf(b));

  categories.forEach((cat, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected', i===0 ? 'true' : 'false');
    b.dataset.cat = cat;
    b.textContent = cat;
    b.addEventListener('click', () => {
      [...el.tabs.querySelectorAll('.tab')].forEach(t=>t.setAttribute('aria-selected','false'));
      b.setAttribute('aria-selected','true');
      activeCat = cat;
      renderGrid();
    });
    el.tabs.appendChild(b);
  });

  activeCat = categories[0] || null;
}

/* ---------- Render Grid ---------- */
function renderGrid() {
  const list = activeCat ? CHANNELS.filter(c => c.category === activeCat) : CHANNELS;
  el.grid.innerHTML = '';
  activeIdx = -1;

  list.forEach((ch, idx) => {
    const item = document.createElement('button');
    item.className = 'channel';
    item.dataset.category = ch.category || '';
    item.setAttribute('aria-label', ch.name);

    // ripple (ตำแหน่งคลิก)
    item.addEventListener('pointerdown', e=>{
      const r = item.getBoundingClientRect();
      item.style.setProperty('--x', `${e.clientX - r.left}px`);
      item.style.setProperty('--y', `${e.clientY - r.top}px`);
      item.classList.add('pressed');
      setTimeout(()=>item.classList.remove('pressed'), 520);
    });

    // click -> play
    item.addEventListener('click', () => {
      el.grid.querySelectorAll('.channel.playing').forEach(n=>n.classList.remove('playing'));
      item.classList.add('playing');
      activeIdx = idx;
      playChannel(ch);
      showMiniToast(ch.name);
      // remember last(เฉพาะ id จาก src + keyId)
      const lid = `${ch.src}|${ch?.drm?.clearkey?.keyId||''}`;
      localStorage.setItem('flowtv:last', lid);
    });

    item.innerHTML = `
      <div class="ch-card">
        <img class="ch-logo" loading="lazy" decoding="async" alt="${escapeHtml(ch.name)}"
             src="${escapeAttr(ch.logo)}">
        <div class="ch-name">${escapeHtml(ch.name)}</div>
      </div>
    `;
    el.grid.appendChild(item);
  });

  // auto play last in this category (ถ้าอยู่ category เดียวกัน)
  const last = localStorage.getItem('flowtv:last');
  if (last) {
    const i = list.findIndex(c => `${c.src}|${c?.drm?.clearkey?.keyId||''}` === last);
    if (i > -1) el.grid.children[i]?.click();
  }
}

/* ---------- JW Player ---------- */
function ensureJW() {
  if (jw) return jw;
  jw = jwplayer(el.player).setup({
    width: '100%',
    aspectratio: '16:9',
    autostart: false,
    preload: 'auto',
    tracks: [],
    // หลีกเลี่ยงการใช้ advertising เพื่อไม่ให้มี error instreamAdapter
  });
  return jw;
}

function playChannel(ch) {
  ensureJW();
  const conf = {
    file: ch.src,
    type: ch.type || 'dash',
    drm: ch.drm || undefined,
    title: ch.name,
    withCredentials: false
  };
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
  if (window.innerWidth > 860) return;     // เฉพาะมือถือ/จอเล็ก
  mountMiniToast();
  miniToast.textContent = text;
  miniToast.classList.add('show');
  setTimeout(()=>miniToast.classList.remove('show'), 1800);
}

/* ---------- Utils ---------- */
function escapeHtml(s=''){return s.replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))}
function escapeAttr(s=''){return s.replace(/"/g,'&quot;')}

/* ---------- Boot ---------- */
(async function bootstrap(){
  try{
    startClock();

    CHANNELS = await loadChannels();

    // รวบรวมหมวดหมู่จากข้อมูลจริง
    const cats = [...new Set(CHANNELS.map(c=>c.category).filter(Boolean))];
    buildTabs(cats);
    renderGrid();

    // ถ้ามีหมวดเดียว ให้ซ่อนแท็บ
    if (cats.length <= 1 && el.tabs) el.tabs.style.display = 'none';
  }catch(err){
    console.error(err);
    // แสดงข้อความง่าย ๆ ในกริดกรณีโหลดข้อมูลไม่ได้
    el.grid.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:#ffb4b4;">
      โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message || String(err))}
    </div>`;
  }
})();
