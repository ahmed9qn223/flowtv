/* app.js — เสถียรขึ้นด้วย fallback: JW → Shaka (DASH) → hls.js (HLS) */
/* ต้องมี element:
   #headerTime, #currentChannel, #tabRow, #grid, #playerWrapper, #player
*/

(() => {
  const TAB_ORDER = ["ข่าว", "บันเทิง", "กีฬา", "สารคดี", "เพลง", "หนัง"]; // ไม่มี “ทั้งหมด”
  const LS_KEYS = { activeCat: "flowtv.activeCategory", lastChannel: "flowtv.lastChannel" };

  const els = {
    time: document.getElementById("headerTime"),
    title: document.getElementById("currentChannel"),
    tabs: document.getElementById("tabRow"),
    grid: document.getElementById("grid"),
    playerWrap: document.getElementById("playerWrapper"),
    playerBox: document.getElementById("player") // div สำหรับ JW
  };

  let DATA_VERSION = "";
  let channels = [];
  let categoriesConfig = { map: {}, rules: [] };
  let activeCategory = localStorage.getItem(LS_KEYS.activeCat) || TAB_ORDER[0];

  // engine ปัจจุบัน (สำหรับ destroy)
  let currentEngine = null;      // 'jw' | 'shaka' | 'hls' | 'native'
  let currentInstance = null;    // jwplayer or shaka.Player or Hls

  /* ---------------- Utils ---------------- */
  const loadScriptOnce = (src, id) => new Promise((res, rej) => {
    if (id && document.getElementById(id)) return res();
    const s = document.createElement("script");
    s.src = src; s.async = true; if (id) s.id = id;
    s.onload = () => res(); s.onerror = () => rej(new Error("load fail: " + src));
    document.head.appendChild(s);
  });

  function fmtNowTH() {
    try {
      const dt = new Date();
      const date = new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok", year: "numeric", month: "short", day: "2-digit"
      }).format(dt);
      const time = new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit"
      }).format(dt);
      return `${date} ${time}`;
    } catch { return new Date().toLocaleString("th-TH"); }
  }

  function detectType(src, explicit) {
    if (explicit) return explicit;
    const u = (src || "").toLowerCase();
    if (u.includes(".mpd")) return "dash";
    if (u.includes(".m3u8")) return "hls";
    return "";
  }

  function makeToast(text) {
    let t = document.getElementById("nowPlayingToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "nowPlayingToast";
      t.className = "now-playing-toast";
      els.playerWrap.appendChild(t);
    }
    t.textContent = text;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1800);
  }

  function renderClock() {
    if (els.time) els.time.textContent = fmtNowTH();
  }

  async function getVersionInfo() {
    try {
      const r = await fetch("version.json", { cache: "no-store" });
      if (!r.ok) throw 0;
      return await r.json();
    } catch {
      const now = new Date();
      const v = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,"0")}${String(now.getUTCDate()).padStart(2,"0")}${String(now.getUTCHours()).padStart(2,"0")}`;
      return { appVersion: v, dataVersion: v };
    }
  }

  async function getJSONWithV(path) {
    const r = await fetch(`${path}?v=${encodeURIComponent(DATA_VERSION)}`, { cache: "no-store" });
    if (!r.ok) throw new Error("โหลดไม่ได้: " + path);
    return await r.json();
  }

  function buildCategoriesConfig(raw) {
    const cfg = { map: {}, rules: [] };
    if (!raw) return cfg;
    if (raw.map) cfg.map = raw.map;
    if (Array.isArray(raw.rules)) cfg.rules = raw.rules;
    if (Array.isArray(raw.categories)) raw.categories.forEach(c => {
      if (c && c.cat && Array.isArray(c.match)) cfg.rules.push({ cat: c.cat, match: c.match });
    });
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

  function buildTabs() {
    if (!els.tabs) return;
    els.tabs.innerHTML = "";
    const frag = document.createDocumentFragment();
    TAB_ORDER.forEach(label => {
      const btn = document.createElement("button");
      btn.className = "tab-card"; btn.type = "button"; btn.dataset.cat = label;
      btn.setAttribute("role","tab");

      const ico = document.createElement("span");
      ico.className = "tab-icon"; ico.setAttribute("aria-hidden","true");
      btn.appendChild(ico);

      const lbl = document.createElement("span");
      lbl.className = "tab-label"; lbl.textContent = label;
      btn.appendChild(lbl);

      if (label === activeCategory) btn.classList.add("active");
      btn.addEventListener("click", () => {
        if (activeCategory === label) return;
        document.querySelectorAll(".tab-card.active").forEach(n => n.classList.remove("active"));
        btn.classList.add("active");
        activeCategory = label;
        localStorage.setItem(LS_KEYS.activeCat, activeCategory);
        renderGrid();
      });

      frag.appendChild(btn);
    });
    els.tabs.appendChild(frag);
  }

  function renderGrid() {
    if (!els.grid) return;
    els.grid.innerHTML = "";
    const list = channels.filter(c => c.category === activeCategory);
    const frag = document.createDocumentFragment();

    list.forEach(ch => {
      const card = document.createElement("button");
      card.className = "ch-card"; card.type = "button"; card.title = ch.name || "";
      const inner = document.createElement("div"); inner.className = "ch-inner";
      const img = document.createElement("img"); img.className = "ch-logo"; img.src = ch.logo || ""; img.alt = ch.name || ""; img.loading = "lazy";
      const nm = document.createElement("div"); nm.className = "ch-name"; nm.textContent = ch.name || "";
      inner.appendChild(img); inner.appendChild(nm); card.appendChild(inner);

      card.addEventListener("click", () => {
        playChannel(ch);
        try { els.playerWrap?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
      });

      frag.appendChild(card);
    });
    els.grid.appendChild(frag);
  }

  /* ---------------- Player engines ---------------- */
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

    // เคลียร์ player wrapper → คืน div#player ให้ JW ใช้
    if (els.playerWrap) {
      els.playerWrap.innerHTML = '<div id="player"></div>';
      els.playerBox = document.getElementById("player");
    }
  }

  function hexNoDash(s=""){ return s.replace(/-/g,"").toLowerCase(); }

  async function playWithShaka(ch) {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/shaka-player@4.7.12/dist/shaka-player.compiled.min.js","shaka-lib");
    destroyCurrent();

    const v = document.createElement("video");
    v.id = "html5video"; v.controls = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("playsinline",""); v.crossOrigin = "anonymous";
    v.style.width = "100%"; v.style.maxWidth = "100%";
    els.playerWrap.appendChild(v);

    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) throw new Error("Shaka not supported");

    const player = new shaka.Player(v);

    // ClearKey
    if (ch.drm && ch.drm.clearkey) {
      const keyId = hexNoDash(ch.drm.clearkey.keyId || "");
      const key   = hexNoDash(ch.drm.clearkey.key || "");
      const map = {}; if (keyId && key) map[keyId] = key;
      player.configure({ drm: { clearKeys: map } });
    }

    await player.load(ch.src);
    try { await v.play(); } catch {}
    currentEngine = "shaka"; currentInstance = player;
  }

  async function playWithHls(ch) {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js","hls-lib");
    destroyCurrent();

    const v = document.createElement("video");
    v.id = "html5video"; v.controls = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("playsinline",""); v.crossOrigin = "anonymous";
    v.style.width = "100%"; v.style.maxWidth = "100%";
    els.playerWrap.appendChild(v);

    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
      hls.on(Hls.Events.ERROR, (_e, data) => console.warn("hls.js error", data));
      hls.loadSource(ch.src); hls.attachMedia(v);
      currentEngine = "hls"; currentInstance = hls;
    } else {
      // Safari / iOS เล่น HLS ได้เอง
      v.src = ch.src; v.addEventListener("error", e => console.warn("native hls error", e));
      currentEngine = "native"; currentInstance = v;
    }
    try { await v.play(); } catch {}
  }

  function updateTitle(name) {
    if (els.title) els.title.textContent = name || "";
    makeToast(name || "");
    localStorage.setItem(LS_KEYS.lastChannel, name || "");
  }

  async function playWithJW(ch, type) {
    destroyCurrent();
    if (!window.jwplayer || !els.playerBox) throw new Error("jw not available");

    const cfg = {
      file: ch.src,
      width: "100%",
      aspectratio: "16:9",
      autostart: true,
      mute: false,
      controls: true,
      primary: "html5",
      stretching: "uniform"
    };
    if (type) cfg.type = type;
    if (ch.drm && ch.drm.clearkey) {
      cfg.drm = { clearkey: { keyId: ch.drm.clearkey.keyId, key: ch.drm.clearkey.key } };
    }

    const jw = jwplayer("player").setup(cfg);
    currentEngine = "jw"; currentInstance = jw;

    return new Promise((resolve, reject) => {
      let failed = false;

      jw.on("error", (e) => {
        failed = true;
        console.warn("JW error", e);
        reject(new Error("jw error"));
      });
      jw.on("setupError", (e) => {
        failed = true;
        console.warn("JW setupError", e);
        reject(new Error("jw setupError"));
      });
      jw.on("play", () => {
        if (!failed) {
          updateTitle(ch.name);
          resolve();
        }
      });

      // กันเคสขึ้นจอดำ/ไม่ยิงอีเวนต์
      setTimeout(() => {
        if (!failed && jw.getState() === "idle") {
          failed = true;
          reject(new Error("jw idle timeout"));
        }
      }, 3500);
    });
  }

  /* ---------------- Orchestrator ---------------- */
  async function playChannel(ch) {
    const type = detectType(ch.src, ch.type);
    try {
      // 1) ลอง JW ก่อน
      await playWithJW(ch, type);
      return;
    } catch (e) {
      console.warn("Fallback from JW →", e?.message || e);
    }

    try {
      // 2) ถ้าเป็น DASH → Shaka
      if (type === "dash") {
        await playWithShaka(ch);
        updateTitle(ch.name);
        return;
      }
      // 3) ถ้าเป็น HLS → hls.js
      if (type === "hls") {
        await playWithHls(ch);
        updateTitle(ch.name);
        return;
      }
      // 4) เดา type อีกครั้ง
      const guess = detectType(ch.src);
      if (guess === "dash") {
        await playWithShaka(ch); updateTitle(ch.name); return;
      }
      if (guess === "hls") {
        await playWithHls(ch); updateTitle(ch.name); return;
      }
      throw new Error("unknown stream type");
    } catch (e2) {
      console.error("All engines failed:", e2);
      alert("ไม่สามารถเล่นสตรีมนี้ได้ (อาจติด CORS/สิทธิ์ DRM/สตรีมล่ม)");
    }
  }

  /* ---------------- Boot ---------------- */
  function smoothInitUI() {
    buildTabs();
    renderGrid();
  }

  async function boot() {
    renderClock();
    setInterval(renderClock, 1000);

    const v = await getVersionInfo();
    DATA_VERSION = v.dataVersion || "";

    const [chRaw, catRaw] = await Promise.all([
      getJSONWithV("channels.json"),
      getJSONWithV("categories.json").catch(() => null),
    ]);

    categoriesConfig = buildCategoriesConfig(catRaw);
    channels = (Array.isArray(chRaw.channels) ? chRaw.channels : chRaw || []).map(c => ({
      ...c, category: guessCategory(c.name || "")
    }));

    smoothInitUI();

    // auto play last channel ถ้ามี
    const last = localStorage.getItem(LS_KEYS.lastChannel);
    const firstInCat = channels.find(c => c.category === activeCategory);
    const target = channels.find(c => c.name === last) || firstInCat || channels[0];
    if (target) playChannel(target);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
