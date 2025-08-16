/* app.js — เว็บทีวี: โหลดเวอร์ชัน/แชนแนล, เรนเดอร์แท็บหมวดหมู่, เล่นวิดีโอ (DASH/HLS + ClearKey) */
/* ต้องมี element ในหน้า:
   #headerTime (วันที่เวลา), #currentChannel (ชื่อช่องที่กำลังเล่น),
   #tabRow (คอนเทนเนอร์แท็บ), #grid (กริดช่อง), #playerWrapper (หุ้ม jwplayer), #player (ตัวเล่น)
*/

(() => {
  const TAB_ORDER = ["ข่าว", "บันเทิง", "กีฬา", "สารคดี", "เพลง", "หนัง"]; // ไม่มี “ทั้งหมด”
  const LS_KEYS = {
    activeCat: "flowtv.activeCategory",
    lastChannel: "flowtv.lastChannel",
  };

  const els = {
    time: document.getElementById("headerTime"),
    title: document.getElementById("currentChannel"),
    tabs: document.getElementById("tabRow"),
    grid: document.getElementById("grid"),
    playerWrap: document.getElementById("playerWrapper"),
    player: document.getElementById("player"),
  };

  let DATA_VERSION = "";
  let channels = [];
  let categoriesConfig = { map: {}, rules: [] };
  let activeCategory = localStorage.getItem(LS_KEYS.activeCat) || TAB_ORDER[0];
  let jw = null;

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

  function detectType(src, explicit) {
    if (explicit) return explicit;
    const u = (src || "").toLowerCase();
    if (u.includes(".mpd")) return "dash";
    if (u.includes(".m3u8")) return "hls";
    return "";
  }

  function smoothFadeGrid(cb) {
    els.grid.classList.add("grid-fade-out");
    window.setTimeout(() => {
      cb();
      // force reflow then fade-in
      void els.grid.offsetWidth;
      els.grid.classList.remove("grid-fade-out");
      els.grid.classList.add("grid-fade-in");
      window.setTimeout(() => els.grid.classList.remove("grid-fade-in"), 200);
    }, 150);
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

  /* ---------- Version / Data ---------- */
  async function getVersionInfo() {
    try {
      const r = await fetch("version.json", { cache: "no-store" });
      if (!r.ok) throw 0;
      return await r.json();
    } catch {
      const now = new Date();
      const v = `${now.getUTCFullYear()}${String(
        now.getUTCMonth() + 1
      ).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(
        now.getUTCHours()
      ).padStart(2, "0")}`;
      return { appVersion: v, dataVersion: v };
    }
  }

  async function getJSONWithV(path) {
    const url = `${path}?v=${encodeURIComponent(DATA_VERSION)}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`โหลดไม่ได้: ${path}`);
    return await r.json();
  }

  /* ---------- Category logic ---------- */
  function buildCategoriesConfig(raw) {
    // รองรับหลายฟอร์แมต
    const cfg = { map: {}, rules: [] };
    if (!raw) return cfg;

    if (raw.map && typeof raw.map === "object") cfg.map = raw.map;

    if (Array.isArray(raw.rules)) cfg.rules = raw.rules;

    if (Array.isArray(raw.categories) && raw.categories.length) {
      // รองรับรูปแบบ {categories:[{cat:"ข่าว", match:["NBT","TNN"]}, ...]}
      raw.categories.forEach((c) => {
        if (c && c.cat && Array.isArray(c.match)) {
          cfg.rules.push({ cat: c.cat, match: c.match });
        }
      });
    }
    return cfg;
  }

  function guessCategory(name) {
    const n = (name || "").toLowerCase();

    // exact map
    if (categoriesConfig.map[name]) return categoriesConfig.map[name];

    // rules (keyword contains)
    for (const r of categoriesConfig.rules) {
      if (r && r.cat && Array.isArray(r.match)) {
        if (r.match.some((kw) => n.includes(String(kw).toLowerCase())))
          return r.cat;
      }
    }

    // heuristics fallback
    if (/(news|jkn|nation|nbt|tnn|workpoint|tv5hd)/i.test(name)) return "ข่าว";
    if (/(one31|gmm|mono|amarin|ช่อง\s?8|3 hd|ช่อง\s?3|true4u|thai pbs|altv)/i.test(name)) return "บันเทิง";
    if (/(sport|pptv|t sports|aff|premier|bein)/i.test(name)) return "กีฬา";
    if (/(discovery|สารคดี|national|geo|animal)/i.test(name)) return "สารคดี";
    if (/(music|เพลง|mtv|hits)/i.test(name)) return "เพลง";
    if (/(hbo|cinemax|movie|หนัง|mono29 plus)/i.test(name)) return "หนัง";
    // default ใส่ไปที่ “บันเทิง”
    return "บันเทิง";
  }

  /* ---------- UI render ---------- */
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

      // icon placeholder (ใช้ CSS วาด/ไอคอนฟอนต์)
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
        document
          .querySelectorAll(".tab-card.active")
          .forEach((n) => n.classList.remove("active"));
        btn.classList.add("active");
        activeCategory = label;
        localStorage.setItem(LS_KEYS.activeCat, activeCategory);
        smoothFadeGrid(() => renderGrid());
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

    list.forEach((ch, idx) => {
      const card = document.createElement("button");
      card.className = "ch-card";
      card.type = "button";
      card.title = ch.name || "";
      card.setAttribute("data-cat", ch.category || "");

      const inner = document.createElement("div");
      inner.className = "ch-inner";

      const logo = document.createElement("img");
      logo.className = "ch-logo";
      logo.loading = "lazy";
      logo.alt = ch.name || "";
      logo.src = ch.logo || "";
      inner.appendChild(logo);

      const name = document.createElement("div");
      name.className = "ch-name";
      name.textContent = ch.name || "";
      inner.appendChild(name);

      card.appendChild(inner);

      card.addEventListener("click", () => {
        playChannel(ch);
        try {
          els.playerWrap?.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {}
      });

      frag.appendChild(card);
    });

    els.grid.appendChild(frag);
  }

  /* ---------- Player ---------- */
  function playChannel(ch) {
    if (!window.jwplayer || !els.player) return;

    const type = detectType(ch.src, ch.type);
    const cfg = {
      file: ch.src,
      width: "100%",
      aspectratio: "16:9",
      autostart: true,
      mute: false,
      controls: true,
      abouttext: "FlowTV",
    };
    if (type) cfg.type = type;
    if (ch.drm && ch.drm.clearkey) {
      cfg.drm = { clearkey: { keyId: ch.drm.clearkey.keyId, key: ch.drm.clearkey.key } };
    }

    try {
      jw = jwplayer("player").setup(cfg);
      jw.on("play", () => {
        if (els.title) els.title.textContent = ch.name || "";
        makeToastOnce(ch.name || "");
      });
    } catch (e) {
      console.error("JWPlayer error:", e);
    }

    localStorage.setItem(LS_KEYS.lastChannel, ch.name || "");
  }

  /* ---------- Boot ---------- */
  async function boot() {
    renderClock();
    setInterval(renderClock, 1000);

    const v = await getVersionInfo();
    DATA_VERSION = v.dataVersion || "";

    // load data
    const [chRaw, catRaw] = await Promise.all([
      getJSONWithV("channels.json"),
      getJSONWithV("categories.json").catch(() => null),
    ]);

    categoriesConfig = buildCategoriesConfig(catRaw);

    channels = (Array.isArray(chRaw.channels) ? chRaw.channels : chRaw || []).map(
      (c) => ({
        ...c,
        category: guessCategory(c.name || ""),
      })
    );

    // UI
    buildTabs();
    renderGrid();

    // auto play last channel (ถ้าอยู่ในหมวดที่มี)
    const last = localStorage.getItem(LS_KEYS.lastChannel);
    if (last) {
      const found = channels.find((c) => c.name === last);
      if (found) playChannel(found);
    } else {
      // เล่นตัวแรกของหมวดปัจจุบัน ถ้ามี
      const first = channels.find((c) => c.category === activeCategory);
      if (first) playChannel(first);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
