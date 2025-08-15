// GitHub Pages ready script + M3U (#EXTINF/EXTVLCOPT/KODIPROP clearkey) support
// ---------------------------------------------------------------
// Helpers for M3U, ClearKey, and Proxy
function hexToBase64(hex) {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '');
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  const bytes = new Uint8Array(clean.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function buildProxyURLForPathStyle(originalUrl, ua, referer) {
  const u = new URL(originalUrl);
  const base = `${u.protocol}//${u.host}${u.pathname.replace(/[^/]+$/, '')}`; // directory of MPD/TS
  const file = u.pathname.split('/').pop();
  const b64 = btoa(base);
  let proxied = `${(window.PROXY_BASE||'')}/p/${b64}/${file}`;
  const qs = [];
  if (ua) qs.push(`ua=${encodeURIComponent(ua)}`);
  if (referer) qs.push(`referer=${encodeURIComponent(referer)}`);
  if (u.search) qs.push(u.search.slice(1));
  if (qs.length) proxied += `?${qs.join('&')}`;
  return proxied;
}

// Parse an M3U-style block with #EXTINF, #EXTVLCOPT, #KODIPROP clearkey and final URL
function parseM3UBlock(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let name = 'Channel', logo = '', category = 'ทั่วไป', ua = '', drm = null, url = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF')) {
      const m = line.match(/^#EXTINF:[^,]*,(.*)$/);
      if (m) name = m[1].trim();
      const logoM = line.match(/tvg-logo="([^"]+)"/i);
      if (logoM) logo = logoM[1];
      const grpM = line.match(/group-title="([^"]+)"/i);
      if (grpM) category = grpM[1];
    } else if (line.startsWith('#EXTVLCOPT:')) {
      const uaM = line.match(/http-user-agent=(.+)$/i);
      if (uaM) ua = uaM[1].trim();
    } else if (line.startsWith('#KODIPROP:')) {
      if (/license_type\s*=\s*clearkey/i.test(line)) { drm = drm || { type: 'clearkey' }; }
      const lk = line.match(/license_key\s*=\s*([0-9a-fA-F]+):([0-9a-fA-F]+)/i);
      if (lk) { drm = drm || { type: 'clearkey' }; drm.kid = lk[1].toLowerCase(); drm.key = lk[2].toLowerCase(); }
    } else if (!line.startsWith('#')) {
      url = line;
    }
  }
  return { name, logo, category, url, ua, drm, proxy: !!ua || (drm && drm.type==='clearkey') };
}

