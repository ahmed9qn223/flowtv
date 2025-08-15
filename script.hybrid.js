document.addEventListener("DOMContentLoaded", () => {
    let hls, channels = {}, currentChannelId = null;
    let controlsTimeout;
    let isAudioUnlocked = false;

    // --- DOM Elements ---
    const body = document.body;
    const categorySidebar = document.getElementById('category-sidebar');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const refreshChannelsBtn = document.getElementById('refresh-channels-btn');
    const video = document.getElementById('video'); window.video = video;
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

    // --- Audio Unlock Function ---
    function unlockAudio() {
        if (isAudioUnlocked) return;
        isAudioUnlocked = true;
        const savedMuted = localStorage.getItem('webtv_muted') === 'true';
        video.muted = savedMuted;
        playerControls.updateMuteButton();
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
    }

    // --- Player Controls ---
    function showLoadingIndicator(isLoading, message = '') {
        loadingIndicator.classList.toggle('hidden', !isLoading);
        if (isLoading) loadingMessage.textContent = message;
    }

    const playerControls = {
        showError: (message) => {
            const errorChannelName = document.getElementById('error-channel-name');
            if (currentChannelId && channels[currentChannelId]) {
                errorChannelName.textContent = channels[currentChannelId].name;
                errorChannelName.style.display = 'block';
            } else {
                errorChannelName.style.display = 'none';
            }
            errorMessage.textContent = message;
            errorOverlay.classList.remove('hidden');
            const retryBtn = document.getElementById('retry-btn');
            const newBtn = retryBtn.cloneNode(true);
            newBtn.addEventListener('click', () => { if (currentChannelId) channelManager.loadChannel(currentChannelId); });
            retryBtn.parentNode.replaceChild(newBtn, retryBtn);
        },
        hideError: () => errorOverlay.classList.add('hidden'),
        togglePlay: () => {
            if (video.paused) video.play().catch(e => { if (e.name !== 'AbortError') console.error("Error playing video:", e); });
            else video.pause();
        },
        updatePlayButton: () => {
            playPauseBtn.querySelector('.icon-play').classList.toggle('hidden', !video.paused);
            playPauseBtn.querySelector('.icon-pause').classList.toggle('hidden', video.paused);
        },
        formatTime: (timeInSeconds) => {
            const time = !isNaN(timeInSeconds) ? timeInSeconds : 0;
            const hours = Math.floor(time / 3600);
            const minutes = Math.floor((time % 3600) / 60);
            const seconds = Math.floor(time % 60);
            const fm = minutes.toString().padStart(2, '0');
            const fs = seconds.toString().padStart(2, '0');
            return hours > 0 ? `${hours}:${fm}:${fs}` : `${fm}:${fs}`;
        },
        updateProgress: () => {
            progressBar.value = (video.currentTime / video.duration) * 100 || 0;
            timeDisplay.textContent = `${playerControls.formatTime(video.currentTime)} / ${playerControls.formatTime(video.duration)}`;
        },
        setProgress: () => video.currentTime = (progressBar.value / 100) * video.duration,
        toggleMute: () => {
            unlockAudio();
            video.muted = !video.muted;
            localStorage.setItem('webtv_muted', video.muted);
            playerControls.updateMuteButton();
        },
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
        toggleFullscreen: () => {
            if (!document.fullscreenElement) playerWrapper.requestFullscreen().catch(err => alert(`Error: ${err.message}`));
            else document.exitFullscreen();
        },
        togglePip: async () => {
            if (!document.pictureInPictureEnabled) return;
            try {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                else await video.requestPictureInPicture();
            } catch (error) { console.error("PiP Error:", error); }
        },
        hideControls: () => {
            if (video.paused) return;
            customControls.classList.add('controls-hidden');
            playerWrapper.classList.add('hide-cursor');
        },
        showControls: () => {
            customControls.classList.remove('controls-hidden');
            playerWrapper.classList.remove('hide-cursor');
            clearTimeout(controlsTimeout);
            controlsTimeout = setTimeout(playerControls.hideControls, 3000);
        },
        checkIfLive: () => {
            const isLive = !isFinite(video.duration);
            progressBar.style.display = isLive ? 'none' : 'flex';
            timeDisplay.style.display = isLive ? 'none' : 'block';
            liveIndicator.classList.toggle('hidden', !isLive);
        }
    };

    // --- Sidebar ---
    function setupCategorySidebar(categories) {
        const categoryIcons = {
            'IPTV': 'bi-tv-fill',
            'การศึกษา': 'bi-book-half',
            'กีฬา': 'bi-dribbble',
            'หนัง': 'bi-film',
            'ทั่วไป': 'bi-grid-fill'
        };
        categories.forEach(category => {
            const link = document.createElement('a');
            link.className = 'category-link';
            const iconClass = categoryIcons[category] || categoryIcons['ทั่วไป'];
            link.innerHTML = `<i class="bi ${iconClass}"></i> <span>${category}</span>`;
            const categoryId = `category-${category.replace(/\s+/g, '-')}`;
            link.href = `#${categoryId}`;
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById(categoryId)?.scrollIntoView({ behavior: 'smooth' });
            });
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
                    if (headerTop < triggerPoint) {
                        activeHeaderId = header.getAttribute('id');
                    }
                });
                links.forEach(link => {
                    const linkHref = link.getAttribute('href').substring(1);
                    link.classList.toggle('active', linkHref === activeHeaderId);
                });
            }, 100);
        });
    }

    // --- Channel UI ---
    const channelManager = {
        updateActiveButton: () => {
            document.querySelectorAll('.channel-tile').forEach(tile => tile.classList.toggle('active', tile.dataset.channelId === currentChannelId));
        },
        createChannelButtons: () => {
            channelButtonsContainer.innerHTML = '';
            categorySidebar.innerHTML = '';
            const grouped = {};
            for (const id in channels) {
                const c = channels[id];
                const cat = c.category || 'ทั่วไป';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push({ id, ...c });
            }
            const categories = Object.keys(grouped).sort();
            for (const category of categories) {
                const header = document.createElement('h2');
                header.className = 'channel-category-header';
                header.textContent = category;
                header.id = `category-${category.replace(/\s+/g, '-')}`;
                channelButtonsContainer.appendChild(header);
                const grid = document.createElement('div');
                grid.className = 'channel-buttons';
                if (category === 'หนัง') grid.classList.add('movie-grid');
                grouped[category].forEach((channel, index) => {
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
                    logoImg.src = channel.logo;
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
            if (hls) hls.stopLoad();
            video.classList.remove('visible');
            playerControls.hideError();
            showLoadingIndicator(true, `กำลังโหลดช่อง: ${channels[channelId].name}...`);
            try {
                const streamUrl = channels[channelId].url; // direct URL from channels.json
                if (!streamUrl) throw new Error('ไม่มี URL ของช่องนี้');

                currentChannelId = channelId; window.currentChannelId = currentChannelId;
                localStorage.setItem('webtv_lastChannelId', channelId);
                const channel = channels[channelId];
                document.title = `▶️ ${channel.name} - Flow TV`;
                channelManager.updateActiveButton();

                if (Hls.isSupported()) {
                    if (!hls) {
                        hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 600 });
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            const playPromise = video.play();
                            if (playPromise !== undefined) {
                                playPromise.catch(error => {
                                    if (error.name !== 'AbortError') {
                                        playOverlay.classList.remove('hidden');
                                        playerControls.updatePlayButton();
                                    }
                                });
                            }
                        });
                        hls.on(Hls.Events.ERROR, (event, data) => {
                            if (data.fatal) {
                                switch(data.type) {
                                    case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
                                    case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
                                    default: playerControls.showError('เกิดข้อผิดพลาดร้ายแรง ไม่สามารถเล่นได้'); hls.destroy(); hls = null; break;
                                }
                            }
                        });
                    }
                    hls.loadSource(streamUrl);
                } else if (video.canPlayType('application/vnd.apple.mpegURL')) {
                    video.src = streamUrl;
                    await video.play();
                } else {
                    throw new Error('เบราว์เซอร์นี้ไม่รองรับ HLS.js');
                }

            } catch (error) {
                console.error("Error loading channel:", error);
                playerControls.showError(`เกิดข้อผิดพลาด: ${error.message}`);
                showLoadingIndicator(false);
            }
        }
    };

    // --- Datetime ---
    const timeManager = {
        update: () => {
            const now = new Date();
            const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const timeOptions = { hour: '2-digit', minute: '2-digit' };
            const thaiDate = now.toLocaleDateString('th-TH', dateOptions);
            const thaiTime = now.toLocaleTimeString('th-TH', timeOptions);
            document.getElementById('datetime-display').innerHTML = `🕒 ${thaiDate} ${thaiTime}`;
        },
        start: () => {
            timeManager.update();
            setInterval(timeManager.update, 1000);
        }
    };

    // --- Events ---
    function setupEventListeners() {
        playPauseBtn.addEventListener('click', playerControls.togglePlay);
        video.addEventListener('playing', () => {
            document.querySelectorAll('.channel-tile.loading').forEach(t => t.classList.remove('loading'));
            showLoadingIndicator(false);
            video.classList.add('visible'); 
        });
        video.addEventListener('pause', () => { playerControls.updatePlayButton(); playerControls.showControls(); });
        video.addEventListener('loadedmetadata', playerControls.checkIfLive);
        progressBar.addEventListener('input', playerControls.setProgress);
        video.addEventListener('timeupdate', playerControls.updateProgress);
        muteBtn.addEventListener('click', playerControls.toggleMute);
        volumeSlider.addEventListener('input', playerControls.setVolume);
        fullscreenBtn.addEventListener('click', playerControls.toggleFullscreen);
        pipBtn.addEventListener('click', playerControls.togglePip);
        themeToggleBtn.addEventListener('click', () => {
            body.classList.toggle('light-theme');
            const isLight = body.classList.contains('light-theme');
            themeToggleBtn.innerHTML = isLight ? '<i class="bi bi-moon-fill"></i>' : '<i class="bi bi-sun-fill"></i>';
            localStorage.setItem('webtv_theme', isLight ? 'light' : 'dark');
        });
        refreshChannelsBtn.addEventListener('click', () => {
            refreshChannelsBtn.classList.add('refresh-active');
            fetchAndRenderChannels();
            setTimeout(() => refreshChannelsBtn.classList.remove('refresh-active'), 1000);
        });
        playOverlay.addEventListener('click', () => {
            playOverlay.classList.add('hidden');
            showLoadingIndicator(true, 'กำลังเชื่อมต่อ...');
            playerControls.togglePlay();
        });
        video.addEventListener('play', () => {
            playOverlay.classList.add('hidden');
            playerControls.updatePlayButton();
            playerControls.showControls();
        });
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
    }

    // --- Data Fetching (static) ---
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
            const response = await fetch('channels.json', { cache: 'no-store' });
            if (!response.ok) throw new Error('โหลด channels.json ไม่ได้');
            channels = await response.json();
            channelManager.createChannelButtons();
        } catch (e) {
            console.error("Could not fetch channels:", e);
            playerControls.showError("ไม่สามารถรีเฟรชรายการช่องได้");
            channelButtonsContainer.innerHTML = '';
        } finally {
            showLoadingIndicator(false);
        }
    }

    // --- Init ---
    async function init() {
        const savedTheme = localStorage.getItem('webtv_theme');
        if (savedTheme === 'light') {
            body.classList.add('light-theme');
            themeToggleBtn.innerHTML = '<i class="bi bi-moon-fill"></i>';
        } else {
            themeToggleBtn.innerHTML = '<i class="bi bi-sun-fill"></i>';
        }

        await fetchAndRenderChannels();

        setupEventListeners();
        timeManager.start();

        const savedVolume = localStorage.getItem('webtv_volume');
        const savedMuted = localStorage.getItem('webtv_muted') === 'true' || localStorage.getItem('webtv_muted') === null;
        video.volume = savedVolume !== null ? savedVolume : 0.5;
        volumeSlider.value = savedVolume !== null ? savedVolume : 0.5;
        video.muted = savedMuted;
        playerControls.updateMuteButton();
        document.addEventListener('click', unlockAudio, { once: true });
        document.addEventListener('keydown', unlockAudio, { once: true });

        const lastChannelId = localStorage.getItem('webtv_lastChannelId');
        if (lastChannelId && channels[lastChannelId]) {
            await channelManager.loadChannel(lastChannelId);
        }
    }

    init();
});



