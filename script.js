// Base de Datos IndexedDB[cite: 11]
let db;
const dbRequest = indexedDB.open("MusicPlayerDB", 1);
dbRequest.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("songs")) {
    db.createObjectStore("songs", { keyPath: "id", autoIncrement: true });
  }
};
dbRequest.onsuccess = (e) => {
  db = e.target.result;
  loadStoredSongs();
};

// Doble Audio Player[cite: 11]
const audio1 = document.getElementById('audio-player-1');
const audio2 = document.getElementById('audio-player-2');
let activeAudio = audio1;

// DOM Elementos[cite: 11]
const appLayout = document.getElementById('app-layout');
const playerCard = document.getElementById('player-card');
const playerBgFluid = document.getElementById('player-bg-fluid');
const playBtn = document.getElementById('play');
const playIcon = document.getElementById('play-icon');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const shuffleBtn = document.getElementById('shuffle');
const loopBtn = document.getElementById('loop');
const title = document.getElementById('title');
const artist = document.getElementById('artist');
const cover = document.getElementById('cover');
const btnFav = document.getElementById('btn-fav');

const progressContainer = document.getElementById('progress-container');
const progress = document.getElementById('progress');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');
const volumeSlider = document.getElementById('volume');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const playlistEl = document.getElementById('playlist');
const btnCreatePlaylist = document.getElementById('btn-create-playlist');
const btnBackPlaylist = document.getElementById('btn-back-playlist');

const playlistViewHeader = document.getElementById('playlist-view-header');
const playlistViewCover = document.getElementById('playlist-view-cover');
const playlistViewTitle = document.getElementById('playlist-view-title');
const btnRenamePlaylist = document.getElementById('btn-rename-playlist');
const btnDeletePlaylist = document.getElementById('btn-delete-playlist');

const eqPanel = document.getElementById('eq-panel');
const btnEqToggle = document.getElementById('btn-eq-toggle');
const btnCloseEq = document.getElementById('btn-close-eq');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnFocusMode = document.getElementById('btn-focus-mode');
const btnMiniPlayer = document.getElementById('btn-mini-player');

// Modales y Menú de Ajustes[cite: 11]
const modalSettings = document.getElementById('modal-settings');
const btnMainMenu = document.getElementById('btn-main-menu');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsMainView = document.getElementById('settings-main-view');

const modalHidden = document.getElementById('modal-hidden');
const hiddenPlaylistEl = document.getElementById('hidden-playlist');
const btnOpenHidden = document.getElementById('btn-open-hidden');
const btnCloseHidden = document.getElementById('btn-close-hidden');

const modalCreatePlaylist = document.getElementById('modal-create-playlist');
const modalPlaylistTitle = document.getElementById('modal-playlist-title');
const btnCloseCreatePlaylist = document.getElementById('btn-close-create-playlist');
const btnSavePlaylist = document.getElementById('btn-save-playlist');
const inputPlaylistName = document.getElementById('input-playlist-name');

const modalSongMenu = document.getElementById('modal-song-menu');
const btnCloseSongMenu = document.getElementById('btn-close-song-menu');
const modalSongTitle = document.getElementById('modal-song-title');
const optAddToPlaylist = document.getElementById('opt-add-to-playlist');
const optHideSong = document.getElementById('opt-hide-song');
const txtHideOpt = document.getElementById('txt-hide-opt');
const optDeleteSong = document.getElementById('opt-delete-song');

const modalSelectPlaylist = document.getElementById('modal-select-playlist');
const btnCloseSelectPlaylist = document.getElementById('btn-close-select-playlist');
const targetPlaylistsList = document.getElementById('target-playlists-list');

// Temporizador[cite: 11]
const timerStatusDesc = document.getElementById('timer-status-desc');
const sleepTimerBadge = document.getElementById('sleep-timer-badge');

// Letras[cite: 11]
const lyricsPanel = document.getElementById('lyrics-panel');
const lyricsBg = document.getElementById('lyrics-bg');
const lyricsBody = document.getElementById('lyrics-body');
const btnLyricsToggle = document.getElementById('btn-lyrics-toggle');
const btnCloseLyrics = document.getElementById('btn-close-lyrics');
const btnEditLyrics = document.getElementById('btn-edit-lyrics');
const lyricsEditor = document.getElementById('lyrics-editor');
const lyricsTextarea = document.getElementById('lyrics-textarea');
const btnSaveLyrics = document.getElementById('btn-save-lyrics');

