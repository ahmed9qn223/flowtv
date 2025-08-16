/* ====== ช่วยเลือก DOM ง่าย ๆ ====== */
const $  = (s,ctx=document)=>ctx.querySelector(s);
const $$ = (s,ctx=document)=>Array.from(ctx.querySelectorAll(s));

/* ====== นาฬิกา (เวลาไทย) ====== */
function startClock(){
  const el = $('#clock'); if(!el) return;
  const tick = ()=>{
    const d = new Date();
    const th = new Intl.DateTimeFormat('th-TH',{
      year:'numeric', month:'short', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      hour12:false, timeZone:'Asia/Bangkok'
    }).format(d).replace(/\s+/g,' ');
    el.textContent = th.replace(',','');
  };
  tick(); setInterval(tick,1000);
}
startClock();

/* ====== แสดงชื่อช่องใต้เวลา ====== */
function ensureNowPlayingEl(){
  let el = $('#now-playing');
  if(!el){ el = document.createElement('div'); el.id='now-playing'; $('.h-wrap')?.appendChild(el); }
  return el;
}

/* ====== Toast ชื่อช่องบนวิดีโอ (มือถือ) ====== */
function getToast(){
  let t = $('#mini-toast');
  if(!t){ t = document.createElement('div'); t.id='mini-toast'; $('#player').appendChild(t); }
  return t;
}
function showToast(el, txt){
  el.textContent = txt||''; el.classList.add('show');
  clearTimeout(showToast._t); showToast._t = setTimeout(()=>el.classList.remove('show'), 1800);
}

/* ====== จัดการ JW Player ให้ปลอดภัย (กัน error instreamAdapter) ====== */
function destroyPlayerSafely(){
  try{
    const p = window.jwplayer && jwplayer('player');
    if(!p || typeof p.getState!=='function') return;
    try{ p.pause(true); }catch(_){}
    try{ p.stop(); }catch(_){}
    try{ p.remove(); }catch(_){}
  }catch(_){}
}
function setupJW(cfg){
  destroyPlayerSafely();
  const base = {
    width:'100%', aspectratio:'16:9', autostart:true, mute:false,
    controls:true, preload:'metadata', cast:false, enableStartupScreenshot:false
  };
  const player = jwplayer('player').setup({...base, ...cfg});
  player.on('error', e=>{
    console.warn('JW error:', e);
    // อยากโชว์ banner error ก็เติม UI ของคุณเองใน index.html แล้วอัปเดตตรงนี้ได้
  });
  // toast ชื่อช่องเมื่อเริ่มเล่น (มือถือก็เห็น)
  const toast = getToast();
  player.on('play', ()=>{ if(currentChannel) showToast(toast, currentChannel.name); });
  return player;
}

/* ====== ช่องรายการ ====== */
let channels=[], currentChannel=null, currentPlayer=null;

async function loadChannels(){
  // ใช้ version.json ถ้ามี เพื่อ bust cache อัตโนมัติ
  let v=''; try{
    const vr = await fetch('version.json', {cache:'no-store'});
    if(vr.ok){ const j=await vr.json(); v='?v='+encodeURIComponent(j.updatedAt||j.commit||Date.now()); }
  }catch(_){}
  const res = await fetch('channels.json'+v, {cache:'no-store'});
  channels = await res.json().then(j=> j.channels || j);
}

function renderGrid(list){
  const grid = $('#channel-list'); if(!grid) return;
  grid.innerHTML = '';
  (list||channels).forEach((ch,idx)=>{
    const btn = document.createElement('button');
    btn.type='button'; btn.className='channel'; btn.dataset.idx=idx;
    if(ch.category) btn.dataset.category = ch.category;
    btn.innerHTML = `
      <div class="ch-card">
        <img loading="lazy" src="${ch.logo}" alt="${ch.name}">
        <div class="ch-name">${ch.name}</div>
      </div>`;
    btn.addEventListener('click', e=>{
      makeRipple(btn, e);
      setPlaying(btn);
      playChannel(ch);
    },{passive:true});
    grid.appendChild(btn);
  });
}

function setPlaying(el){
  $$('.channel.playing').forEach(x=>x.classList.remove('playing'));
  el.classList.add('playing');
}

function makeRipple(card,e){
  const r = card.getBoundingClientRect();
  const cx = (e.touches?.[0]?.clientX ?? e.clientX ?? (r.left+r.width/2));
  const cy = (e.touches?.[0]?.clientY ?? e.clientY ?? (r.top+r.height/2));
  card.style.setProperty('--x', ((cx-r.left)/r.width*100)+'%');
  card.style.setProperty('--y', ((cy-r.top )/r.height*100)+'%');
  card.classList.add('pressed'); setTimeout(()=>card.classList.remove('pressed'), 420);
}

function playChannel(ch){
  currentChannel = ch;
  ensureNowPlayingEl().textContent = ch?.name || '';
  const cfg = { file: ch.src||ch.file, type: ch.type||'dash' };
  if(ch.drm) cfg.drm = ch.drm;
  currentPlayer = setupJW(cfg);
}

/* ====== Tabs (ตัวกรอง ถ้ามีในหน้า) ====== */
function initTabs(){
  const tabs = $$('#tabs .tab'); if(!tabs.length) return;
  const grid = $('#channel-list');
  const apply = (label)=>{
    grid.classList.add('filtering');
    if(!label || label==='ทั้งหมด') renderGrid(channels);
    else{
      const f = channels.filter(c => c.category===label || c.tags?.includes(label));
      renderGrid(f.length? f : channels);
    }
    setTimeout(()=>grid.classList.remove('filtering'), 180);
  };
  tabs.forEach(b=>{
    b.addEventListener('click',()=>{
      tabs.forEach(x=>x.setAttribute('aria-selected','false'));
      b.setAttribute('aria-selected','true');
      apply(b.dataset.filter || b.textContent.trim());
    });
  });
}

/* ====== Bootstrap ====== */
(async function main(){
  try{
    await loadChannels();
    renderGrid(channels);
    initTabs();

    // เล่นช่องแรกอัตโนมัติ
    const first = $('.channel');
    if(first){
      setPlaying(first);
      playChannel(channels[parseInt(first.dataset.idx,10)]);
    }
  }catch(err){ console.error(err); }
})();