// === Presence (InfinityFree API) ===
const API_BASE = "https://flow-tv.infy.uk/api"; // TODO: เปลี่ยนเป็นโดเมนจริงของคุณ
const VIEWER_TTL_SECONDS = 30;
let viewerId = localStorage.getItem('webtv_viewerId');
if (!viewerId) {
  viewerId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  localStorage.setItem('webtv_viewerId', viewerId);
}

const viewerEl = document.getElementById('viewer-count-display');
if (viewerEl) viewerEl.style.display = 'block';

async function sendHeartbeat() {
  if (!currentChannelId) return;
  try {
    await fetch(`${API_BASE}/heartbeat.php`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ channel_id: currentChannelId, viewer_id: viewerId })
    });
  } catch (e) { /* ignore */ }
}

async function refreshViewerCount() {
  if (!currentChannelId) { if (viewerEl) viewerEl.textContent = ''; return; }
  try {
    const res = await fetch(`${API_BASE}/get_viewers.php?channel_id=${encodeURIComponent(currentChannelId)}&ttl=${VIEWER_TTL_SECONDS}`);
    const data = await res.json();
    if (data && data.ok && viewerEl) viewerEl.textContent = `👥 กำลังดู: ${data.viewers}`;
  } catch (e) { /* ignore */ }
}

let hbTimer, vcTimer;
function startPresence() {
  clearInterval(hbTimer); clearInterval(vcTimer);
  hbTimer = setInterval(sendHeartbeat, 15000);
  vcTimer = setInterval(refreshViewerCount, 15000);
  sendHeartbeat(); refreshViewerCount();
}
function stopPresence() { clearInterval(hbTimer); clearInterval(vcTimer); }

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPresence(); else startPresence();
});
if (typeof video !== 'undefined' && video) {
  video.addEventListener('playing', startPresence);
  video.addEventListener('pause', stopPresence);
}