// quick test helper: play an M3U block immediately
window.playM3UBlock = async function(text) {
  try {
    const ch = parseM3UBlock(text);
    const id = 'm3u_' + Math.random().toString(36).slice(2, 9);
    window.__temp_m3u_channel__ = ch;
    await window.__loadChannelObject(id, ch);
  } catch (e) {
    alert('Parse error: ' + e.message);
    console.error(e);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  let hls = null, dashPlayer = null, tsPlayer = null;
  let channels = {}, currentChannelId = null;
  let controlsTimeout;
  let isAudioUnlocked = false;

  const body = document.body;
  const categorySidebar = document.getElementById('category-sidebar');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const refreshChannelsBtn = document.getElementById('refresh-channels-btn');
  const video = document.getElementById('video');
  const playerWrapper = document.querySelector('.player-wrapper');
  const customControls = document.querySelector('.custom-controls');
  const channelButtonsContainer = document.getElementById('channel-buttons-container');
  const loadingIndicator = document.getElementById('loading-indicator');
  const loadingMessage = document.getElementById('loading-message');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMessage = document.getElementById('error-message');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const progressBar = document.getElementById('progress-bar');
  const timeDisplay = document.getElementById('time-display');
  const muteBtn = document.getElementById('mute-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const pipBtn = document.getElementById('pip-btn');
  const liveIndicator = document.getElementById('live-indicator');
  const playOverlay = document.getElementById('play-overlay');

  function showLoadingIndicator(isLoading, message = '') {
    loadingIndicator.classList.toggle('hidden', !isLoading);
    if (isLoading) loadingMessage.textContent = message;
  }
  function hideLoadingIndicator() { loadingIndicator.classList.add('hidden'); }

  function unlockAudio() {
    if (isAudioUnlocked) return;
    isAudioUnlocked = true;
    const savedMuted = localStorage.getItem('webtv_muted') === 'true';
    video.muted = savedMuted;
    playerControls.updateMuteButton();
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
  }

  function destroyAllPlayers() {
    if (hls) { try { hls.destroy(); } catch(_){} hls = null; }
    if (dashPlayer) { try { dashPlayer.reset(); } catch(_){} dashPlayer = null; }
    if (tsPlayer) { try { tsPlayer.destroy(); } catch(_){} tsPlayer = null; }
    video.removeAttribute('src');
    try { video.load(); } catch(_) {}
  }

  function isSafari() { return /^((?!chrome|android).)*safari/i.test(navigator.userAgent); }

  async function attachStream(url, channelMeta = {}) {
    destroyAllPlayers();
    video.classList.remove('visible');
    playerControls.hideError();

    const lower = url.split('?')[0].toLowerCase();
    const isHls = lower.endsWith('.m3u8');
    const isDash = lower.endsWith('.mpd');
    const isTs  = lower.endsWith('.ts');

    try {
      if (isHls) {
        if (video.canPlayType('application/vnd.apple.mpegurl') || isSafari()) {
          video.src = url;
          await video.play().catch(()=>{});
        } else if (window.Hls && Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 30, maxMaxBufferLength: 120 });
          hls.attachMedia(video);
          hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
          hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(()=>{}); });
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) { switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
              case Hls.ErrorTypes.MEDIA_ERROR:   hls.recoverMediaError(); break;
              default: playerControls.showError('เกิดข้อผิดพลาดร้ายแรง ไม่สามารถเล่นได้'); destroyAllPlayers(); break;
            }}
          });
        } else {
          video.src = url; await video.play().catch(()=>{});
        }
      } else if (isDash) {
        if (window.dashjs) {
          const drm = channelMeta && channelMeta.drm;
          dashPlayer = dashjs.MediaPlayer().create();
          if (drm && drm.type === 'clearkey' && drm.kid && drm.key) {
            try {
              const kidB64 = hexToBase64(drm.kid);
              const keyB64 = hexToBase64(drm.key);
              dashPlayer.setProtectionData({ 'org.w3.clearkey': { 'clearkeys': { [kidB64]: keyB64 } } });
            } catch(e) { console.warn('ClearKey parse error:', e); }
          }
          dashPlayer.updateSettings({ 'streaming': { 'lowLatencyEnabled': true, 'buffer': { 'stableBufferTime': 10, 'fastSwitchEnabled': true } } });
          dashPlayer.initialize(video, url, true);
        } else {
          playerControls.showError('ไม่พบ dash.js');
        }
      } else if (isTs) {
        if (window.mpegts && mpegts.isSupported()) {
          tsPlayer = mpegts.createPlayer({ type: 'mpegts', url, isLive: /live|chunklist/i.test(url) });
          tsPlayer.attachMediaElement(video);
          tsPlayer.load();
          await tsPlayer.play().catch(()=>{});
        } else {
          video.src = url;
          await video.play().catch(() => playerControls.showError('เบราว์เซอร์นี้ไม่รองรับไฟล์ .ts โดยตรง'));
        }
      } else {
        video.src = url; await video.play().catch(()=>{});
      }

      video.addEventListener('playing', () => {
        document.querySelectorAll('.channel-tile.loading').forEach(t => t.classList.remove('loading'));
        hideLoadingIndicator();
        video.classList.add('visible');
      }, { once: true });

    } catch (err) {
      console.error('attachStream error:', err);
      playerControls.showError(`เล่นไม่สำเร็จ: ${err?.message || err}`);
      hideLoadingIndicator();
    }
  }

  const playerControls = {
    showError: (message) => {
      const errorChannelName = document.getElementById('error-channel-name');
      if (currentChannelId && channels[currentChannelId]) { errorChannelName.textContent = channels[currentChannelId].name; errorChannelName.style.display = 'block'; }
      else { errorChannelName.style.display = 'none'; }
      errorMessage.textContent = message;
      errorOverlay.classList.remove('hidden');
      const retryBtn = document.getElementById('retry-btn');
      const newBtn = retryBtn.cloneNode(true);
      newBtn.addEventListener('click', () => { if (currentChannelId) channelManager.loadChannel(currentChannelId); });
      retryBtn.parentNode.replaceChild(newBtn, retryBtn);
    },
    hideError: () => errorOverlay.classList.add('hidden'),
    togglePlay: () => { if (video.paused) video.play().catch(()=>{}); else video.pause(); },
    updatePlayButton: () => {
      playPauseBtn.querySelector('.icon-play').classList.toggle('hidden', !video.paused);
      playPauseBtn.querySelector('.icon-pause').classList.toggle('hidden', video.paused);
    },
    formatTime: (timeInSeconds) => {
      const time = !isNaN(timeInSeconds) ? timeInSeconds : 0;
      const hours = Math.floor(time / 3600);
      const minutes = Math.floor((time % 3600) / 60);
      const seconds = Math.floor(time % 60);
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const formattedSeconds = seconds.toString().padStart(2, '0');
      return hours > 0 ? `${hours}:${formattedMinutes}:${formattedSeconds}` : `${formattedMinutes}:${formattedSeconds}`;
    },
    updateProgress: () => {
      progressBar.value = (video.currentTime / video.duration) * 100 || 0;
      timeDisplay.textContent = `${playerControls.formatTime(video.currentTime)} / ${playerControls.formatTime(video.duration)}`;
    },
    setProgress: () => video.currentTime = (progressBar.value / 100) * video.duration,
    toggleMute: () => { unlockAudio(); video.muted = !video.muted; localStorage.setItem('webtv_muted', video.muted); playerControls.updateMuteButton(); },
    updateMuteButton: () => {
      const isMuted = video.muted || video.volume === 0;
      muteBtn.querySelector('.icon-volume-high').classList.toggle('hidden', isMuted);
      muteBtn.querySelector('.icon-volume-off').classList.toggle('hidden', !isMuted);
    },
    setVolume: () => {
      unlockAudio();
      video.volume = volumeSlider.value;
      video.muted = Number(volumeSlider.value) === 0;
      playerControls.updateMuteButton();
      localStorage.setItem('webtv_volume', video.volume);
      localStorage.setItem('webtv_muted', video.muted);
    },
    toggleFullscreen: () => { if (!document.fullscreenElement) playerWrapper.requestFullscreen().catch(err => alert(`Error: ${err.message}`)); else document.exitFullscreen(); },
    togglePip: async () => { if (!document.pictureInPictureEnabled) return; try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); } catch(e){} },
    hideControls: () => { if (video.paused) return; customControls.classList.add('controls-hidden'); playerWrapper.classList.add('hide-cursor'); },
    showControls: () => { customControls.classList.remove('controls-hidden'); playerWrapper.classList.remove('hide-cursor'); clearTimeout(controlsTimeout); controlsTimeout = setTimeout(playerControls.hideControls, 3000); },
    checkIfLive: () => {
      const isLive = !isFinite(video.duration) || (dashPlayer && dashPlayer.isDynamic && dashPlayer.isDynamic());
      progressBar.style.display = isLive ? 'none' : 'flex';
      timeDisplay.style.display = isLive ? 'none' : 'block';
      liveIndicator.classList.toggle('hidden', !isLive);
    }
  };

  async function __attachWithChannelObject(channel) {
    let url = channel.url;
    if (channel.proxy && (window.PROXY_BASE||'')) {
      url = buildProxyURLForPathStyle(channel.url, channel.ua, channel.referer||channel.url);
    }
    await attachStream(url, channel);
  }
  window.__loadChannelObject = async (id, ch) => { channels[id] = ch; await channelManager.loadChannel(id); };

  const channelManager = {
    updateActiveButton: () => {
      document.querySelectorAll('.channel-tile').forEach(tile => tile.classList.toggle('active', tile.dataset.channelId === currentChannelId));
    },
    createChannelButtons: () => {
      channelButtonsContainer.innerHTML = '';
      categorySidebar.innerHTML = '';
      const groupedChannels = {};
      for (const channelId in channels) {
        const channel = channels[channelId];
        const category = channel.category || 'ทั่วไป';
        if (!groupedChannels[category]) groupedChannels[category] = [];
        groupedChannels[category].push({ id: channelId, ...channel });
      }
      const categories = Object.keys(groupedChannels).sort();
      for (const category of categories) {
        const header = document.createElement('h2');
        header.className = 'channel-category-header';
        header.textContent = category;
        header.id = `category-${category.replace(/\s+/g, '-')}`;
        channelButtonsContainer.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'channel-buttons';
        if (category === 'หนัง') grid.classList.add('movie-grid');

        groupedChannels[category].forEach((channel, index) => {
          const tile = document.createElement('a');
          tile.className = 'channel-tile';
          if (category === 'หนัง') tile.classList.add('movie-tile');
          tile.dataset.channelId = channel.id;
          tile.addEventListener('click', () => {
            document.querySelectorAll('.channel-tile.loading').forEach(t => t.classList.remove('loading'));
            tile.classList.add('loading');
            channelManager.loadChannel(channel.id);
            playerWrapper.scrollIntoView({ behavior: 'smooth' });
          });

          const logoWrapper = document.createElement('div');
          logoWrapper.className = 'channel-logo-wrapper';
          const logoImg = document.createElement('img');
          logoImg.src = channel.logo || '';
          logoImg.alt = channel.name;
          logoImg.loading = 'lazy';
          logoWrapper.appendChild(logoImg);
          tile.appendChild(logoWrapper);

          const nameSpan = document.createElement('span');
          nameSpan.className = 'channel-tile-name';
          nameSpan.innerText = channel.name;
          tile.appendChild(nameSpan);

          if (channel.badge) {
            const badge = document.createElement('div');
            badge.className = 'channel-badge';
            badge.innerHTML = `<i class="bi bi-stack"></i> ${channel.badge}`;
            tile.appendChild(badge);
          }

          tile.style.animationDelay = `${index * 0.05}s`;
          grid.appendChild(tile);
        });

        channelButtonsContainer.appendChild(grid);
      }
      setupCategorySidebar(categories);
    },
    loadChannel: async (channelId) => {
      if (!channels[channelId]) return;
      video.classList.remove('visible');
      playerControls.hideError();
      showLoadingIndicator(true, `กำลังโหลดช่อง: ${channels[channelId].name}...`);

      try {
        currentChannelId = channelId;
        localStorage.setItem('webtv_lastChannelId', channelId);
        const channel = channels[channelId];
        document.title = `▶️ ${channel.name} - Flow TV`;
        channelManager.updateActiveButton();
        let playUrl = channel.url;
        if (channel.proxy && (window.PROXY_BASE||'')) {
          playUrl = buildProxyURLForPathStyle(channel.url, channel.ua, channel.referer||channel.url);
        }
        await attachStream(playUrl, channel);
      } catch (err) {
        console.error('loadChannel error:', err);
        playerControls.showError(`เกิดข้อผิดพลาด: ${err?.message || err}`);
        hideLoadingIndicator();
      }
    }
  };

  const timeManager = {
    update: () => {
      const now = new Date();
      const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const timeOptions = { hour: '2-digit', minute: '2-digit' };
      const thaiDate = now.toLocaleDateString('th-TH', dateOptions);
      const thaiTime = now.toLocaleTimeString('th-TH', timeOptions);
      document.getElementById('datetime-display').innerHTML = `🕒 ${thaiDate} ${thaiTime}`;
    },
    start: () => { timeManager.update(); setInterval(timeManager.update, 1000); }
  };

  function setupCategorySidebar(categories) {
    const categoryIcons = { 'IPTV':'bi-tv-fill','การศึกษา':'bi-book-half','กีฬา':'bi-dribbble','หนัง':'bi-film','ทั่วไป':'bi-grid-fill' };
    categories.forEach(category => {
      const link = document.createElement('a');
      link.className = 'category-link';
      const iconClass = categoryIcons[category] || categoryIcons['ทั่วไป'];
      link.innerHTML = `<i class="bi ${iconClass}"></i> <span>${category}</span>`;
      const categoryId = `category-${category.replace(/\s+/g, '-')}`;
      link.href = `#${categoryId}`;
      link.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(categoryId)?.scrollIntoView({ behavior: 'smooth' }); });
      categorySidebar.appendChild(link);
    });

    const headers = document.querySelectorAll('.channel-category-header');
    const links = document.querySelectorAll('.category-link');
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        let activeHeaderId = null;
        const triggerPoint = 150;
        headers.forEach(header => {
          const headerTop = header.getBoundingClientRect().top;
          if (headerTop < triggerPoint) activeHeaderId = header.getAttribute('id');
        });
        links.forEach(link => {
          const linkHref = link.getAttribute('href').substring(1);
          link.classList.toggle('active', linkHref === activeHeaderId);
        });
      }, 100);
    });
  }

  async function fetchAndRenderChannels() {
    showLoadingIndicator(true, 'กำลังโหลดรายการช่อง...');
    channelButtonsContainer.innerHTML = '';
    const tempGrid = document.createElement('div');
    tempGrid.className = 'channel-buttons';
    for (let i = 0; i < 20; i++) {
      const tile = document.createElement('div');
      tile.className = 'channel-tile skeleton';
      tile.innerHTML = `<div class="channel-logo-wrapper"></div><span class="channel-tile-name">loading</span>`;
      tempGrid.appendChild(tile);
    }
    channelButtonsContainer.appendChild(tempGrid);

    try {
      const response = await fetch('./channels.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('โหลด channels.json ไม่สำเร็จ');
      channels = await response.json();
      channelManager.createChannelButtons();
    } catch (e) {
      console.error("Could not fetch channels:", e);
      playerControls.showError("ไม่สามารถรีเฟรชรายการช่องได้");
      channelButtonsContainer.innerHTML = '';
    } finally {
      hideLoadingIndicator();
    }
  }

  async function init() {
    const savedTheme = localStorage.getItem('webtv_theme');
    if (savedTheme === 'light') {
      body.classList.add('light-theme');
      themeToggleBtn.innerHTML = '<i class="bi bi-moon-fill"></i>';
    } else {
      themeToggleBtn.innerHTML = '<i class="bi bi-sun-fill"></i>';
    }

    await fetchAndRenderChannels();
    // Events
    playPauseBtn.addEventListener('click', playerControls.togglePlay);
    video.addEventListener('pause', () => { playerControls.updatePlayButton(); playerControls.showControls(); });
    video.addEventListener('loadedmetadata', playerControls.checkIfLive);
    progressBar.addEventListener('input', playerControls.setProgress);
    video.addEventListener('timeupdate', playerControls.updateProgress);
    muteBtn.addEventListener('click', playerControls.toggleMute);
    volumeSlider.addEventListener('input', playerControls.setVolume);
    fullscreenBtn.addEventListener('click', playerControls.toggleFullscreen);
    pipBtn.addEventListener('click', playerControls.togglePip);
    refreshChannelsBtn.addEventListener('click', () => { refreshChannelsBtn.classList.add('refresh-active'); fetchAndRenderChannels(); setTimeout(() => refreshChannelsBtn.classList.remove('refresh-active'), 1000); });

    playOverlay.addEventListener('click', () => { playOverlay.classList.add('hidden'); showLoadingIndicator(true, 'กำลังเชื่อมต่อ...'); playerControls.togglePlay(); });
    video.addEventListener('play', () => { playOverlay.classList.add('hidden'); playerControls.updatePlayButton(); playerControls.showControls(); });

    playerWrapper.addEventListener('mousemove', playerControls.showControls);
    playerWrapper.addEventListener('mouseleave', playerControls.hideControls);
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      switch(e.key.toLowerCase()) {
        case ' ': e.preventDefault(); playerControls.togglePlay(); break;
        case 'm': playerControls.toggleMute(); break;
        case 'f': playerControls.toggleFullscreen(); break;
      }
    });

    const savedVolume = localStorage.getItem('webtv_volume');
    const savedMuted = localStorage.getItem('webtv_muted') === 'true' || localStorage.getItem('webtv_muted') === null;
    video.volume = savedVolume !== null ? savedVolume : 0.5;
    volumeSlider.value = savedVolume !== null ? savedVolume : 0.5;
    video.muted = savedMuted;
    playerControls.updateMuteButton();
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    const lastChannelId = localStorage.getItem('webtv_lastChannelId');
    if (lastChannelId) {
      const ch = channels[lastChannelId];
      if (ch) await channelManager.loadChannel(lastChannelId);
    }
  }

  init();
});