// Controles Ajustes[cite: 11]
const statPlayTimePreview = document.getElementById('stat-play-time-preview');
const statPlayTimeDetail = document.getElementById('stat-play-time-detail');
const statRankBadge = document.getElementById('stat-rank-badge');
const statRankText = document.getElementById('stat-rank-text');
const bgVideo = document.getElementById('bg-video');
const bgCustomImage = document.getElementById('bg-custom-image');
const inputBgImage = document.getElementById('input-bg-image');
const inputBgVideo = document.getElementById('input-bg-video');
const btnRemoveBg = document.getElementById('btn-remove-bg');
const selectFont = document.getElementById('select-font');
const inputCustomColor = document.getElementById('input-custom-color');
const btnFactoryReset = document.getElementById('btn-factory-reset');

const togglePerformanceMode = document.getElementById('toggle-performance-mode');
const toggleSFX = document.getElementById('toggle-sfx');

const toggleBgPlay = document.getElementById('toggle-bg-play');
const toggleGapless = document.getElementById('toggle-gapless');
const toggleCrossfade = document.getElementById('toggle-crossfade');
const toggleShowIcon = document.getElementById('toggle-show-icon');
const toggleShowName = document.getElementById('toggle-show-name');
const toggleMediaKeys = document.getElementById('toggle-media-keys');

// Estado[cite: 11]
let songList = [];
let playlists = JSON.parse(localStorage.getItem('playlistsDB') || '{}');
let currentIndex = 0;
let selectedSongForMenu = null;
let currentPlaylistView = null;
let isShuffle = false;
let isLoop = false;
let currentTab = 'all-songs';
let totalPlayedSeconds = parseInt(localStorage.getItem('totalPlayedSeconds') || '0');
let sleepTimerInterval = null;
let sleepTimeRemaining = 0;
let editingPlaylistName = null;
let sfxEnabled = true;

// Atajos por defecto[cite: 11]
let hotkeys = {
  playPause: 'Space',
  nextTrack: 'ArrowRight',
  prevTrack: 'ArrowLeft',
  toggleFocus: 'KeyF',
  toggleMute: 'KeyM'
};

// EFECTOS DE SONIDO (SFX Sintetizados)[cite: 11]
function playSFX(type = 'click') {
  if (!sfxEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'open') {
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    } else if (type === 'close') {
      osc.frequency.setValueAtTime(500, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    } else {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    }

    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  } catch (e) {}
}

// Web Audio API Ecualizador[cite: 11]
let audioCtx, track1, track2, filter60, filter1000, filter12000;

function initAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  track1 = audioCtx.createMediaElementSource(audio1);
  track2 = audioCtx.createMediaElementSource(audio2);

  filter60 = audioCtx.createBiquadFilter();
  filter60.type = "lowshelf";
  filter60.frequency.value = 60;

  filter1000 = audioCtx.createBiquadFilter();
  filter1000.type = "peaking";
  filter1000.frequency.value = 1000;

  filter12000 = audioCtx.createBiquadFilter();
  filter12000.type = "highshelf";
  filter12000.frequency.value = 12000;

  track1.connect(filter60);
  track2.connect(filter60);
  filter60.connect(filter1000);
  filter1000.connect(filter12000);
  filter12000.connect(audioCtx.destination);
}

// Integración de Media Session API (F7 / Teclas Multimedia y Panel del Sistema)
function updateMediaSession(song) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || "Sin canción cargada",
      artist: song.artist || "Reproductor Studio Pro",
      album: "Mi Música",
      artwork: [
        { src: song.cover, sizes: '96x96', type: 'image/jpeg' },
        { src: song.cover, sizes: '128x128', type: 'image/jpeg' },
        { src: song.cover, sizes: '192x192', type: 'image/jpeg' },
        { src: song.cover, sizes: '256x256', type: 'image/jpeg' },
        { src: song.cover, sizes: '384x384', type: 'image/jpeg' },
        { src: song.cover, sizes: '512x512', type: 'image/jpeg' },
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => { playSong(); });
    navigator.mediaSession.setActionHandler('pause', () => { pauseSong(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { prevBtn.click(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { nextBtn.click(); });
  }
}

// Contador de tiempo de reproducción[cite: 11]
setInterval(() => {
  if (playerCard.classList.contains('playing')) {
    totalPlayedSeconds++;
    localStorage.setItem('totalPlayedSeconds', totalPlayedSeconds.toString());
    updateTimeStatDisplay();
  }
}, 1000);

function updateTimeStatDisplay() {
  const hours = Math.floor(totalPlayedSeconds / 3600);
  const minutes = Math.floor((totalPlayedSeconds % 3600) / 60);
  const seconds = totalPlayedSeconds % 60;
  
  statPlayTimePreview.textContent = `${hours}h ${minutes}m`;
  statPlayTimeDetail.textContent = `${hours}h ${minutes}m ${seconds}s`;

  let rank = "Principiante";
  if (hours >= 1000) rank = "Infinito Hacker";
  else if (hours >= 500) rank = "Pro Maestro";
  else if (hours >= 100) rank = "Avanzado";
  else if (hours >= 10) rank = "Aficionado";

  statRankBadge.textContent = rank;
  statRankText.textContent = rank;
}
updateTimeStatDisplay();

// Temporizador de Apagado[cite: 11]
document.querySelectorAll('.timer-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    const mins = parseInt(e.target.dataset.minutes);
    startSleepTimer(mins);
  });
});

