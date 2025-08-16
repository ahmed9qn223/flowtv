/* app.js — เพิ่มแบนเนอร์อัปเดต/แบนเนอร์ error + เคลียร์แคชทุก 2 ชั่วโมง + fallback JW→Shaka→Hls */
/* ต้องมี element: #headerTime, #currentChannel, #tabRow, #grid, #playerWrapper, #player */

(() => {
  /* ---------- ค่าพื้นฐาน ---------- */
  const TAB_ORDER = ["ข่าว", "บันเทิง", "กีฬา", "สารคดี", "เพลง", "หนัง"]; // ไม่มี “ทั้งหมด”
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const PREFERRED_PLAYER = (new URLSearchParams(location.search).get('player') || 'auto').toLowerCase();

  const LS = {
    activeCat: "flowtv.activeCategory",
    lastChannel: "flowtv.lastChannel",
    lastCacheClear: "flowtv.lastCacheClear",
  };

  const els = {
    time: document.getElementById("headerTime"),
    title: document.getElementById("currentChannel"),
    tabs: document.getElementById("tabRow"),
    grid: document.getElementById("grid"),
    playerWrap: document.getElementById("playerWrapper"),
    playerBox: document.getElementById("player"), // div สำหรับ JW
  };

  let DATA_VERSION = "";
  let APP_VERSION = "";
  let channels = [];
  let categoriesConfig = { map: {}, rules: [] };
  let activeCategory = localStorage.getItem(LS.activeCat) || TAB_ORDER[0];

  // engine ปัจจุบัน
  let currentEngine = null;      // 'jw' | 'shaka' | 'hls' | 'native'
  let currentInstance = null;    // jwplayer or shaka.Player or Hls or HTMLVideoElement
  let currentChannel = null;

  /* ---------- Utils ---------- */
  function fmtNowTH() {
    try {
      const dt = new Date();
      const date = new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "short",
        day: "2-digit",
      }).format(dt);
      const time = new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(dt);
      return `${date} ${time}`;
    } catch {
      return new Date().toLocaleString("th-TH");
    }
  }
  function twoHourBucket(ts = Date.now()) { return Math.floor(ts / TWO_HOURS); }
  function detectType(src, explicit) {
    if (explicit) return explicit;
    const u = (src || "").toLowerCase();
    if (u.includes(".mpd")) return "dash";
    if (u.includes(".m3u8")) return "hls";
    return "";
  }
  const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  function escapeHtml(s){
    return String(s).replace(/[&<>"'`=\/]/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'
    }[c]));
  }

  /* ---------- แบนเนอร์: Host + Update + Error ---------- */
  function ensureNoticeHost() {
    let host = document.getElementById('notice-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'notice-host';
      host.className = 'notice-host';
      // แปะไว้ใต้ header (ถ้ามี) ไม่งั้นไว้ก่อน player
      const header = document.querySelector('header');
      if (header?.parentElement) header.after(host);
      else els.playerWrap?.before(host);
    }
    return host;
  }
  function clearNotices() {
    const host = ensureNoticeHost();
    host.innerHTML = '';
  }
  function showUpdateBanner({newVersion}) {
    const host = ensureNoticeHost();
    // ถ้ามีอยู่แล้ว ไม่ต้องซ้ำ
    if (host.querySelector('.notice--update')) return;
    const div = document.createElement('div');
    div.className = 'notice notice--update';
    div.innerHTML = `
      <div class="notice-title">มีเวอร์ชันใหม่</div>
      <div class="notice-msg">มีการอัปเดตเว็บล่าสุด (${escapeHtml(newVersion || '')}) — โหลดใหม่เพื่อใช้งานเวอร์ชันล่าสุด</div>
      <div class="notice-actions">
        <button class="btn primary" id="btn-reload">โหลดเวอร์ชันใหม่</button>
        <button class="btn" id="btn-later">ภายหลัง</button>
      </div>
    `;
    div.querySelector('#btn-reload').onclick = () => location.reload(true);
    div.querySelector('#btn-later').onclick = () => div.remove();
    host.appendChild(div);
  }
  function showErrorBanner(msg, opts = {}) {
    const host = ensureNoticeHost();
    // ลบ error เดิมก่อน
    host.querySelectorAll('.notice--error').forEach(n => n.remove());

    const div = document.createElement('div');
    div.className = 'notice notice--error';
    div.innerHTML = `
      <div class="notice-title">เล่นวิดีโอไม่สำเร็จ</div>
      <div class="notice-msg">${escapeHtml(msg || 'อาจเกิดจาก CORS/สิทธิ์/สตรีมหยุดให้บริการ')}</div>
      <div class="notice-actions">
        <button class="btn danger" id="btn-retry">ลองใหม่</button>
        <button class="btn" id="btn-jw">ลอง JW</button>
        <button class="btn" id="btn-shaka">ลอง Shaka</button>
        <button class="btn" id="btn-hls">ลอง HLS</button>
        <button class="btn" id="btn-close">ปิด</button>
      </div>
    `;
    div.querySelector('#btn-retry').onclick = () => { div.remove(); if (currentChannel) playChannel(currentChannel); };
    div.querySelector('#btn-jw').onclick    = () => { div.remove(); if (currentChannel) playChannel(currentChannel, { force: 'jw'   }); };
    div.querySelector('#btn-shaka').onclick = () => { div.remove(); if (currentChannel) playChannel(currentChannel, { force: 'shaka'}); };
    div.querySelector('#btn-hls').onclick   = () => { div.remove(); if (currentChannel) playChannel(currentChannel, { force: 'hls'  }); };
    div.querySelector('#btn-close').onclick = () => div.remove();
    host.appendChild(div);
  }

  // โพลอัปเดตทุก 10 นาที — ถ้า appVersion เปลี่ยน โชว์แบนเนอร์
  async function pollUpdateLoop() {
    try {
      const r = await fetch('version.json', { cache: 'no-store' });
      if (r.ok) {
        const v = await r.json();
        if (APP_VERSION && v.appVersion && v.appVersion !== APP_VERSION) {
          showUpdateBanner({ newVersion: v.appVersion });
        }
        // เก็บไว้ใช้ debug/โชว์ใน UI ถ้าต้องการ
        window.APP_VERSION = APP_VERSION = v.appVersion || APP_VERSION;
        window.DATA_VERSION = DATA_VERSION = v.dataVersion || DATA_VERSION;
      }
    } catch {}
    setTimeout(pollUpdateLoop, 10 * 60 * 1000);
  }

  /* ---------- เคลียร์แคชทุก 2 ชั่วโมง (ฝั่ง client) ---------- */
  async function maybeClearCaches() {
    try {
      const last = Number(localStorage.getItem(LS.lastCacheClear) || 0);
      if (Date.now() - last < TWO_HOURS) return;

      // ลบ cache storage ของ origin (เฉพาะชื่อที่เราตั้ง)
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter(k => /^flowtv-/.test(k) || k.includes('flowtv') || k.includes('shell'))
              .map(k => caches.delete(k))
        );
      }
      // ลบ data cache เดิม
      localStorage.removeItem('TV_DATA_CACHE_V1');

      localStorage.setItem(LS.lastCacheClear, Date.now().toString());
      // ไม่ reload ที่นี่ — ให้ใช้ ?v= ใหม่ในการโหลดแทน
    } catch {}
  }

  /* ---------- เวอร์ชัน/โหลดข้อมูล ---------- */
  async function getVersionInfo() {
    try {
      const r = await fetch("version.json", { cache: "no-store" });
      if (!r.ok) throw 0;
      const v = await r.json();
      return v;
    } catch {
      // ถ้าโหลดไม่ได้ ใช้ “บัคเก็ต 2 ชั่วโมง” เป็นเวอร์ชันชั่วคราว → bust cache อัตโนมัติทุก 2 ชม.
      const bucket = twoHourBucket();
      return { appVersion: `auto-${bucket}`, dataVersion: `auto-${bucket}` };
    }
  }
  async function getJSONWithV(path) {
    const url = `${path}?v=${encodeURIComponent(DATA_VERSION || APP_VERSION || twoHourBucket())}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`โหลดไม่ได้: ${path}`);
    return await r.json();
  }

  /* ---------- หมวดหมู่ ---------- */
  function buildCategoriesConfig(raw) {
    const cfg = { map: {}, rules: [] };
    if (!raw) return cfg;
    if (raw.map && typeof raw.map === "object") cfg.map = raw.map;
    if (Array.isArray(raw.rules)) cfg.rules = raw.rules;
    if (Array.isArray(raw.categories)) {
      raw.categories.forEach(c => {
        if (c && c.cat && Array.isArray(c.match)) cfg.rules.push({ cat: c.cat, match: c.match });
      });
    }
    return cfg;
  }
  function guessCategory(name) {
    const n = (name || "").toLowerCase();
    if (categoriesConfig.map[name]) return categoriesConfig.map[name];
    for (const r of categoriesConfig.rules) {
      if (r && r.cat && Array.isArray(r.match)) {
        if (r.match.some(kw => n.includes(String(kw).toLowerCase()))) return r.cat;
      }
    }
    if (/(news|jkn|nation|nbt|tnn|workpoint|tv5hd)/i.test(name)) return "ข่าว";
    if (/(one31|gmm|mono|amarin|ช่อง\s?8|3 hd|ช่อง\s?3|true4u|thai pbs|altv)/i.test(name)) return "บันเทิง";
    if (/(sport|pptv|t sports|aff|premier|bein)/i.test(name)) return "กีฬา";
    if (/(discovery|สารคดี|national|geo|animal)/i.test(name)) return "สารคดี";
    if (/(music|เพลง|mtv|hits)/i.test(name)) return "เพลง";
    if (/(hbo|cinemax|movie|หนัง|mono29 plus)/i.test(name)) return "หนัง";
    return "บันเทิง";
  }

  /* ---------- UI ---------- */
  function renderClock() {
    if (els.time) els.time.textContent = fmtNowTH();
  }
  function buildTabs() {
    if (!els.tabs) return;
    els.tabs.innerHTML = "";
    const frag = document.createDocumentFragment();
    TAB_ORDER.forEach((label) => {
      const btn = document.createElement("button");
      btn.className = "tab-card";
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.dataset.cat = label;

      const ico = document.createElement("span");
      ico.className = "tab-icon";
      ico.setAttribute("aria-hidden", "true");
      btn.appendChild(ico);

      const lbl = document.createElement("span");
      lbl.className = "tab-label";
      lbl.textContent = label;
      btn.appendChild(lbl);

      if (label === activeCategory) btn.classList.add("active");
      btn.addEventListener("click", () => {
        if (activeCategory === label) return;
        document.querySelectorAll(".tab-card.active").forEach(n => n.classList.remove("active"));
        btn.classList.add("active");
        activeCategory = label;
        localStorage.setItem(LS.activeCat, activeCategory);
        renderGrid();
        clearNotices(); // เปลี่ยนหมวด ลบแบนเนอร์เก่า
      });

      frag.appendChild(btn);
    });
    els.tabs.appendChild(frag);
  }
  function renderGrid() {
    if (!els.grid) return;
    els.grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    const list = channels.filter((c) => c.category === activeCategory);

    list.forEach((ch) => {
      const card = document.createElement("button");
      card.className = "ch-card";
      card.type = "button";
      card.title = ch.name || "";
      card.setAttribute("data-cat", ch.category || "");

      const inner = document.createElement("div"); inner.className = "ch-inner";
      const logo = document.createElement("img");
      logo.className = "ch-logo"; logo.loading = "lazy";
      logo.alt = ch.name || ""; logo.src = ch.logo || "";
      inner.appendChild(logo);

      const name = document.createElement("div"); name.className = "ch-name"; name.textContent = ch.name || "";
      inner.appendChild(name);
      card.appendChild(inner);

      card.addEventListener("click", () => {
        playChannel(ch);
        try { els.playerWrap?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
      });

      frag.appendChild(card);
    });

    els.grid.appendChild(frag);
  }

  /* ---------- แสดงชื่อช่อง/ท่อสต์ ---------- */
  function updateTitle(name) {
    if (els.title) els.title.textContent = name || "";
    makeToastOnce(name || "");
    localStorage.setItem(LS.lastChannel, name || "");
  }
  function makeToastOnce(text) {
    let toast = document.getElementById("nowPlayingToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "nowPlayingToast";
      toast.className = "now-playing-toast";
      els.playerWrap.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  /* ---------- Player engines ---------- */
  function destroyCurrent() {
    try {
      if (currentEngine === "jw" && currentInstance && currentInstance.remove) {
        currentInstance.remove();
      } else if (currentEngine === "shaka" && currentInstance && currentInstance.destroy) {
        currentInstance.destroy();
      } else if (currentEngine === "hls" && currentInstance && currentInstance.destroy) {
        currentInstance.destroy();
      }
    } catch (e) { console.warn("destroy err", e); }
    currentEngine = null; currentInstance = null;

    if (els.playerWrap) {
      els.playerWrap.innerHTML = '<div id="player"></div>';
      els.playerBox = document.getElementById("player");
    }
  }
  function hexNoDash(s = "") { return s.replace(/-/g, "").toLowerCase(); }

  async function loadScriptOnce(src, id) {
    return new Promise((res, rej) => {
      if (id && document.getElementById(id)) return res();
      const s = document.createElement("script");
      s.src = src; s.async = true; if (id) s.id = id;
      s.onload = () => res(); s.onerror = () => rej(new Error("load fail: " + src));
      document.head.appendChild(s);
    });
  }

  async function playWithShaka(ch) {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/shaka-player@4.7.12/dist/shaka-player.compiled.min.js", "shaka-lib");
    destroyCurrent();
    const v = document.createElement("video");
    v.id = "html5video"; v.controls = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("playsinline", ""); v.crossOrigin = "anonymous";
    v.style.width = "100%"; v.style.maxWidth = "100%";
    els.playerWrap.appendChild(v);

    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) throw new Error("Shaka not supported");

    const player = new shaka.Player(v);
    if (ch.drm && ch.drm.clearkey) {
      const keyId = hexNoDash(ch.drm.clearkey.keyId || "");
      const key   = hexNoDash(ch.drm.clearkey.key || "");
      const map = {}; if (keyId && key) map[keyId] = key;
      player.configure({ drm: { clearKeys: map } });
    }
    await player.load(ch.file);
    try { await v.play(); } catch {}
    currentEngine = "shaka"; currentInstance = player;
  }

  async function playWithHls(ch) {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js", "hls-lib");
    destroyCurrent();
    const v = document.createElement("video");
    v.id = "html5video"; v.controls = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("playsinline", ""); v.crossOrigin = "anonymous";
    v.style.width = "100%"; v.style.maxWidth = "100%";
    els.playerWrap.appendChild(v);

    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
      hls.on(Hls.Events.ERROR, (_e, data) => console.warn("hls.js error", data));
      hls.loadSource(ch.file); hls.attachMedia(v);
      currentEngine = "hls"; currentInstance = hls;
    } else {
      v.src = ch.file; currentEngine = "native"; currentInstance = v;
    }
    try { await v.play(); } catch {}
  }

  function playWithJW(ch) {
    destroyCurrent();
    if (!window.jwplayer || !els.playerBox) throw new Error("jw not available");
    const cfg = {
      file: ch.file,
      width: "100%",
      aspectratio: "16:9",
      autostart: true,
      mute: isMobile(),
      controls: true,
      primary: "html5",
      stretching: "uniform"
    };
    if (ch.type) cfg.type = ch.type;
    if (ch.drm && ch.drm.clearkey) {
      cfg.drm = { clearkey: { keyId: ch.drm.clearkey.keyId, key: ch.drm.clearkey.key } };
    }
    const jw = jwplayer("player").setup(cfg);
    currentEngine = "jw"; currentInstance = jw;

    return new Promise((resolve, reject) => {
      let failed = false;
      jw.once("playAttemptFailed", () => { jw.setMute(true); jw.play(true); });
      jw.on("error", (e) => { failed = true; reject(new Error("jw error " + (e?.code || ""))); });
      jw.on("setupError", (e) => { failed = true; reject(new Error("jw setupError " + (e?.message || ""))); });
      jw.on("play", () => { if (!failed) resolve(); });
      setTimeout(() => { if (!failed && jw.getState() === "idle") { failed = true; reject(new Error("jw idle timeout")); } }, 3500);
    });
  }

  /* ---------- Orchestrator ---------- */
  async function playChannel(ch, opts = {}) {
    currentChannel = ch;
    const type = detectType(ch.src || ch.file, ch.type);
    const packed = {
      file: ch.src || ch.file,
      type,
      drm: ch.drm || (ch.keyId && ch.key ? { clearkey: { keyId: ch.keyId, key: ch.key } } : undefined)
    };

    clearNotices();

    const forced = (opts.force || PREFERRED_PLAYER);
    try {
      if (forced === 'jw')    { await playWithJW(packed);  updateTitle(ch.name); return; }
      if (forced === 'shaka') { await playWithShaka(packed); updateTitle(ch.name); return; }
      if (forced === 'hls')   { await playWithHls(packed);   updateTitle(ch.name); return; }
    } catch (eForced) {
      console.warn("Forced engine failed →", eForced);
    }

    // auto mode
    try {
      await playWithJW(packed);
      updateTitle(ch.name);
      return;
    } catch (e) {
      console.warn("Fallback from JW →", e?.message || e);
    }

    try {
      if (type === "dash" || detectType(packed.file) === "dash") {
        await playWithShaka(packed); updateTitle(ch.name); return;
      }
      if (type === "hls" || detectType(packed.file) === "hls") {
        await playWithHls(packed); updateTitle(ch.name); return;
      }
      throw new Error("unknown stream type");
    } catch (e2) {
      console.error("All engines failed:", e2);
      showErrorBanner("ไม่สามารถเล่นสตรีมนี้ได้ (อาจติด CORS/สิทธิ์ DRM/ลิ้งก์หมดอายุ)");
    }

    localStorage.setItem(LS.lastChannel, ch.name || "");
  }

  /* ---------- Boot ---------- */
  async function boot() {
    // นาฬิกา
    renderClock(); setInterval(renderClock, 1000);

    // เคลียร์แคชทุก 2 ชม. (client)
    await maybeClearCaches();

    // โหลดเวอร์ชัน/ข้อมูล
    const v = await getVersionInfo();
    APP_VERSION = v.appVersion || "";
    DATA_VERSION = v.dataVersion || "";
    window.APP_VERSION = APP_VERSION;
    window.DATA_VERSION = DATA_VERSION;

    const [chRaw, catRaw] = await Promise.all([
      getJSONWithV("channels.json"),
      getJSONWithV("categories.json").catch(() => null),
    ]);
    categoriesConfig = buildCategoriesConfig(catRaw);
    const rawList = Array.isArray(chRaw.channels) ? chRaw.channels : (Array.isArray(chRaw) ? chRaw : []);
    channels = rawList.map(c => ({ ...c, category: guessCategory(c.name || "") }));

    // UI
    buildTabs();
    renderGrid();

    // auto play
    const last = localStorage.getItem(LS.lastChannel);
    const found = channels.find(c => c.name === last) || channels.find(c => c.category === activeCategory) || channels[0];
    if (found) playChannel(found);

    // โพลเวอร์ชันใหม่ทุก 10 นาที
    pollUpdateLoop();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
