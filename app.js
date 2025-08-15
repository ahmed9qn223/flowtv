// ==== ตั้งค่า ====
const CHANNELS_URL = 'channels.json';  // วางไฟล์ไว้โฟลเดอร์เดียวกับ index.html
const TIMEZONE     = 'Asia/Bangkok';

// ใส่คีย์ JW Player ของคุณ (อนุญาตให้ใช้ได้)
// *อย่าใส่คีย์ที่ไม่ได้รับอนุญาตลง public repo*
jwplayer.key = 'XSuP4qMl+9tK17QNb+4+th2Pm9AWgMO/cYH8CI0HGGr7bdjo';

// ==== ตัวแปรหลัก ====
let channels = [];
let currentIndex = -1;
let scrollOnNextPlay = false;

// ==== นาฬิกาบนสุด ====
const clockEl = document.getElementById('clock');
function tick() {
  const now = new Date();
  const t = new Intl.DateTimeFormat('th-TH', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hour12:false, timeZone: TIMEZONE
  }).format(now).replace(',', '');
  clockEl.textContent = t;
}
tick();
setInterval(tick, 1000);

// ==== โหลดรายการช่อง ====
fetch(CHANNELS_URL, { cache: 'no-store' })
  .then(r => r.json())
  .then(data => {
    channels = Array.isArray(data) ? data : (data.channels || []);
    render();
    const start = Math.max(0, Math.min(channels.length - 1, parseInt(localStorage.getItem('lastIndex') || '0', 10)));
    if (channels.length) play(start, { scroll: false }); // ครั้งแรกไม่เลื่อน
  })
  .catch(e => {
    console.error('โหลด channels.json ไม่สำเร็จ:', e);
    alert('โหลดรายการช่องไม่สำเร็จ ตรวจสอบไฟล์ channels.json และ CORS');
  });

// ==== เรนเดอร์รายการช่อง ====
function render() {
  const wrap = document.getElementById('channel-list');
  wrap.innerHTML = '';
  channels.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'channel';
    btn.title = ch.name || `ช่อง ${i + 1}`;
    btn.innerHTML = `
      <div class="card">
        <div class="logo-wrap">
          <img class="logo" loading="lazy" decoding="async"
               src="${escapeHtml(ch.logo || '')}"
               alt="${escapeHtml(ch.name || 'โลโก้ช่อง')}">
        </div>
        <div class="name">${escapeHtml(ch.name || `ช่อง ${i + 1}`)}</div>
      </div>`;
    btn.addEventListener('click', (e) => {
      makeRipple(e, btn.querySelector('.card'));
      scrollOnNextPlay = true;
      play(i);
    });
    wrap.appendChild(btn);
  });
  highlight(currentIndex);
}

// ==== เล่นช่อง ====
function play(i, opt = { scroll: true }) {
  const ch = channels[i]; if (!ch) return;
  currentIndex = i;

  const source = buildSource(ch);
  const player = jwplayer('player').setup({
    playlist: [{
      title: ch.name || '',
      image: ch.poster || ch.logo || undefined,
      sources: [source]
    }],
    width: '100%',
    aspectratio: '16:9',
    autostart: true,
    mute: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    preload: 'metadata',
    playbackRateControls: true
  });

  player.once('playAttemptFailed', () => { player.setMute(true); player.play(true); });
  player.on('error', (e) => console.warn('Player error:', e));

  highlight(i);
  try { localStorage.setItem('lastIndex', String(i)); } catch {}

  // เลื่อนหน้าไปหาตัวเล่นวิดีโอ
  if ((opt.scroll ?? true) && scrollOnNextPlay) {
    scrollToPlayer();
    scrollOnNextPlay = false;
  }
}

// ==== สร้าง source ให้ JW (รองรับ HLS/DASH + ClearKey) ====
function buildSource(ch) {
  const srcUrl = buildUrlWithProxyIfNeeded(ch);
  const t = (ch.type || detectType(srcUrl) || 'auto').toLowerCase();
  const src = { file: srcUrl };

  if (t === 'dash') {
    src.type = 'dash';
    // รองรับรูปแบบเก่า (keyId/key อยู่ระดับบน)
    const ck = ch.drm?.clearkey || (ch.keyId && ch.key ? { keyId: ch.keyId, key: ch.key } : null);
    if (ck?.keyId && ck?.key) src.drm = { clearkey: { keyId: ck.keyId, key: ck.key } };
  } else if (t === 'hls') {
    src.type = 'hls';
  }
  return src;
}

function detectType(u) {
  const p = (u || '').split('?')[0].toLowerCase();
  if (p.endsWith('.m3u8')) return 'hls';
  if (p.endsWith('.mpd'))  return 'dash';
  return 'auto';
}

// (ถ้าต้องผ่าน Proxy Worker ให้ตั้ง window.PROXY_BASE และใส่ ch.proxy:true)
function buildUrlWithProxyIfNeeded(ch) {
  const raw = ch.src || ch.file || '';
  if (window.PROXY_BASE && ch.proxy) {
    const payload = {
      src: raw,
      referrer: ch.referrer || '',
      ua: ch.ua || '',
      headers: ch.headers || {}
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return `${window.PROXY_BASE}/p/${b64}`;
  }
  return raw;
}

// ==== เอฟเฟกต์ ripple ====
function makeRipple(event, container) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const max = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${max}px`;
  ripple.style.left = `${event.clientX - rect.left - max/2}px`;
  ripple.style.top  = `${event.clientY - rect.top  - max/2}px`;
  const old = container.querySelector('.ripple');
  if (old) old.remove();
  container.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

// ==== ยูทิล =====
function scrollToPlayer() {
  const el = document.getElementById('player');
  const header = document.querySelector('header');
  const y = el.getBoundingClientRect().top + window.pageYOffset - ((header?.offsetHeight) || 0) - 8;
  window.scrollTo({ top: y, behavior: 'smooth' });
}
function highlight(i) {
  document.querySelectorAll('.channel').forEach((el, idx) => {
    el.classList.toggle('active', idx === i);
    el.setAttribute('aria-pressed', idx === i ? 'true' : 'false');
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"'`=\/]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'
  }[c]));
}