function startSleepTimer(minutes) {
  clearInterval(sleepTimerInterval);
  if (minutes <= 0) {
    sleepTimeRemaining = 0;
    timerStatusDesc.textContent = "Desactivado";
    sleepTimerBadge.classList.add('hidden');
    return;
  }
  sleepTimeRemaining = minutes * 60;
  updateTimerUI();
  
  sleepTimerInterval = setInterval(() => {
    sleepTimeRemaining--;
    if (sleepTimeRemaining <= 0) {
      clearInterval(sleepTimerInterval);
      pauseSong();
      timerStatusDesc.textContent = "Desactivado";
      sleepTimerBadge.classList.add('hidden');
    } else {
      updateTimerUI();
    }
  }, 1000);
}

function updateTimerUI() {
  const m = Math.floor(sleepTimeRemaining / 60);
  const s = sleepTimeRemaining % 60;
  const str = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  timerStatusDesc.textContent = `Apagado en ${str}`;
  sleepTimerBadge.textContent = str;
  sleepTimerBadge.classList.remove('hidden');
}

// Carga e IndexedDB[cite: 11]
function saveSongToDB(songObj) {
  if (!db) return;
  const transaction = db.transaction(["songs"], "readwrite");
  transaction.objectStore("songs").add(songObj);
}

function loadStoredSongs() {
  if (!db) return;
  const transaction = db.transaction(["songs"], "readonly");
  const request = transaction.objectStore("songs").getAll();
  request.onsuccess = () => {
    if (request.result.length > 0) {
      songList = request.result.map(song => ({
        ...song,
        url: URL.createObjectURL(song.fileBlob)
      }));
      renderPlaylist();
      loadSong(0, false);
    }
  };
}

function handleFiles(files) {
  Array.from(files).forEach((file) => {
    const songObj = {
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: "Artista Desconocido",
      cover: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80",
      lyrics: "No hay letra cargada.",
      isFav: false,
      isHidden: false,
      fileBlob: file
    };

    if (window.jsmediatags) {
      window.jsmediatags.read(file, {
        onSuccess: function(tag) {
          const tags = tag.tags;
          if (tags.title) songObj.title = tags.title;
          if (tags.artist) songObj.artist = tags.artist;
          if (tags.picture) {
            const { data, format } = tags.picture;
            let base64String = "";
            for (let i = 0; i < data.length; i++) base64String += String.fromCharCode(data[i]);
            songObj.cover = `data:${format};base64,${window.btoa(base64String)}`;
          }
          processAndSave(songObj);
        },
        onError: function() { processAndSave(songObj); }
      });
    } else {
      processAndSave(songObj);
    }
  });
}

function processAndSave(songObj) {
  saveSongToDB(songObj);
  songObj.url = URL.createObjectURL(songObj.fileBlob);
  songList.push(songObj);
  renderPlaylist();
  if (songList.length === 1) loadSong(0, false);
}

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

// CONTROL DE REPRODUCCIÓN (CON MEDIA SESSION INTEGRADA)[cite: 11]
function loadSong(index, shouldPlay = true) {
  if (index < 0 || index >= songList.length) return;
  currentIndex = index;
  const song = songList[currentIndex];

  title.textContent = song.title;
  artist.textContent = song.artist;
  cover.src = song.cover;
  playerBgFluid.style.backgroundImage = `url(${song.cover})`;
  lyricsBg.style.backgroundImage = `url(${song.cover})`;

  btnFav.classList.toggle('active', song.isFav);
  displayLyrics(song.lyrics);

  // Actualizar metadatos para la tecla F7 / Controles del sistema
  updateMediaSession(song);

  // Detener reproducciones activas para evitar bucles corruptos[cite: 11]
  audio1.pause();
  audio2.pause();

  if (shouldPlay) {
    if (toggleCrossfade.checked) {
      playSongWithCrossfade(song.url);
    } else {
      activeAudio.src = song.url;
      activeAudio.currentTime = 0;
      playSong();
    }
  } else {
    activeAudio.src = song.url;
    activeAudio.currentTime = 0;
  }

  renderPlaylist();
}

function playSongWithCrossfade(newUrl) {
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  const nextAudio = (activeAudio === audio1) ? audio2 : audio1;
  const currentAudio = activeAudio;

  nextAudio.src = newUrl;
  nextAudio.currentTime = 0;
  nextAudio.volume = 0;

  const playPromise = nextAudio.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      let step = 0.05;
      let interval = 60;

      let fade = setInterval(() => {
        if (currentAudio.volume > step) currentAudio.volume -= step;
        else { currentAudio.volume = 0; currentAudio.pause(); }

        if (nextAudio.volume < parseFloat(volumeSlider.value) - step) nextAudio.volume += step;
        else { nextAudio.volume = parseFloat(volumeSlider.value); clearInterval(fade); }
      }, interval);

      activeAudio = nextAudio;
      playerCard.classList.add('playing');
      playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    }).catch(err => {
      console.error("Error al reproducir crossfade:", err);
    });
  }
}

function playSong() {
  if (songList.length === 0) return;
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  activeAudio.volume = parseFloat(volumeSlider.value);
  const playPromise = activeAudio.play();
  
  if (playPromise !== undefined) {
    playPromise.then(() => {
      playerCard.classList.add('playing');
      playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    }).catch(err => console.error("Error en reproducción:", err));
  }
}

function pauseSong() {
  playerCard.classList.remove('playing');
  playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  activeAudio.pause();
}

playBtn.addEventListener('click', () => {
  playSFX('click');
  playerCard.classList.contains('playing') ? pauseSong() : playSong();
});

nextBtn.addEventListener('click', () => {
  playSFX('click');
  if (songList.length === 0) return;
  currentIndex = isShuffle ? Math.floor(Math.random() * songList.length) : (currentIndex + 1) % songList.length;
  loadSong(currentIndex);
});

prevBtn.addEventListener('click', () => {
  playSFX('click');
  if (songList.length === 0) return;
  currentIndex = (currentIndex - 1 + songList.length) % songList.length;
  loadSong(currentIndex);
});

shuffleBtn.addEventListener('click', () => {
  playSFX('click');
  isShuffle = !isShuffle;
  shuffleBtn.classList.toggle('active', isShuffle);
});

loopBtn.addEventListener('click', () => {
  playSFX('click');
  isLoop = !isLoop;
  loopBtn.classList.toggle('active', isLoop);
});

[audio1, audio2].forEach(a => {
  a.addEventListener('ended', () => {
    if (isLoop) {
      a.currentTime = 0;
      a.play();
    } else {
      nextBtn.click();
    }
  });
});

btnFav.addEventListener('click', () => {
  playSFX('click');
  if (songList.length === 0) return;
  songList[currentIndex].isFav = !songList[currentIndex].isFav;
  btnFav.classList.toggle('active', songList[currentIndex].isFav);
  renderPlaylist();
});

// MODO ENFOQUE FLOTANTE Y ARRASTRABLE (DRAGGABLE)[cite: 11]
let isDragging = false;
let dragStartX, dragStartY, cardStartX, cardStartY;

btnFocusMode.addEventListener('click', () => {
  playSFX('open');
  const isFocus = document.body.classList.toggle('focus-mode');
  btnFocusMode.classList.toggle('active', isFocus);

  if (!isFocus) {
    playerCard.style.position = '';
    playerCard.style.left = '';
    playerCard.style.top = '';
    playerCard.style.transform = '';
  } else {
    playerCard.style.position = 'fixed';
    playerCard.style.top = '50%';
    playerCard.style.left = '50%';
    playerCard.style.transform = 'translate(-50%, -50%)';
  }
});

playerCard.addEventListener('mousedown', (e) => {
  if (!document.body.classList.contains('focus-mode')) return;
  if (e.target.closest('button') || e.target.closest('input')) return;

  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  const rect = playerCard.getBoundingClientRect();
  cardStartX = rect.left;
  cardStartY = rect.top;

  playerCard.style.transform = 'none';
  playerCard.style.left = `${cardStartX}px`;
  playerCard.style.top = `${cardStartY}px`;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  playerCard.style.left = `${cardStartX + dx}px`;
  playerCard.style.top = `${cardStartY + dy}px`;
});

window.addEventListener('mouseup', () => { isDragging = false; });

// Pantalla Completa[cite: 11]
btnFullscreen.addEventListener('click', () => {
  playSFX('click');
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => console.error(err));
  else if (document.exitFullscreen) document.exitFullscreen();
});

// Mini Player[cite: 11]
btnMiniPlayer.addEventListener('click', () => {
  playSFX('open');
  const miniWin = window.open("", "MiniPlayer", "width=340,height=220,resizable=no");
  if (miniWin) {
    miniWin.document.body.innerHTML = `
      <style>
        body { background: #12131c; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
        h4 { margin: 8px 0 2px 0; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 90%; }
        p { margin: 0 0 12px 0; font-size: 0.75rem; color: #8a99ad; }
        .controls { display: flex; gap: 10px; }
        button { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 14px; border-radius: 8px; cursor: pointer; }
      </style>
      <h4 id="mini-title">${title.textContent}</h4>
      <p id="mini-artist">${artist.textContent}</p>
      <div class="controls">
        <button onclick="window.opener.document.getElementById('prev').click()">Anterior</button>
        <button onclick="window.opener.document.getElementById('play').click()">Play/Pausa</button>
        <button onclick="window.opener.document.getElementById('next').click()">Siguiente</button>
      </div>
    `;
  }
});

btnEqToggle.addEventListener('click', () => { playSFX('click'); eqPanel.classList.toggle('hidden'); });
btnCloseEq.addEventListener('click', () => { playSFX('close'); eqPanel.classList.add('hidden'); });

// PESTAÑAS DE BIBLIOTECA (CANCIONES / PLAYLISTS / ME GUSTA)[cite: 11]
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentTab = e.target.dataset.tab;
    currentPlaylistView = null;
    btnBackPlaylist.classList.add('hidden');
    playlistViewHeader.classList.add('hidden');
    btnCreatePlaylist.classList.toggle('hidden', currentTab !== 'playlists');
    renderPlaylist();
  });
});

btnBackPlaylist.addEventListener('click', () => {
  playSFX('close');
  currentPlaylistView = null;
  btnBackPlaylist.classList.add('hidden');
  playlistViewHeader.classList.add('hidden');
  renderPlaylist();
});

// Guardar Playlists[cite: 11]
function savePlaylistsToStorage() {
  localStorage.setItem('playlistsDB', JSON.stringify(playlists));
}

// RENDERIZADO DE BIBLIOTECA[cite: 11]
function renderPlaylist() {
  playlistEl.innerHTML = '';

  if (currentTab === 'playlists' && !currentPlaylistView) {
    const pKeys = Object.keys(playlists);
    if (pKeys.length === 0) {
      playlistEl.innerHTML = '<li class="empty-msg">No hay playlists creadas</li>';
      return;
    }
    pKeys.forEach(pName => {
      const pSongs = playlists[pName] || [];
      const coverUrl = pSongs.length > 0 ? pSongs[0].cover : "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80";

      const li = document.createElement('li');
      li.className = 'playlist-item';
      li.innerHTML = `
        <img src="${coverUrl}" class="item-thumb">
        <div class="item-details" style="padding: 10px;">
          <div class="item-title">${pName}</div>
          <div class="item-artist">${pSongs.length} canciones</div>
        </div>
      `;
      li.addEventListener('click', () => {
        playSFX('open');
        currentPlaylistView = pName;
        btnBackPlaylist.classList.remove('hidden');
        renderPlaylist();
      });
      playlistEl.appendChild(li);
    });
    return;
  }

  if (currentPlaylistView) {
    const pSongs = playlists[currentPlaylistView] || [];
    playlistViewTitle.textContent = currentPlaylistView;
    playlistViewCover.src = pSongs.length > 0 ? pSongs[0].cover : "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80";
    playlistViewHeader.classList.remove('hidden');

    if (pSongs.length === 0) {
      playlistEl.innerHTML = '<li class="empty-msg">Playlist vacía. Agrega canciones usando el menú de 3 puntos.</li>';
      return;
    }

    pSongs.forEach((song, pIndex) => {
      const realIndex = songList.indexOf(song);
      const li = document.createElement('li');
      li.className = `playlist-item ${realIndex === currentIndex ? 'active' : ''}`;
      li.innerHTML = `
        <img src="${song.cover}" class="item-thumb">
        <div class="item-details">
          <div class="item-title">${song.title}</div>
          <div class="item-artist">${song.artist}</div>
        </div>
        <button class="item-remove-btn" title="Quitar de la Playlist">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;

      li.querySelector('.item-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        playSFX('click');
        playlists[currentPlaylistView].splice(pIndex, 1);
        savePlaylistsToStorage();
        renderPlaylist();
      });

      li.addEventListener('click', () => {
        if (realIndex > -1) loadSong(realIndex);
      });
      playlistEl.appendChild(li);
    });
    return;
  }

  let filtered = songList.filter(s => !s.isHidden);
  if (currentTab === 'favorites') filtered = filtered.filter(s => s.isFav);

  if (filtered.length === 0) {
    playlistEl.innerHTML = '<li class="empty-msg">Sin canciones disponibles</li>';
    return;
  }

  filtered.forEach((song) => {
    const realIndex = songList.indexOf(song);
    const li = document.createElement('li');
    li.className = `playlist-item ${realIndex === currentIndex ? 'active' : ''}`;
    li.innerHTML = `
      <div class="item-bg-cover" style="background-image: url('${song.cover}')"></div>
      <img src="${song.cover}" class="item-thumb">
      <div class="item-details">
        <div class="item-title">${song.title}</div>
        <div class="item-artist">${song.artist}</div>
      </div>
      <button class="item-menu-btn" title="Opciones">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>
    `;

    li.querySelector('.item-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      playSFX('open');
      openSongMenu(song);
    });

    li.addEventListener('click', () => loadSong(realIndex));
    playlistEl.appendChild(li);
  });
}

// EDITAR Y ELIMINAR PLAYLISTS[cite: 11]
btnRenamePlaylist.addEventListener('click', () => {
  if (!currentPlaylistView) return;
  playSFX('open');
  editingPlaylistName = currentPlaylistView;
  modalPlaylistTitle.textContent = "Renombrar Playlist";
  inputPlaylistName.value = currentPlaylistView;
  openModal(modalCreatePlaylist);
});

btnDeletePlaylist.addEventListener('click', () => {
  if (!currentPlaylistView) return;
  playSFX('click');
  if (confirm(`¿Seguro que deseas eliminar la playlist "${currentPlaylistView}"?`)) {
    delete playlists[currentPlaylistView];
    savePlaylistsToStorage();
    currentPlaylistView = null;
    btnBackPlaylist.classList.add('hidden');
    playlistViewHeader.classList.add('hidden');
    renderPlaylist();
  }
});

// CREAR O RENOMBRAR PLAYLIST (MODAL)[cite: 11]
btnCreatePlaylist.addEventListener('click', () => {
  playSFX('open');
  editingPlaylistName = null;
  modalPlaylistTitle.textContent = "Nueva Playlist";
  inputPlaylistName.value = '';
  openModal(modalCreatePlaylist);
});

btnCloseCreatePlaylist.addEventListener('click', () => { playSFX('close'); closeModal(modalCreatePlaylist); });

btnSavePlaylist.addEventListener('click', () => {
  playSFX('click');
  const name = inputPlaylistName.value.trim();
  if (!name) return;

  if (editingPlaylistName) {
    if (editingPlaylistName !== name) {
      playlists[name] = playlists[editingPlaylistName];
      delete playlists[editingPlaylistName];
      currentPlaylistView = name;
    }
  } else {
    if (!playlists[name]) playlists[name] = [];
  }

  savePlaylistsToStorage();
  closeModal(modalCreatePlaylist);
  renderPlaylist();
});

// MENÚ DE AJUSTES MODULAR (SLIDE)[cite: 11]
btnMainMenu.addEventListener('click', () => { playSFX('open'); modalSettings.classList.add('active'); });
btnCloseSettings.addEventListener('click', () => { playSFX('close'); closeModalSettings(); });

function closeModalSettings() {
  modalSettings.classList.remove('active');
  resetSettingsSlide();
}

function resetSettingsSlide() {
  settingsMainView.classList.remove('slide-out');
  document.querySelectorAll('.settings-sub-panel').forEach(p => p.classList.remove('slide-in'));
}

document.querySelectorAll('.setting-card-item[data-target]').forEach(card => {
  card.addEventListener('click', (e) => {
    playSFX('open');
    const targetId = e.currentTarget.dataset.target;
    const subPanel = document.getElementById(targetId);
    if (subPanel) {
      settingsMainView.classList.add('slide-out');
      subPanel.classList.add('slide-in');
    }
  });
});

document.querySelectorAll('.btn-sub-back').forEach(btn => {
  btn.addEventListener('click', () => { playSFX('close'); resetSettingsSlide(); });
});

// AJUSTES: RENDIMIENTO, SFX, FUENTES Y RESTABLECIMIENTO[cite: 11]
togglePerformanceMode.addEventListener('change', (e) => {
  document.body.classList.toggle('performance-mode', e.target.checked);
});

toggleSFX.addEventListener('change', (e) => {
  sfxEnabled = e.target.checked;
});

document.querySelectorAll('.font-size-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.font-size-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    const size = e.target.dataset.fontsize;
    if (size === 'small') document.documentElement.style.setProperty('--font-base-size', '14px');
    else if (size === 'medium') document.documentElement.style.setProperty('--font-base-size', '16px');
    else if (size === 'large') document.documentElement.style.setProperty('--font-base-size', '18px');
  });
});

btnFactoryReset.addEventListener('click', () => {
  playSFX('click');
  if (confirm("¿Estás seguro de restablecer toda la configuración y la interfaz a los valores predeterminados?")) {
    localStorage.clear();
    location.reload();
  }
});

// MODALES FUNCIONALES[cite: 11]
function openModal(modal) { modal.classList.add('active'); }
function closeModal(modal) { modal.classList.remove('active'); }

btnOpenHidden.addEventListener('click', () => { playSFX('open'); renderHiddenList(); openModal(modalHidden); });
btnCloseHidden.addEventListener('click', () => { playSFX('close'); closeModal(modalHidden); });

function renderHiddenList() {
  hiddenPlaylistEl.innerHTML = '';
  const hiddenSongs = songList.filter(s => s.isHidden);
  if (hiddenSongs.length === 0) {
    hiddenPlaylistEl.innerHTML = '<li class="empty-msg">No hay canciones ocultas</li>';
    return;
  }
  hiddenSongs.forEach(song => {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    li.innerHTML = `
      <img src="${song.cover}" class="item-thumb">
      <div class="item-details"><div class="item-title">${song.title}</div></div>
      <button class="item-menu-btn" title="Opciones">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>
    `;
    li.querySelector('.item-menu-btn').addEventListener('click', (e) => { e.stopPropagation(); playSFX('open'); openSongMenu(song); });
    hiddenPlaylistEl.appendChild(li);
  });
}

function openSongMenu(song) {
  selectedSongForMenu = song;
  modalSongTitle.textContent = song.title;
  txtHideOpt.textContent = song.isHidden ? "Mostrar Canción" : "Ocultar Canción";
  openModal(modalSongMenu);
}
btnCloseSongMenu.addEventListener('click', () => { playSFX('close'); closeModal(modalSongMenu); });

optHideSong.addEventListener('click', () => {
  playSFX('click');
  if (selectedSongForMenu) {
    selectedSongForMenu.isHidden = !selectedSongForMenu.isHidden;
    closeModal(modalSongMenu);
    renderPlaylist();
    renderHiddenList();
  }
});

optDeleteSong.addEventListener('click', () => {
  playSFX('click');
  if (selectedSongForMenu) {
    const idx = songList.indexOf(selectedSongForMenu);
    if (idx > -1) songList.splice(idx, 1);
    closeModal(modalSongMenu);
    renderPlaylist();
    renderHiddenList();
  }
});

optAddToPlaylist.addEventListener('click', () => {
  playSFX('open');
  closeModal(modalSongMenu);
  renderTargetPlaylists();
  openModal(modalSelectPlaylist);
});
btnCloseSelectPlaylist.addEventListener('click', () => { playSFX('close'); closeModal(modalSelectPlaylist); });

function renderTargetPlaylists() {
  targetPlaylistsList.innerHTML = '';
  const pKeys = Object.keys(playlists);
  if (pKeys.length === 0) {
    targetPlaylistsList.innerHTML = '<li class="empty-msg">Crea una playlist primero</li>';
    return;
  }
  pKeys.forEach(pName => {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    li.innerHTML = `<div class="item-details" style="padding:10px;"><div class="item-title">${pName}</div></div>`;
    li.addEventListener('click', () => {
      playSFX('click');
      if (selectedSongForMenu && !playlists[pName].some(s => s.title === selectedSongForMenu.title)) {
        playlists[pName].push(selectedSongForMenu);
        savePlaylistsToStorage();
      }
      closeModal(modalSelectPlaylist);
    });
    targetPlaylistsList.appendChild(li);
  });
}

// Configuración de Estilos[cite: 11]
document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    playlistEl.className = `playlist-view list-${e.target.dataset.size}`;
  });
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    if (e.target.dataset.mode === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
  });
});

document.querySelectorAll('.color-dot').forEach(dot => {
  dot.addEventListener('click', (e) => {
    playSFX('click');
    const color = e.currentTarget.dataset.color;
    if (color) {
      document.documentElement.style.setProperty('--primary-color', color);
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      e.currentTarget.classList.add('active');
    }
  });
});

inputCustomColor.addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--primary-color', e.target.value);
});

inputBgImage.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    bgCustomImage.style.backgroundImage = `url('${URL.createObjectURL(file)}')`;
    bgCustomImage.style.display = 'block';
    bgVideo.classList.add('bg-video-hidden');
    bgVideo.pause();
  }
});

inputBgVideo.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    bgVideo.src = URL.createObjectURL(file);
    bgVideo.classList.remove('bg-video-hidden');
    bgVideo.play();
    bgCustomImage.style.display = 'none';
  }
});

btnRemoveBg.addEventListener('click', () => {
  playSFX('click');
  bgCustomImage.style.display = 'none';
  bgVideo.classList.add('bg-video-hidden');
  bgVideo.pause();
  bgVideo.src = '';
});

selectFont.addEventListener('change', (e) => {
  document.body.style.fontFamily = e.target.value;
});

// Atajos de Teclado Personalizables[cite: 11]
let recordingAction = null;

document.querySelectorAll('.hotkey-bind-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    recordingAction = e.target.dataset.action;
    e.target.textContent = "Presiona Tecla...";
    e.target.classList.add('recording');
  });
});

window.addEventListener('keydown', (e) => {
  if (recordingAction) {
    e.preventDefault();
    hotkeys[recordingAction] = e.code;
    const btn = document.querySelector(`.hotkey-bind-btn[data-action="${recordingAction}"]`);
    if (btn) {
      btn.textContent = e.code;
      btn.classList.remove('recording');
    }
    recordingAction = null;
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === hotkeys.playPause) { e.preventDefault(); playBtn.click(); }
  else if (e.code === hotkeys.nextTrack) { e.preventDefault(); nextBtn.click(); }
  else if (e.code === hotkeys.prevTrack) { e.preventDefault(); prevBtn.click(); }
  else if (e.code === hotkeys.toggleFocus) { e.preventDefault(); btnFocusMode.click(); }
  else if (e.code === hotkeys.toggleMute) { e.preventDefault(); activeAudio.muted = !activeAudio.muted; }
});

// Progreso y Letras[cite: 11]
[audio1, audio2].forEach(a => {
  a.addEventListener('timeupdate', () => {
    if (a !== activeAudio) return;
    const { duration, currentTime } = a;
    if (isNaN(duration)) return;
    progress.style.width = `${(currentTime / duration) * 100}%`;
    const format = (t) => Math.floor(t / 60) + ':' + ('0' + Math.floor(t % 60)).slice(-2);
    currentTimeEl.textContent = format(currentTime);
    durationEl.textContent = format(duration);

    const lines = lyricsBody.querySelectorAll('.lyrics-line');
    if (lines.length > 0) {
      const lineIndex = Math.floor((currentTime / duration) * lines.length);
      lines.forEach((l, idx) => {
        if (idx === lineIndex) {
          l.classList.add('active');
          l.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          l.classList.remove('active');
        }
      });
    }
  });
});

progressContainer.addEventListener('click', (e) => {
  activeAudio.currentTime = (e.offsetX / progressContainer.clientWidth) * activeAudio.duration;
});

volumeSlider.addEventListener('input', (e) => {
  activeAudio.volume = e.target.value;
});

btnLyricsToggle.addEventListener('click', () => { playSFX('open'); lyricsPanel.classList.add('active'); });
btnCloseLyrics.addEventListener('click', () => { playSFX('close'); lyricsPanel.classList.remove('active'); });

function displayLyrics(text) {
  lyricsBody.innerHTML = '';
  text.split('\n').forEach(line => {
    const p = document.createElement('p');
    p.className = 'lyrics-line';
    p.textContent = line || '...';
    lyricsBody.appendChild(p);
  });
}

btnEditLyrics.addEventListener('click', () => {
  playSFX('click');
  if (songList.length === 0) return;
  lyricsTextarea.value = songList[currentIndex].lyrics;
  lyricsBody.classList.add('hidden');
  lyricsEditor.classList.remove('hidden');
});

btnSaveLyrics.addEventListener('click', () => {
  playSFX('click');
  const newLyrics = lyricsTextarea.value;
  songList[currentIndex].lyrics = newLyrics;
  displayLyrics(newLyrics);
  lyricsEditor.classList.add('hidden');
  lyricsBody.classList.remove('hidden');
});
