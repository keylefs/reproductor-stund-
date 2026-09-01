// ==========================================
// 1. BASE DE DATOS INDEXEDDB Y ESTADO GLOBAL
// ==========================================
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

dbRequest.onerror = (e) => console.error("Error al abrir IndexedDB:", e);

// Estado general del reproductor
let songList = [];
let playlists = JSON.parse(localStorage.getItem('playlistsDB') || '{}');
let currentIndex = 0;
let selectedSongForMenu = null;
let currentPlaylistView = null;
let isShuffle = false;
let isLoop = false;
let currentTab = 'all-songs';
let totalPlayedSeconds = parseInt(localStorage.getItem('totalPlayedSeconds') || '0', 10);
let sleepTimerInterval = null;
let sleepTimeRemaining = 0;
let editingPlaylistName = null;
let sfxEnabled = true;
let pendingEditCover = null;
let pendingCalibration = { scale: 100, speed: 1, offset: 0 };
let pendingBpm = null;
let recordingAction = null;

let hotkeys = {
  playPause: 'Space',
  nextTrack: 'ArrowRight',
  prevTrack: 'ArrowLeft',
  toggleFocus: 'KeyF',
  toggleMute: 'KeyM',
  toggleCinema: 'KeyQ',
  toggleLyrics: 'KeyE'
};

// ==========================================
// 2. REFERENCIAS DOM
// ==========================================
const audio1 = document.getElementById('audio-player-1');
const audio2 = document.getElementById('audio-player-2');
let activeAudio = audio1;

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
const btnPlayPlaylist = document.getElementById('btn-play-playlist');
const btnRenamePlaylist = document.getElementById('btn-rename-playlist');
const btnDeletePlaylist = document.getElementById('btn-delete-playlist');

const eqPanel = document.getElementById('eq-panel');
const btnEqToggle = document.getElementById('btn-eq-toggle');
const btnCloseEq = document.getElementById('btn-close-eq');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnFocusMode = document.getElementById('btn-focus-mode');
const btnMiniPlayer = document.getElementById('btn-mini-player');
let miniWin = null;

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
const optEditSong = document.getElementById('opt-edit-song');
const modalEditSong = document.getElementById('modal-edit-song');
const btnCloseEditSong = document.getElementById('btn-close-edit-song');
const editCoverWrapper = document.getElementById('edit-cover-wrapper');
const editCoverPreview = document.getElementById('edit-cover-preview');
const inputEditCover = document.getElementById('input-edit-cover');
const inputEditTitle = document.getElementById('input-edit-title');
const btnSaveSongEdit = document.getElementById('btn-save-song-edit');
const optAddToPlaylist = document.getElementById('opt-add-to-playlist');
const optHideSong = document.getElementById('opt-hide-song');
const txtHideOpt = document.getElementById('txt-hide-opt');
const optDeleteSong = document.getElementById('opt-delete-song');

const modalSelectPlaylist = document.getElementById('modal-select-playlist');
const btnCloseSelectPlaylist = document.getElementById('btn-close-select-playlist');
const targetPlaylistsList = document.getElementById('target-playlists-list');

const timerStatusDesc = document.getElementById('timer-status-desc');
const sleepTimerBadge = document.getElementById('sleep-timer-badge');

const lyricsPanel = document.getElementById('lyrics-panel');
const lyricsBg = document.getElementById('lyrics-bg');
const lyricsBody = document.getElementById('lyrics-body');
const btnLyricsToggle = document.getElementById('btn-lyrics-toggle');
const btnCloseLyrics = document.getElementById('btn-close-lyrics');
const btnEditLyrics = document.getElementById('btn-edit-lyrics');
const lyricsEditor = document.getElementById('lyrics-editor');
const lyricsTextarea = document.getElementById('lyrics-textarea');
const btnCinemaMode = document.getElementById('btn-cinema-mode');
const cinemaMode = document.getElementById('cinema-mode');
const cinemaBg = document.getElementById('cinema-bg');
const btnCloseCinema = document.getElementById('btn-close-cinema');
const cinemaCover = document.getElementById('cinema-cover');
const cinemaTitle = document.getElementById('cinema-title');
const cinemaArtist = document.getElementById('cinema-artist');
const cinemaLyricsBody = document.getElementById('cinema-lyrics-body');
const cinemaPrev = document.getElementById('cinema-prev');
const cinemaPlay = document.getElementById('cinema-play');
const cinemaNext = document.getElementById('cinema-next');
const cinemaEq = document.getElementById('cinema-eq');
const cinemaPlayIcon = document.getElementById('cinema-play-icon');

const btnVehicleMode = document.getElementById('btn-vehicle-mode');
const vehicleMode = document.getElementById('vehicle-mode');
const btnExitVehicle = document.getElementById('btn-exit-vehicle');
const vehicleCover = document.getElementById('vehicle-cover');
const vehicleTitle = document.getElementById('vehicle-title');
const vehicleArtist = document.getElementById('vehicle-artist');
const vehicleBg = document.getElementById('vehicle-bg');
const vehiclePlayIcon = document.getElementById('vehicle-play-icon');

const btnOpenKaraoke = document.getElementById('btn-open-karaoke');
const btnConfigureKaraoke = document.getElementById('btn-configure-karaoke');

const toggleAnimMaster = document.getElementById('toggle-anim-master');
const toggleAnimGlide = document.getElementById('toggle-anim-glide');
const toggleAnimAddSong = document.getElementById('toggle-anim-add-song');
const toggleAnimModals = document.getElementById('toggle-anim-modals');
const cinemaSeekbarWrapper = document.getElementById('cinema-seekbar-wrapper');
const cinemaCurrentTimeEl = document.getElementById('cinema-current-time');
const cinemaDurationEl = document.getElementById('cinema-duration');
const cinemaProgress = document.getElementById('cinema-progress');
const cinemaProgressContainer = document.getElementById('cinema-progress-container');
const toggleCinemaSeekbar = document.getElementById('toggle-cinema-seekbar');
const inputAudioSpeed = document.getElementById('input-audio-speed');
const audioSpeedVal = document.getElementById('audio-speed-val');
const toggleMonoAudio = document.getElementById('toggle-mono-audio');
const toggleNormalizeVolume = document.getElementById('toggle-normalize-volume');
const toggleBassBoost = document.getElementById('toggle-bass-boost');
const toggle8dAudio = document.getElementById('toggle-8d-audio');
const inputAudioBalance = document.getElementById('input-audio-balance');
const toggleVolumeLimiter = document.getElementById('toggle-volume-limiter');
const btnVmToggle = document.getElementById('btn-vm-toggle');
const vmPanel = document.getElementById('vm-panel');
const inputVoiceLevel = document.getElementById('input-voice-level');
const inputMusicLevel = document.getElementById('input-music-level');
const toggleVmEnabled = document.getElementById('toggle-vm-enabled');
const btnCalibrateLyrics = document.getElementById('btn-calibrate-lyrics');
const modalCalibrateLyrics = document.getElementById('modal-calibrate-lyrics');
const btnCloseCalibrate = document.getElementById('btn-close-calibrate');
const calibrateScale = document.getElementById('calibrate-scale');
const calibrateScaleValue = document.getElementById('calibrate-scale-value');
const calibrateSpeed = document.getElementById('calibrate-speed');
const calibrateSpeedValue = document.getElementById('calibrate-speed-value');
const calibrateOffsetBack = document.getElementById('calibrate-offset-back');
const calibrateOffsetForward = document.getElementById('calibrate-offset-forward');
const calibrateOffsetValue = document.getElementById('calibrate-offset-value');
const inputBpm = document.getElementById('input-bpm');
const btnResetBpm = document.getElementById('btn-reset-bpm');
const btnSaveCalibration = document.getElementById('btn-save-calibration');
const btnSaveLyrics = document.getElementById('btn-save-lyrics');

const statPlayTimePreview = document.getElementById('stat-play-time-preview');
const statPlayTimeDetail = document.getElementById('stat-play-time-detail');
const statRankBadge = document.getElementById('stat-rank-badge');
const statRankText = document.getElementById('stat-rank-text');
const bgVideo = document.getElementById('bg-video');

// Algunos navegadores pausan solos los videos de fondo para ahorrar batería,
// aunque los estés viendo. Este "vigilante" lo vuelve a poner en marcha si eso pasa.
function ensureBgVideoPlaying() {
  if (bgVideo && bgVideo.src && !bgVideo.classList.contains('bg-video-hidden') && bgVideo.paused) {
    bgVideo.play().catch(() => {});
  }
}
setInterval(ensureBgVideoPlaying, 3000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ensureBgVideoPlaying();
});
const bgCustomImage = document.getElementById('bg-custom-image');
const inputBgImage = document.getElementById('input-bg-image');
const inputBgVideo = document.getElementById('input-bg-video');
const btnRemoveBg = document.getElementById('btn-remove-bg');
const selectFont = document.getElementById('select-font');
const inputCustomColor = document.getElementById('input-custom-color');
const btnFactoryReset = document.getElementById('btn-factory-reset');

const togglePerformanceMode = document.getElementById('toggle-performance-mode');
const toggleSFX = document.getElementById('toggle-sfx');
const toggleCrossfade = document.getElementById('toggle-crossfade');

// ==========================================
// 3. AUDIO CONTEXT, EQ Y SINTETIZADOR DE SFX
// ==========================================
let audioCtx, track1, track2;
let eqFilters = [];
let bassBoostFilter, pannerNode, lfo8d, lfoGain8d, limiterNode;
let midGain, sideGain;
let stereoBypassGain, monoSplitter, monoSumGain, monoMerger, monoOutGain;

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function initAudioContext() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    track1 = audioCtx.createMediaElementSource(audio1);
    track2 = audioCtx.createMediaElementSource(audio2);

    // --- Ecualizador de 10 bandas ---
    eqFilters = EQ_FREQS.map(freq => {
      const f = audioCtx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = 0;
      return f;
    });
    track1.connect(eqFilters[0]);
    track2.connect(eqFilters[0]);
    for (let i = 0; i < eqFilters.length - 1; i++) eqFilters[i].connect(eqFilters[i + 1]);
    const eqOut = eqFilters[eqFilters.length - 1];

    // --- Bass Boost (refuerzo extra de graves, aparte del EQ manual) ---
    bassBoostFilter = audioCtx.createBiquadFilter();
    bassBoostFilter.type = "lowshelf";
    bassBoostFilter.frequency.value = 90;
    bassBoostFilter.gain.value = 0;
    eqOut.connect(bassBoostFilter);

    // --- Balance L/R y Audio 8D (el mismo nodo sirve para los dos) ---
    pannerNode = audioCtx.createStereoPanner();
    bassBoostFilter.connect(pannerNode);
    lfo8d = audioCtx.createOscillator();
    lfo8d.type = "sine";
    lfo8d.frequency.value = 0.15;
    lfoGain8d = audioCtx.createGain();
    lfoGain8d.gain.value = 1;
    lfo8d.connect(lfoGain8d);
    lfo8d.start();

    // --- Separador de Voz / Música (Mid/Side, pero solo en el rango de frecuencia de la voz:
    // así el bajo y la batería, que suelen estar también centrados, casi no se ven afectados) ---
    const vmLowBand = audioCtx.createBiquadFilter();
    vmLowBand.type = "lowpass"; vmLowBand.frequency.value = 200;
    const vmHighBand = audioCtx.createBiquadFilter();
    vmHighBand.type = "highpass"; vmHighBand.frequency.value = 5000;
    const vmVocalHP = audioCtx.createBiquadFilter();
    vmVocalHP.type = "highpass"; vmVocalHP.frequency.value = 200;
    const vmVocalLP = audioCtx.createBiquadFilter();
    vmVocalLP.type = "lowpass"; vmVocalLP.frequency.value = 5000;
    pannerNode.connect(vmLowBand);
    pannerNode.connect(vmHighBand);
    pannerNode.connect(vmVocalHP);
    vmVocalHP.connect(vmVocalLP);

    const vmSplitter = audioCtx.createChannelSplitter(2);
    vmVocalLP.connect(vmSplitter);
    const halfL1 = audioCtx.createGain(); halfL1.gain.value = 0.5;
    const halfR1 = audioCtx.createGain(); halfR1.gain.value = 0.5;
    vmSplitter.connect(halfL1, 0);
    vmSplitter.connect(halfR1, 1);
    midGain = audioCtx.createGain(); midGain.gain.value = 1; // "Voz"
    halfL1.connect(midGain); halfR1.connect(midGain);

    const halfL2 = audioCtx.createGain(); halfL2.gain.value = 0.5;
    const halfR2neg = audioCtx.createGain(); halfR2neg.gain.value = -0.5;
    vmSplitter.connect(halfL2, 0);
    vmSplitter.connect(halfR2neg, 1);
    sideGain = audioCtx.createGain(); sideGain.gain.value = 1; // "Música" (dentro del rango de voz)
    halfL2.connect(sideGain); halfR2neg.connect(sideGain);

    const negSideForR = audioCtx.createGain(); negSideForR.gain.value = -1;
    sideGain.connect(negSideForR);
    const vmMerger = audioCtx.createChannelMerger(2);
    midGain.connect(vmMerger, 0, 0);
    sideGain.connect(vmMerger, 0, 0);
    midGain.connect(vmMerger, 0, 1);
    negSideForR.connect(vmMerger, 0, 1);

    // --- Limitador de volumen (Salud Auditiva) ---
    limiterNode = audioCtx.createDynamicsCompressor();
    limiterNode.threshold.value = 0; // 0dB = transparente hasta que se active
    limiterNode.knee.value = 0;
    limiterNode.ratio.value = 1;
    limiterNode.attack.value = 0.002;
    limiterNode.release.value = 0.15;
    vmMerger.connect(limiterNode);
    vmLowBand.connect(limiterNode);
    vmHighBand.connect(limiterNode);

    // --- Salida normal en estéreo (se apaga sola si se activa el Modo Mono) ---
    stereoBypassGain = audioCtx.createGain();
    stereoBypassGain.gain.value = 1;
    limiterNode.connect(stereoBypassGain);
    stereoBypassGain.connect(audioCtx.destination);

    // --- Salida real en mono: suma los canales L y R y manda lo mismo a ambos lados ---
    monoSplitter = audioCtx.createChannelSplitter(2);
    monoSumGain = audioCtx.createGain();
    monoSumGain.gain.value = 0.5;
    monoMerger = audioCtx.createChannelMerger(2);
    monoOutGain = audioCtx.createGain();
    monoOutGain.gain.value = 0;

    limiterNode.connect(monoSplitter);
    monoSplitter.connect(monoSumGain, 0);
    monoSplitter.connect(monoSumGain, 1);
    monoSumGain.connect(monoMerger, 0, 0);
    monoSumGain.connect(monoMerger, 0, 1);
    monoMerger.connect(monoOutGain);
    monoOutGain.connect(audioCtx.destination);

    applyAudioEngineSettings();
  } catch (err) {
    console.warn("AudioContext no iniciado:", err);
  }
}

function setMonoMode(enabled) {
  if (!stereoBypassGain || !monoOutGain) return;
  stereoBypassGain.gain.value = enabled ? 0 : 1;
  monoOutGain.gain.value = enabled ? 1 : 0;
}

function set8dAudio(enabled) {
  if (!lfoGain8d || !pannerNode) return;
  try { lfoGain8d.disconnect(); } catch (e) {}
  if (enabled) {
    lfoGain8d.connect(pannerNode.pan);
  } else {
    const balance = inputAudioBalance ? parseFloat(inputAudioBalance.value) : 0;
    pannerNode.pan.value = balance || 0;
  }
}

function setVolumeLimiter(enabled) {
  if (!limiterNode) return;
  limiterNode.threshold.value = enabled ? -18 : 0;
  limiterNode.ratio.value = enabled ? 12 : 1;
}

// Aplica Velocidad/Tono, Modo Mono, EQ, Bass Boost, 8D, Balance, Voz/Música y Limitador
function applyAudioEngineSettings() {
  const speed = inputAudioSpeed ? parseFloat(inputAudioSpeed.value) : 1;
  [audio1, audio2].forEach(a => {
    a.playbackRate = speed || 1;
    // Al poner esto en false, el tono cambia junto con la velocidad (efecto "tocadiscos"),
    // que es justo lo que pide el ajuste "Velocidad y Tono (Pitch)" combinados en un solo control.
    a.preservesPitch = false;
    a.mozPreservesPitch = false;
    a.webkitPreservesPitch = false;
  });
  if (toggleMonoAudio) setMonoMode(toggleMonoAudio.checked);
  if (bassBoostFilter && toggleBassBoost) bassBoostFilter.gain.value = toggleBassBoost.checked ? 6 : 0;
  if (toggle8dAudio) set8dAudio(toggle8dAudio.checked);
  if (toggleVolumeLimiter) setVolumeLimiter(toggleVolumeLimiter.checked);
}

if (inputAudioSpeed) {
  inputAudioSpeed.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (audioSpeedVal) audioSpeedVal.textContent = val.toFixed(2) + 'x';
    applyAudioEngineSettings();
  });
}

if (toggleMonoAudio) {
  toggleMonoAudio.addEventListener('change', () => {
    playSFX('click');
    initAudioContext();
    applyAudioEngineSettings();
  });
}

// --- Ecualizador de 10 bandas (Gemini lo dejó sin ninguna lógica) ---
document.querySelectorAll('.eq-band-range').forEach(slider => {
  slider.addEventListener('input', (e) => {
    initAudioContext();
    const idx = parseInt(e.target.dataset.index, 10);
    if (eqFilters[idx]) eqFilters[idx].gain.value = parseFloat(e.target.value);
  });
});

const EQ_PRESETS = {
  bass:   [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 2, 4, 6, 7, 8],
  vocal:  [-2, -2, -1, 0, 3, 4, 3, 1, 0, -1],
  reset:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    initAudioContext();
    const preset = EQ_PRESETS[e.currentTarget.dataset.preset];
    if (!preset) return;
    document.querySelectorAll('.eq-band-range').forEach((slider, i) => {
      slider.value = preset[i];
      if (eqFilters[i]) eqFilters[i].gain.value = preset[i];
    });
  });
});

if (toggleBassBoost) toggleBassBoost.addEventListener('change', () => { initAudioContext(); applyAudioEngineSettings(); });
if (toggle8dAudio) toggle8dAudio.addEventListener('change', () => { initAudioContext(); applyAudioEngineSettings(); });
if (toggleVolumeLimiter) toggleVolumeLimiter.addEventListener('change', () => { initAudioContext(); applyAudioEngineSettings(); });
if (inputAudioBalance) {
  inputAudioBalance.addEventListener('input', () => {
    initAudioContext();
    if (!toggle8dAudio || !toggle8dAudio.checked) set8dAudio(false);
  });
}

// --- Separador de Voz / Música ---
if (inputVoiceLevel) {
  inputVoiceLevel.addEventListener('input', (e) => {
    initAudioContext();
    if (midGain) midGain.gain.value = parseFloat(e.target.value);
  });
}
if (inputMusicLevel) {
  inputMusicLevel.addEventListener('input', (e) => {
    initAudioContext();
    if (sideGain) sideGain.gain.value = parseFloat(e.target.value);
  });
}
if (toggleVmEnabled) {
  toggleVmEnabled.addEventListener('change', (e) => {
    initAudioContext();
    if (!e.target.checked) {
      if (midGain) midGain.gain.value = 1;
      if (sideGain) sideGain.gain.value = 1;
      if (inputVoiceLevel) inputVoiceLevel.value = 1;
      if (inputMusicLevel) inputMusicLevel.value = 1;
    }
  });
}

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

// ==========================================
// 4. MEDIA SESSION Y ESTADÍSTICAS
// ==========================================
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
        { src: song.cover, sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => playSong());
    navigator.mediaSession.setActionHandler('pause', () => pauseSong());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevBtn && prevBtn.click());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextBtn && nextBtn.click());
  }
}

setInterval(() => {
  if (playerCard && playerCard.classList.contains('playing')) {
    totalPlayedSeconds++;
    localStorage.setItem('totalPlayedSeconds', totalPlayedSeconds.toString());
    updateTimeStatDisplay();
  }
}, 1000);

function updateTimeStatDisplay() {
  const hours = Math.floor(totalPlayedSeconds / 3600);
  const minutes = Math.floor((totalPlayedSeconds % 3600) / 60);
  const seconds = totalPlayedSeconds % 60;

  if (statPlayTimePreview) statPlayTimePreview.textContent = `${hours}h ${minutes}m`;
  if (statPlayTimeDetail) statPlayTimeDetail.textContent = `${hours}h ${minutes}m ${seconds}s`;

  let rank = "Principiante";
  if (hours >= 1000) rank = "Infinito Hacker";
  else if (hours >= 500) rank = "Pro Maestro";
  else if (hours >= 100) rank = "Avanzado";
  else if (hours >= 10) rank = "Aficionado";

  if (statRankBadge) statRankBadge.textContent = rank;
  if (statRankText) statRankText.textContent = rank;
}
updateTimeStatDisplay();

// Temporizador
document.querySelectorAll('.timer-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    startSleepTimer(parseInt(e.target.dataset.minutes, 10));
  });
});

function startSleepTimer(minutes) {
  clearInterval(sleepTimerInterval);
  if (minutes <= 0) {
    sleepTimeRemaining = 0;
    if (timerStatusDesc) timerStatusDesc.textContent = "Desactivado";
    if (sleepTimerBadge) sleepTimerBadge.classList.add('hidden');
    return;
  }
  sleepTimeRemaining = minutes * 60;
  updateTimerUI();

  sleepTimerInterval = setInterval(() => {
    sleepTimeRemaining--;
    if (sleepTimeRemaining <= 0) {
      clearInterval(sleepTimerInterval);
      pauseSong();
      if (timerStatusDesc) timerStatusDesc.textContent = "Desactivado";
      if (sleepTimerBadge) sleepTimerBadge.classList.add('hidden');
    } else {
      updateTimerUI();
    }
  }, 1000);
}

function updateTimerUI() {
  const m = Math.floor(sleepTimeRemaining / 60);
  const s = sleepTimeRemaining % 60;
  const str = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  if (timerStatusDesc) timerStatusDesc.textContent = `Apagado en ${str}`;
  if (sleepTimerBadge) {
    sleepTimerBadge.textContent = str;
    sleepTimerBadge.classList.remove('hidden');
  }
}

// ==========================================
// 5. INDEXEDDB Y GESTIÓN DE ARCHIVOS
// ==========================================
function saveSongToDB(songObj) {
  if (!db) return;
  const tx = db.transaction(["songs"], "readwrite");
  const req = tx.objectStore("songs").add(songObj);
  req.onsuccess = (e) => { if (e.target && e.target.result !== undefined) songObj.id = e.target.result; };
}

function updateSongInDB(songObj) {
  if (!db || !songObj || songObj.id === undefined) return;
  const tx = db.transaction(["songs"], "readwrite");
  tx.objectStore("songs").put(songObj);
}

function loadStoredSongs() {
  if (!db) return;
  const tx = db.transaction(["songs"], "readonly");
  const req = tx.objectStore("songs").getAll();
  req.onsuccess = () => {
    if (req.result.length > 0) {
      songList = req.result.map(song => ({
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

// Overlay global de Arrastrar y Soltar: funciona en toda la ventana, no solo en un botón
const dragdropOverlay = document.getElementById('dragdrop-overlay');
let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
    dragCounter++;
    if (dragdropOverlay) dragdropOverlay.classList.add('active');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    if (dragdropOverlay) dragdropOverlay.classList.remove('active');
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  if (dragdropOverlay) dragdropOverlay.classList.remove('active');
  if (e.dataTransfer && e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
});
if (fileInput) fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

// ==========================================
// 6. MOTOR DE REPRODUCCIÓN
// ==========================================
function loadSong(index, shouldPlay = true) {
  if (index < 0 || index >= songList.length) return;
  currentIndex = index;
  const song = songList[currentIndex];

  if (title) title.textContent = song.title;
  if (artist) artist.textContent = song.artist;
  if (cover) cover.src = song.cover;
  if (playerBgFluid) playerBgFluid.style.backgroundImage = `url(${song.cover})`;
  if (lyricsBg) lyricsBg.style.backgroundImage = `url(${song.cover})`;

  if (cinemaCover) cinemaCover.src = song.cover;
  if (cinemaTitle) cinemaTitle.textContent = song.title;
  if (cinemaArtist) cinemaArtist.textContent = song.artist;
  if (cinemaBg) cinemaBg.style.backgroundImage = `url(${song.cover})`;

  applyLyricsCalibration(song);
  if (btnFav) btnFav.classList.toggle('active', !!song.isFav);
  displayLyrics(song.lyrics);
  updateMediaSession(song);

  audio1.pause();
  audio2.pause();

  if (shouldPlay) {
    if (toggleCrossfade && toggleCrossfade.checked) {
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

  applyAudioEngineSettings();
  syncMiniPlayer(true);
  syncVehicleMode();
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
      const step = 0.05;
      const targetVol = volumeSlider ? parseFloat(volumeSlider.value) : 1;

      const fade = setInterval(() => {
        if (currentAudio.volume > step) currentAudio.volume -= step;
        else { currentAudio.volume = 0; currentAudio.pause(); }

        if (nextAudio.volume < targetVol - step) nextAudio.volume += step;
        else { nextAudio.volume = targetVol; clearInterval(fade); }
      }, 60);

      activeAudio = nextAudio;
      if (playerCard) playerCard.classList.add('playing');
      if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    }).catch(err => console.error("Error en crossfade:", err));
  }
}

function playSong() {
  if (songList.length === 0) return;
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  activeAudio.volume = volumeSlider ? parseFloat(volumeSlider.value) : 1;
  const playPromise = activeAudio.play();

  if (playPromise !== undefined) {
    playPromise.then(() => {
      if (playerCard) playerCard.classList.add('playing');
      if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      if (cinemaPlayIcon && playIcon) cinemaPlayIcon.innerHTML = playIcon.innerHTML;
      syncMiniPlayer();
      syncVehicleMode();
    }).catch(err => console.error("Error en reproducción:", err));
  }
}

function pauseSong() {
  if (playerCard) playerCard.classList.remove('playing');
  if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  if (cinemaPlayIcon && playIcon) cinemaPlayIcon.innerHTML = playIcon.innerHTML;
  activeAudio.pause();
  syncMiniPlayer();
  syncVehicleMode();
}

if (playBtn) playBtn.addEventListener('click', () => { playSFX('click'); playerCard.classList.contains('playing') ? pauseSong() : playSong(); });
if (nextBtn) nextBtn.addEventListener('click', () => {
  playSFX('click');
  if (songList.length === 0) return;
  currentIndex = isShuffle ? Math.floor(Math.random() * songList.length) : (currentIndex + 1) % songList.length;
  loadSong(currentIndex);
});
if (prevBtn) prevBtn.addEventListener('click', () => {
  playSFX('click');
  if (songList.length === 0) return;
  currentIndex = (currentIndex - 1 + songList.length) % songList.length;
  loadSong(currentIndex);
});

if (shuffleBtn) shuffleBtn.addEventListener('click', () => { playSFX('click'); isShuffle = !isShuffle; shuffleBtn.classList.toggle('active', isShuffle); });
if (loopBtn) loopBtn.addEventListener('click', () => { playSFX('click'); isLoop = !isLoop; loopBtn.classList.toggle('active', isLoop); });

[audio1, audio2].forEach(a => {
  a.addEventListener('ended', () => {
    if (isLoop) {
      a.currentTime = 0;
      a.play();
    } else {
      if (nextBtn) nextBtn.click();
    }
  });
});

if (btnFav) {
  btnFav.addEventListener('click', () => {
    playSFX('click');
    if (songList.length === 0) return;
    songList[currentIndex].isFav = !songList[currentIndex].isFav;
    btnFav.classList.toggle('active', songList[currentIndex].isFav);
    updateSongInDB(songList[currentIndex]);
    renderPlaylist();
  });
}

// ==========================================
// 7. MODO ENFOQUE (DRAGGABLE) Y VENTANAS
// ==========================================
let isDragging = false;
let dragStartX, dragStartY, cardStartX, cardStartY;

if (btnFocusMode) {
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
}

if (playerCard) {
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
}

window.addEventListener('mousemove', (e) => {
  if (!isDragging || !playerCard) return;
  playerCard.style.left = `${cardStartX + (e.clientX - dragStartX)}px`;
  playerCard.style.top = `${cardStartY + (e.clientY - dragStartY)}px`;
});
window.addEventListener('mouseup', () => { isDragging = false; });

if (btnFullscreen) {
  btnFullscreen.addEventListener('click', () => {
    playSFX('click');
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => console.error(err));
    else if (document.exitFullscreen) document.exitFullscreen();
  });
}

if (btnMiniPlayer) {
  btnMiniPlayer.addEventListener('click', () => {
    playSFX('open');
    if (miniWin && !miniWin.closed) { miniWin.focus(); return; }
    miniWin = window.open("", "MiniPlayer", "width=300,height=430,resizable=yes");
    if (!miniWin) return;
    miniWin.document.title = "Mini Reproductor";
    const showBgFluid = miniPlayerStyle.bg === 'acrylic';

    miniWin.document.body.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        :root { --mp-bg-color: 18,19,28; --mp-opacity: ${miniPlayerStyle.bg === 'transparent' ? 0 : miniPlayerStyle.opacity}; --mp-scale: ${miniPlayerStyle.scale}; --mp-blur: ${showBgFluid ? '20px' : '0px'}; }
        html { zoom: var(--mp-scale, 1); }
        body {
          background: rgba(var(--mp-bg-color), var(--mp-opacity));
          backdrop-filter: blur(var(--mp-blur));
          -webkit-backdrop-filter: blur(var(--mp-blur));
          color: #fff; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 18px; min-height: 100vh;
          position: relative; overflow: hidden;
        }
        #mini-bg-fluid {
          position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
          background-size: cover; background-position: center;
          filter: blur(40px) brightness(0.4); z-index: -1;
          opacity: ${showBgFluid ? 1 : 0};
        }
        .mp-topbar { display: flex; gap: 16px; margin-bottom: 14px; }
        .mp-topbar button { background: none; border: none; color: #8a99ad; font-size: 0.8rem; font-weight: 600; cursor: pointer; padding: 0; }
        .mp-topbar button:hover { color: #fff; }
        .mp-cover-wrap { display: flex; justify-content: center; margin-bottom: 14px; }
        #mini-cover { width: 140px; height: 140px; border-radius: 50%; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
        .mp-info { text-align: center; margin-bottom: 14px; }
        #mini-title { margin: 0 0 2px 0; font-size: 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #mini-artist { margin: 0; font-size: 0.8rem; color: #8a99ad; }
        .mp-progress-container { background: rgba(255,255,255,0.1); border-radius: 4px; height: 4px; width: 100%; cursor: pointer; }
        .mp-progress-bar { background: #e8a33d; border-radius: 4px; height: 100%; width: 0%; }
        .mp-times { display: flex; justify-content: space-between; font-size: 0.7rem; color: #8a99ad; margin: 6px 0 16px 0; }
        .mp-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .mp-controls button { background: none; border: none; color: #d5dae2; cursor: pointer; padding: 4px; display: flex; }
        .mp-controls button:hover { color: #fff; }
        .mp-controls button.mp-active { color: #e8a33d; }
        #mini-play { background: #e8a33d; color: #12131c; border-radius: 50%; width: 40px; height: 40px; align-items: center; justify-content: center; }
        .mp-volume { display: flex; align-items: center; gap: 8px; color: #8a99ad; }
        .mp-volume input { flex: 1; accent-color: #e8a33d; }
      </style>
      <div id="mini-bg-fluid"></div>
      <div class="mp-topbar">
        <button onclick="window.opener.document.getElementById('btn-eq-toggle') && window.opener.document.getElementById('btn-eq-toggle').click()">EQ</button>
        <button onclick="window.opener.document.getElementById('btn-lyrics-toggle') && window.opener.document.getElementById('btn-lyrics-toggle').click()">Letras</button>
      </div>
      <div class="mp-cover-wrap"><img id="mini-cover" src="" alt="Portada"></div>
      <div class="mp-info">
        <h4 id="mini-title">-</h4>
        <p id="mini-artist">-</p>
      </div>
      <div class="mp-progress-container" id="mini-progress-container">
        <div class="mp-progress-bar" id="mini-progress"></div>
      </div>
      <div class="mp-times"><span id="mini-current-time">0:00</span><span id="mini-duration">0:00</span></div>
      <div class="mp-controls">
        <button id="mini-shuffle" title="Aleatorio"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg></button>
        <button id="mini-prev" title="Anterior"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
        <button id="mini-play" title="Reproducir / Pausa"><svg id="mini-play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
        <button id="mini-next" title="Siguiente"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
        <button id="mini-loop" title="Repetir"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></button>
        <button id="mini-fav" title="Me gusta"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.72-8.72 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
      </div>
      <div class="mp-volume">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>
        <input type="range" id="mini-volume" min="0" max="1" step="0.01" value="1">
      </div>
    `;

    const mw = miniWin;
    const passthrough = (id) => { const el = window.document.getElementById(id); if (el) el.click(); };
    const shuffleBtn = mw.document.getElementById('mini-shuffle');
    const prevMiniBtn = mw.document.getElementById('mini-prev');
    const playMiniBtn = mw.document.getElementById('mini-play');
    const nextMiniBtn = mw.document.getElementById('mini-next');
    const loopMiniBtn = mw.document.getElementById('mini-loop');
    const favMiniBtn = mw.document.getElementById('mini-fav');
    const volMiniInput = mw.document.getElementById('mini-volume');
    const progressMiniContainer = mw.document.getElementById('mini-progress-container');

    if (shuffleBtn) shuffleBtn.addEventListener('click', () => passthrough('shuffle'));
    if (prevMiniBtn) prevMiniBtn.addEventListener('click', () => passthrough('prev'));
    if (playMiniBtn) playMiniBtn.addEventListener('click', () => passthrough('play'));
    if (nextMiniBtn) nextMiniBtn.addEventListener('click', () => passthrough('next'));
    if (loopMiniBtn) loopMiniBtn.addEventListener('click', () => passthrough('loop'));
    if (favMiniBtn) favMiniBtn.addEventListener('click', () => passthrough('btn-fav'));
    if (volMiniInput) {
      volMiniInput.value = volumeSlider ? volumeSlider.value : 1;
      volMiniInput.addEventListener('input', (e) => {
        if (volumeSlider) {
          volumeSlider.value = e.target.value;
          volumeSlider.dispatchEvent(new Event('input'));
        }
      });
    }
    if (progressMiniContainer) {
      progressMiniContainer.addEventListener('click', (e) => {
        if (activeAudio && activeAudio.duration) {
          activeAudio.currentTime = (e.offsetX / progressMiniContainer.clientWidth) * activeAudio.duration;
        }
      });
    }

    mw.addEventListener('beforeunload', () => { miniWin = null; });
    applyMiniPlayerStyle();
    syncMiniPlayer(true);
  });
}

// ==========================================
// PERSONALIZACIÓN VISUAL DEL MINI REPRODUCTOR
// ==========================================
let miniPlayerStyle = { bg: 'acrylic', opacity: 0.85, scale: 1 };

function applyMiniPlayerStyle() {
  if (!miniWin || miniWin.closed) return;
  try {
    const root = miniWin.document.documentElement.style;
    if (miniPlayerStyle.bg === 'black') root.setProperty('--mp-bg-color', '0,0,0');
    else if (miniPlayerStyle.bg === 'white') root.setProperty('--mp-bg-color', '255,255,255');
    else if (miniPlayerStyle.bg === 'transparent') root.setProperty('--mp-bg-color', '18,19,28');
    else root.setProperty('--mp-bg-color', '18,19,28'); // acrílico/difuminado

    root.setProperty('--mp-opacity', miniPlayerStyle.bg === 'transparent' ? 0 : miniPlayerStyle.opacity);
    root.setProperty('--mp-blur', miniPlayerStyle.bg === 'acrylic' ? '20px' : '0px');
    root.setProperty('--mp-scale', miniPlayerStyle.scale);
    const miniBgFluid = miniWin.document.getElementById('mini-bg-fluid');
    if (miniBgFluid) miniBgFluid.style.opacity = miniPlayerStyle.bg === 'acrylic' ? '1' : '0';
  } catch (err) {}
}

document.querySelectorAll('.mp-bg-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.mp-bg-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    miniPlayerStyle.bg = e.currentTarget.dataset.mpbg;
    applyMiniPlayerStyle();
  });
});
const inputMpOpacity = document.getElementById('input-mp-opacity');
const inputMpScale = document.getElementById('input-mp-scale');
if (inputMpOpacity) inputMpOpacity.addEventListener('input', (e) => { miniPlayerStyle.opacity = parseFloat(e.target.value); applyMiniPlayerStyle(); });
if (inputMpScale) inputMpScale.addEventListener('input', (e) => { miniPlayerStyle.scale = parseFloat(e.target.value); applyMiniPlayerStyle(); });

// Mantiene el mini reproductor sincronizado en vivo con el reproductor principal
function syncMiniPlayer(full = false) {
  if (!miniWin || miniWin.closed) return;
  try {
    const doc = miniWin.document;
    if (full) {
      const miniCover = doc.getElementById('mini-cover');
      const miniTitle = doc.getElementById('mini-title');
      const miniArtist = doc.getElementById('mini-artist');
      const miniBgFluid = doc.getElementById('mini-bg-fluid');
      if (miniCover && cover) miniCover.src = cover.src;
      if (miniTitle && title) miniTitle.textContent = title.textContent;
      if (miniArtist && artist) miniArtist.textContent = artist.textContent;
      if (miniBgFluid && cover) miniBgFluid.style.backgroundImage = `url(${cover.src})`;
    }
    const miniPlayIcon = doc.getElementById('mini-play-icon');
    if (miniPlayIcon && playIcon) miniPlayIcon.innerHTML = playIcon.innerHTML;

    if (activeAudio && !isNaN(activeAudio.duration) && activeAudio.duration > 0) {
      const pct = (activeAudio.currentTime / activeAudio.duration) * 100;
      const miniProgress = doc.getElementById('mini-progress');
      const miniCurrentTime = doc.getElementById('mini-current-time');
      const miniDuration = doc.getElementById('mini-duration');
      const format = (t) => Math.floor(t / 60) + ':' + ('0' + Math.floor(t % 60)).slice(-2);
      if (miniProgress) miniProgress.style.width = pct + '%';
      if (miniCurrentTime) miniCurrentTime.textContent = format(activeAudio.currentTime);
      if (miniDuration) miniDuration.textContent = format(activeAudio.duration);
    }
  } catch (err) {
    // La ventanita se pudo haber cerrado justo en este instante; no pasa nada.
  }
}

if (btnEqToggle) btnEqToggle.addEventListener('click', () => { playSFX('click'); eqPanel.classList.toggle('hidden'); });
if (btnCloseEq) btnCloseEq.addEventListener('click', () => { playSFX('close'); eqPanel.classList.add('hidden'); });
if (btnVmToggle) btnVmToggle.addEventListener('click', () => { playSFX('click'); initAudioContext(); if (vmPanel) vmPanel.classList.toggle('hidden'); });
const btnCloseVm = document.getElementById('btn-close-vm');
if (btnCloseVm) btnCloseVm.addEventListener('click', () => { playSFX('close'); if (vmPanel) vmPanel.classList.add('hidden'); });

// ==========================================
// 8. RENDERIZADO Y NAVEGACIÓN DE BIBLIOTECA
// ==========================================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentTab = e.target.dataset.tab;
    currentPlaylistView = null;
    if (btnBackPlaylist) btnBackPlaylist.classList.add('hidden');
    if (playlistViewHeader) playlistViewHeader.classList.add('hidden');
    if (btnCreatePlaylist) btnCreatePlaylist.classList.toggle('hidden', currentTab !== 'playlists');
    renderPlaylist();
  });
});

if (btnBackPlaylist) {
  btnBackPlaylist.addEventListener('click', () => {
    playSFX('close');
    currentPlaylistView = null;
    btnBackPlaylist.classList.add('hidden');
    if (playlistViewHeader) playlistViewHeader.classList.add('hidden');
    renderPlaylist();
  });
}

// El botón "Reproducir" de una playlist no tenía NINGÚN listener conectado.
// Ahora reproduce la primera canción disponible de esa playlist específica (nunca una ajena).
if (btnPlayPlaylist) {
  btnPlayPlaylist.addEventListener('click', () => {
    playSFX('click');
    if (!currentPlaylistView) return;
    const pSongs = playlists[currentPlaylistView] || [];
    for (let i = 0; i < pSongs.length; i++) {
      const realSong = findSongInLibrary(pSongs[i]);
      const realIndex = realSong ? songList.indexOf(realSong) : -1;
      if (realIndex > -1) { loadSong(realIndex); return; }
    }
    alert('Ninguna canción de esta playlist está disponible en tu biblioteca actual.');
  });
}

function savePlaylistsToStorage() {
  localStorage.setItem('playlistsDB', JSON.stringify(playlists));
}

// Las playlists guardan una "foto" de cada canción; esta función busca la canción
// REAL y actual en tu biblioteca (por id, o por título/artista si no tiene id todavía).
function findSongInLibrary(storedSong) {
  if (!storedSong) return null;
  if (storedSong.id !== undefined) {
    const byId = songList.find(s => s.id === storedSong.id);
    if (byId) return byId;
  }
  return songList.find(s => s.title === storedSong.title && s.artist === storedSong.artist) || null;
}

function renderPlaylist() {
  if (!playlistEl) return;
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
        if (btnBackPlaylist) btnBackPlaylist.classList.remove('hidden');
        renderPlaylist();
      });
      playlistEl.appendChild(li);
    });
    return;
  }

  if (currentPlaylistView) {
    const pSongs = playlists[currentPlaylistView] || [];
    if (playlistViewTitle) playlistViewTitle.textContent = currentPlaylistView;
    if (playlistViewCover) playlistViewCover.src = pSongs.length > 0 ? pSongs[0].cover : "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80";
    if (playlistViewHeader) playlistViewHeader.classList.remove('hidden');

    if (pSongs.length === 0) {
      playlistEl.innerHTML = '<li class="empty-msg">Playlist vacía. Agrega canciones usando el menú de 3 puntos.</li>';
      return;
    }

    pSongs.forEach((storedSong, pIndex) => {
      const realSong = findSongInLibrary(storedSong);
      const realIndex = realSong ? songList.indexOf(realSong) : -1;
      const song = realSong || storedSong; // usa los datos actuales (título/portada editados), si existe
      const li = document.createElement('li');
      li.className = `playlist-item ${realIndex === currentIndex ? 'active' : ''} ${!realSong ? 'song-unavailable' : ''}`;
      li.innerHTML = `
        <img src="${song.cover}" class="item-thumb">
        <div class="item-details">
          <div class="item-title">${song.title}${!realSong ? ' (no disponible)' : ''}</div>
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

      li.addEventListener('click', () => { if (realIndex > -1) loadSong(realIndex); });
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

// ==========================================
// 9. MODALES Y EDICIÓN
// ==========================================
function openModal(modal) { if (modal) modal.classList.add('active'); }
function closeModal(modal) { if (modal) modal.classList.remove('active'); }

if (btnPlayPlaylist) {
  btnPlayPlaylist.addEventListener('click', () => {
    playSFX('open');
    if (!currentPlaylistView) return;
    const pSongs = playlists[currentPlaylistView] || [];
    const firstAvailable = pSongs.map(findSongInLibrary).find(s => s !== null);
    if (!firstAvailable) return;
    const realIndex = songList.indexOf(firstAvailable);
    if (realIndex > -1) loadSong(realIndex);
  });
}

if (btnRenamePlaylist) {
  btnRenamePlaylist.addEventListener('click', () => {
    if (!currentPlaylistView) return;
    playSFX('open');
    editingPlaylistName = currentPlaylistView;
    if (modalPlaylistTitle) modalPlaylistTitle.textContent = "Renombrar Playlist";
    if (inputPlaylistName) inputPlaylistName.value = currentPlaylistView;
    openModal(modalCreatePlaylist);
  });
}

if (btnDeletePlaylist) {
  btnDeletePlaylist.addEventListener('click', () => {
    if (!currentPlaylistView) return;
    playSFX('click');
    if (confirm(`¿Seguro que deseas eliminar la playlist "${currentPlaylistView}"?`)) {
      delete playlists[currentPlaylistView];
      savePlaylistsToStorage();
      currentPlaylistView = null;
      if (btnBackPlaylist) btnBackPlaylist.classList.add('hidden');
      if (playlistViewHeader) playlistViewHeader.classList.add('hidden');
      renderPlaylist();
    }
  });
}

if (btnCreatePlaylist) {
  btnCreatePlaylist.addEventListener('click', () => {
    playSFX('open');
    editingPlaylistName = null;
    if (modalPlaylistTitle) modalPlaylistTitle.textContent = "Nueva Playlist";
    if (inputPlaylistName) inputPlaylistName.value = '';
    openModal(modalCreatePlaylist);
  });
}

if (btnCloseCreatePlaylist) btnCloseCreatePlaylist.addEventListener('click', () => { playSFX('close'); closeModal(modalCreatePlaylist); });

if (btnSavePlaylist) {
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
}

if (btnMainMenu) btnMainMenu.addEventListener('click', () => { playSFX('open'); modalSettings.classList.add('active'); });
if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => { playSFX('close'); closeModalSettings(); });

function closeModalSettings() {
  if (modalSettings) modalSettings.classList.remove('active');
  resetSettingsSlide();
}

function resetSettingsSlide() {
  if (settingsMainView) settingsMainView.classList.remove('slide-out');
  document.querySelectorAll('.settings-sub-panel').forEach(p => p.classList.remove('slide-in'));
}

document.querySelectorAll('.setting-card-item[data-target]').forEach(card => {
  card.addEventListener('click', (e) => {
    playSFX('open');
    const targetId = e.currentTarget.dataset.target;
    const subPanel = document.getElementById(targetId);
    if (subPanel) {
      if (settingsMainView) settingsMainView.classList.add('slide-out');
      subPanel.classList.add('slide-in');
    }
  });
});

document.querySelectorAll('.btn-sub-back').forEach(btn => {
  btn.addEventListener('click', () => { playSFX('close'); resetSettingsSlide(); });
});

if (btnOpenHidden) btnOpenHidden.addEventListener('click', () => { playSFX('open'); renderHiddenList(); openModal(modalHidden); });
if (btnCloseHidden) btnCloseHidden.addEventListener('click', () => { playSFX('close'); closeModal(modalHidden); });

function renderHiddenList() {
  if (!hiddenPlaylistEl) return;
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
  if (modalSongTitle) modalSongTitle.textContent = song.title;
  if (txtHideOpt) txtHideOpt.textContent = song.isHidden ? "Mostrar Canción" : "Ocultar Canción";
  openModal(modalSongMenu);
}
if (btnCloseSongMenu) btnCloseSongMenu.addEventListener('click', () => { playSFX('close'); closeModal(modalSongMenu); });

if (optEditSong) {
  optEditSong.addEventListener('click', () => {
    playSFX('open');
    if (!selectedSongForMenu) return;
    pendingEditCover = null;
    if (inputEditTitle) inputEditTitle.value = selectedSongForMenu.title || "";
    if (editCoverPreview) editCoverPreview.src = selectedSongForMenu.cover || "";
    closeModal(modalSongMenu);
    openModal(modalEditSong);
  });
}

if (btnCloseEditSong) btnCloseEditSong.addEventListener('click', () => { playSFX('close'); closeModal(modalEditSong); });
if (editCoverWrapper) editCoverWrapper.addEventListener('click', () => { if (inputEditCover) inputEditCover.click(); });

if (inputEditCover) {
  inputEditCover.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target && ev.target.result) {
        pendingEditCover = ev.target.result;
        if (editCoverPreview) editCoverPreview.src = pendingEditCover;
      }
    };
    reader.readAsDataURL(file);
  });
}

if (btnSaveSongEdit) {
  btnSaveSongEdit.addEventListener('click', () => {
    playSFX('click');
    if (!selectedSongForMenu) { closeModal(modalEditSong); return; }

    const newTitle = inputEditTitle ? inputEditTitle.value.trim() : "";
    if (newTitle) selectedSongForMenu.title = newTitle;
    if (pendingEditCover) selectedSongForMenu.cover = pendingEditCover;

    updateSongInDB(selectedSongForMenu);

    if (songList[currentIndex] === selectedSongForMenu) {
      if (title) title.textContent = selectedSongForMenu.title;
      if (cover) cover.src = selectedSongForMenu.cover;
      if (playerBgFluid) playerBgFluid.style.backgroundImage = `url(${selectedSongForMenu.cover})`;
      if (lyricsBg) lyricsBg.style.backgroundImage = `url(${selectedSongForMenu.cover})`;
      if (cinemaCover) cinemaCover.src = selectedSongForMenu.cover;
      if (cinemaTitle) cinemaTitle.textContent = selectedSongForMenu.title;
      if (cinemaArtist) cinemaArtist.textContent = selectedSongForMenu.artist;
      if (cinemaBg) cinemaBg.style.backgroundImage = `url(${selectedSongForMenu.cover})`;
      updateMediaSession(selectedSongForMenu);
    }

    pendingEditCover = null;
    closeModal(modalEditSong);
    renderPlaylist();
    renderHiddenList();
  });
}

if (optHideSong) {
  optHideSong.addEventListener('click', () => {
    playSFX('click');
    if (selectedSongForMenu) {
      selectedSongForMenu.isHidden = !selectedSongForMenu.isHidden;
      updateSongInDB(selectedSongForMenu);
      closeModal(modalSongMenu);
      renderPlaylist();
      renderHiddenList();
    }
  });
}

if (optDeleteSong) {
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
}

if (optAddToPlaylist) {
  optAddToPlaylist.addEventListener('click', () => {
    playSFX('open');
    closeModal(modalSongMenu);
    renderTargetPlaylists();
    openModal(modalSelectPlaylist);
  });
}
if (btnCloseSelectPlaylist) btnCloseSelectPlaylist.addEventListener('click', () => { playSFX('close'); closeModal(modalSelectPlaylist); });

function renderTargetPlaylists() {
  if (!targetPlaylistsList) return;
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

// ==========================================
// 10. ESTILOS, ATAJOS Y PERSONALIZACIÓN
// ==========================================
if (togglePerformanceMode) {
  togglePerformanceMode.addEventListener('change', (e) => {
    document.body.classList.toggle('performance-mode', e.target.checked);
  });
}

if (toggleSFX) {
  toggleSFX.addEventListener('change', (e) => {
    sfxEnabled = e.target.checked;
  });
}

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

if (btnFactoryReset) {
  btnFactoryReset.addEventListener('click', () => {
    playSFX('click');
    if (confirm("¿Estás seguro de restablecer toda la configuración y la interfaz a los valores predeterminados?")) {
      localStorage.clear();
      location.reload();
    }
  });
}

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    if (playlistEl) playlistEl.className = `playlist-view list-${e.target.dataset.size}`;
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

// Alineación de texto en Modo Cine (Gemini dejó estos botones sin ninguna lógica)
document.querySelectorAll('.align-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    const align = e.currentTarget.dataset.align || 'center';
    document.documentElement.style.setProperty('--cinema-lyrics-align', align);
  });
});

// Escalado y tamaño del Modo Cine (también sin lógica)
document.querySelectorAll('.cinema-scale-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.cinema-scale-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    const scale = e.currentTarget.dataset.scale;
    const presetValue = scale === 'max' ? 1.5 : (scale === 'large' ? 1.25 : 1);
    document.documentElement.style.setProperty('--cinema-scale-preset', presetValue);
  });
});

// Mostrar / ocultar la barra de tiempo del Modo Cine (el switch tampoco hacía nada)
if (toggleCinemaSeekbar && cinemaSeekbarWrapper) {
  toggleCinemaSeekbar.addEventListener('change', (e) => {
    cinemaSeekbarWrapper.classList.toggle('hidden', !e.target.checked);
  });
}


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

if (inputCustomColor) {
  inputCustomColor.addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--primary-color', e.target.value);
  });
}

if (inputBgImage) {
  inputBgImage.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && bgCustomImage && bgVideo) {
      bgCustomImage.style.backgroundImage = `url('${URL.createObjectURL(file)}')`;
      bgCustomImage.style.display = 'block';
      bgVideo.classList.add('bg-video-hidden');
      bgVideo.pause();
    }
  });
}

if (inputBgVideo) {
  inputBgVideo.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && bgVideo && bgCustomImage) {
      bgVideo.src = URL.createObjectURL(file);
      bgVideo.classList.remove('bg-video-hidden');
      bgVideo.play();
      bgCustomImage.style.display = 'none';
    }
  });
}

if (btnRemoveBg) {
  btnRemoveBg.addEventListener('click', () => {
    playSFX('click');
    if (bgCustomImage) bgCustomImage.style.display = 'none';
    if (bgVideo) {
      bgVideo.classList.add('bg-video-hidden');
      bgVideo.pause();
      bgVideo.src = '';
    }
  });
}

if (selectFont) {
  selectFont.addEventListener('change', (e) => {
    document.body.style.fontFamily = e.target.value;
  });
}

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

  if (e.code === hotkeys.playPause) { e.preventDefault(); if (playBtn) playBtn.click(); }
  else if (e.code === hotkeys.nextTrack) { e.preventDefault(); if (nextBtn) nextBtn.click(); }
  else if (e.code === hotkeys.prevTrack) { e.preventDefault(); if (prevBtn) prevBtn.click(); }
  else if (e.code === hotkeys.toggleFocus) { e.preventDefault(); if (btnFocusMode) btnFocusMode.click(); }
  else if (e.code === hotkeys.toggleMute) { e.preventDefault(); activeAudio.muted = !activeAudio.muted; }
  else if (e.code === hotkeys.toggleCinema) { e.preventDefault(); if (btnCinemaMode) btnCinemaMode.click(); }
  else if (e.code === hotkeys.toggleLyrics) { e.preventDefault(); if (btnLyricsToggle) btnLyricsToggle.click(); }
});

// ==========================================
// 11. PROGRESO Y SINCRONIZACIÓN DE LETRAS
// ==========================================
[audio1, audio2].forEach(a => {
  a.addEventListener('timeupdate', () => {
    if (a !== activeAudio) return;
    const { duration, currentTime } = a;
    if (isNaN(duration)) return;

    if (!isSeekingMain) {
      if (progress) progress.style.width = `${(currentTime / duration) * 100}%`;
      const format = (t) => Math.floor(t / 60) + ':' + ('0' + Math.floor(t % 60)).slice(-2);
      if (currentTimeEl) currentTimeEl.textContent = format(currentTime);
      if (durationEl) durationEl.textContent = format(duration);

      if (cinemaProgress) cinemaProgress.style.width = `${(currentTime / duration) * 100}%`;
      if (cinemaCurrentTimeEl) cinemaCurrentTimeEl.textContent = format(currentTime);
      if (cinemaDurationEl) cinemaDurationEl.textContent = format(duration);
    }

    syncMiniPlayer();

    if (!lyricsBody) return;
    const lines = lyricsBody.querySelectorAll('.lyrics-line');
    if (lines.length > 0) {
      const currentSong = songList[currentIndex] || {};
      const calib = currentSong.lyricsCalibration || { speed: 1, offset: 0 };
      let adjustedTime = (currentTime + (calib.offset || 0)) * (calib.speed || 1);
      if (adjustedTime < 0) adjustedTime = 0;

      let lineIndex = Math.floor((adjustedTime / duration) * lines.length);
      if (lineIndex < 0) lineIndex = 0;
      if (lineIndex > lines.length - 1) lineIndex = lines.length - 1;

      lines.forEach((l, idx) => {
        if (idx === lineIndex) {
          l.classList.add('active');
          l.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          l.classList.remove('active');
        }
      });

      if (cinemaLyricsBody) {
        const cinemaLines = cinemaLyricsBody.querySelectorAll('.lyrics-line');
        cinemaLines.forEach((l, idx) => {
          if (idx === lineIndex) {
            l.classList.add('active');
            if (cinemaMode && cinemaMode.classList.contains('active')) {
              l.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else {
            l.classList.remove('active');
          }
        });

        if (karaokeActive && cinemaLines[lineIndex]) {
          const rawLineProgress = (adjustedTime / duration) * lines.length - lineIndex;
          const lineProgress = Math.max(0, Math.min(1, rawLineProgress));
          updateKaraokeWords(cinemaLines[lineIndex], lineProgress);
        }
      }
    }
  });
});

// Barra de progreso arrastrable: el relleno y el tiempo siguen al dedo/cursor en vivo,
// y la posición real del audio solo se actualiza al soltar (para no trabar la reproducción).
let isSeekingMain = false;

function makeSeekbarDraggable(container, fillEl, timeLabelEl) {
  if (!container || !fillEl) return;
  let dragging = false;

  function computeRatio(clientX) {
    const rect = container.getBoundingClientRect();
    let ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    return ratio;
  }

  function updateVisual(ratio) {
    fillEl.style.width = (ratio * 100) + '%';
    if (timeLabelEl && activeAudio.duration) {
      const t = ratio * activeAudio.duration;
      const format = (s) => Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2);
      timeLabelEl.textContent = format(t);
    }
  }

  function start(clientX) { dragging = true; isSeekingMain = true; updateVisual(computeRatio(clientX)); }
  function move(clientX) { if (dragging) updateVisual(computeRatio(clientX)); }
  function end(clientX) {
    if (!dragging) return;
    dragging = false;
    if (activeAudio.duration) activeAudio.currentTime = computeRatio(clientX) * activeAudio.duration;
    isSeekingMain = false;
  }

  container.addEventListener('mousedown', (e) => start(e.clientX));
  window.addEventListener('mousemove', (e) => move(e.clientX));
  window.addEventListener('mouseup', (e) => end(e.clientX));

  container.addEventListener('touchstart', (e) => start(e.touches[0].clientX), { passive: true });
  window.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
  window.addEventListener('touchend', (e) => end(e.changedTouches[0].clientX));
}

makeSeekbarDraggable(progressContainer, progress, currentTimeEl);
makeSeekbarDraggable(cinemaProgressContainer, cinemaProgress, cinemaCurrentTimeEl);

if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    activeAudio.volume = e.target.value;
  });
}

if (btnLyricsToggle) btnLyricsToggle.addEventListener('click', () => { playSFX('open'); lyricsPanel.classList.add('active'); });
if (btnCloseLyrics) btnCloseLyrics.addEventListener('click', () => { playSFX('close'); lyricsPanel.classList.remove('active'); });

if (btnCinemaMode) {
  btnCinemaMode.addEventListener('click', () => {
    playSFX('open');
    if (songList.length === 0) return;
    if (cinemaPlayIcon && playIcon) cinemaPlayIcon.innerHTML = playIcon.innerHTML;
    if (!karaokeActive && cinemaMode) cinemaMode.classList.remove('karaoke-layout');
    if (cinemaMode) cinemaMode.classList.add('active');
  });
}
if (btnCloseCinema) btnCloseCinema.addEventListener('click', () => { playSFX('close'); cinemaMode.classList.remove('active'); });
if (cinemaPrev) cinemaPrev.addEventListener('click', () => { if (prevBtn) prevBtn.click(); });
if (cinemaPlay) cinemaPlay.addEventListener('click', () => { if (playBtn) playBtn.click(); });
if (cinemaNext) cinemaNext.addEventListener('click', () => { if (nextBtn) nextBtn.click(); });
if (cinemaEq) cinemaEq.addEventListener('click', () => { if (btnEqToggle) btnEqToggle.click(); });

if (btnCalibrateLyrics) {
  btnCalibrateLyrics.addEventListener('click', () => {
    playSFX('open');
    if (songList.length === 0) return;
    const song = songList[currentIndex];
    const calib = song.lyricsCalibration || { scale: 100, speed: 1, offset: 0 };
    pendingCalibration = { scale: calib.scale || 100, speed: calib.speed || 1, offset: calib.offset || 0 };
    pendingBpm = song.bpm || null;

    if (calibrateScale) calibrateScale.value = pendingCalibration.scale;
    if (calibrateScaleValue) calibrateScaleValue.textContent = pendingCalibration.scale + '%';
    if (calibrateSpeed) calibrateSpeed.value = pendingCalibration.speed;
    if (calibrateSpeedValue) calibrateSpeedValue.textContent = pendingCalibration.speed.toFixed(2) + 'x';
    if (calibrateOffsetValue) calibrateOffsetValue.textContent = pendingCalibration.offset.toFixed(1) + 's';
    if (inputBpm) inputBpm.value = pendingBpm ? Math.round(pendingBpm) : '';

    openModal(modalCalibrateLyrics);
  });
}

if (btnCloseCalibrate) btnCloseCalibrate.addEventListener('click', () => { playSFX('close'); closeModal(modalCalibrateLyrics); });

if (calibrateScale) {
  calibrateScale.addEventListener('input', (e) => {
    pendingCalibration.scale = parseInt(e.target.value, 10);
    if (calibrateScaleValue) calibrateScaleValue.textContent = pendingCalibration.scale + '%';
    document.documentElement.style.setProperty('--lyrics-scale', pendingCalibration.scale / 100);
  });
}

if (calibrateSpeed) {
  calibrateSpeed.addEventListener('input', (e) => {
    pendingCalibration.speed = parseFloat(e.target.value);
    if (calibrateSpeedValue) calibrateSpeedValue.textContent = pendingCalibration.speed.toFixed(2) + 'x';
  });
}

if (calibrateOffsetBack) {
  calibrateOffsetBack.addEventListener('click', () => {
    playSFX('click');
    pendingCalibration.offset = Math.max(-30, Math.round((pendingCalibration.offset - 0.5) * 10) / 10);
    if (calibrateOffsetValue) calibrateOffsetValue.textContent = pendingCalibration.offset.toFixed(1) + 's';
  });
}

if (calibrateOffsetForward) {
  calibrateOffsetForward.addEventListener('click', () => {
    playSFX('click');
    pendingCalibration.offset = Math.min(30, Math.round((pendingCalibration.offset + 0.5) * 10) / 10);
    if (calibrateOffsetValue) calibrateOffsetValue.textContent = pendingCalibration.offset.toFixed(1) + 's';
  });
}

// El BPM real de la canción ajusta automáticamente la velocidad de la letra
// (tomando 120 BPM como referencia "normal" = velocidad 1.00x)
if (inputBpm) {
  inputBpm.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!val || val <= 0) { pendingBpm = null; return; }
    pendingBpm = val;
    let autoSpeed = val / 120;
    if (autoSpeed < 0.5) autoSpeed = 0.5;
    if (autoSpeed > 2) autoSpeed = 2;
    autoSpeed = Math.round(autoSpeed * 20) / 20; // redondeado al escalón del slider (0.05)
    pendingCalibration.speed = autoSpeed;
    if (calibrateSpeed) calibrateSpeed.value = autoSpeed;
    if (calibrateSpeedValue) calibrateSpeedValue.textContent = autoSpeed.toFixed(2) + 'x';
  });
}

if (btnResetBpm) {
  btnResetBpm.addEventListener('click', () => {
    playSFX('click');
    pendingBpm = null;
    if (inputBpm) inputBpm.value = '';
    pendingCalibration.speed = 1;
    if (calibrateSpeed) calibrateSpeed.value = 1;
    if (calibrateSpeedValue) calibrateSpeedValue.textContent = '1.00x';
  });
}

if (btnSaveCalibration) {
  btnSaveCalibration.addEventListener('click', () => {
    playSFX('click');
    if (songList.length === 0) { closeModal(modalCalibrateLyrics); return; }
    const song = songList[currentIndex];
    song.lyricsCalibration = { scale: pendingCalibration.scale, speed: pendingCalibration.speed, offset: pendingCalibration.offset };
    if (pendingBpm) song.bpm = Math.round(pendingBpm);
    else delete song.bpm;
    updateSongInDB(song);
    closeModal(modalCalibrateLyrics);
  });
}

function applyLyricsCalibration(song) {
  const calib = (song && song.lyricsCalibration) || { scale: 100, speed: 1, offset: 0 };
  document.documentElement.style.setProperty('--lyrics-scale', (calib.scale || 100) / 100);
}

function displayLyrics(text) {
  if (!lyricsBody) return;
  lyricsBody.innerHTML = '';
  if (cinemaLyricsBody) cinemaLyricsBody.innerHTML = '';
  (text || '').split('\n').forEach(line => {
    const p = document.createElement('p');
    p.className = 'lyrics-line';
    p.textContent = line || '...';
    lyricsBody.appendChild(p);

    if (cinemaLyricsBody) {
      const p2 = document.createElement('p');
      p2.className = 'lyrics-line';
      const words = (line || '...').split(' ');
      words.forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'karaoke-word';
        span.textContent = word + (i < words.length - 1 ? ' ' : '');
        p2.appendChild(span);
      });
      cinemaLyricsBody.appendChild(p2);
    }
  });
}

if (btnEditLyrics) {
  btnEditLyrics.addEventListener('click', () => {
    playSFX('click');
    if (songList.length === 0) return;
    if (lyricsTextarea) lyricsTextarea.value = songList[currentIndex].lyrics;
    if (lyricsBody) lyricsBody.classList.add('hidden');
    if (lyricsEditor) lyricsEditor.classList.remove('hidden');
  });
}

if (btnSaveLyrics) {
  btnSaveLyrics.addEventListener('click', () => {
    playSFX('click');
    if (songList.length === 0) return;
    const newLyrics = lyricsTextarea ? lyricsTextarea.value : "";
    songList[currentIndex].lyrics = newLyrics;
    updateSongInDB(songList[currentIndex]);
    displayLyrics(newLyrics);
    if (lyricsEditor) lyricsEditor.classList.add('hidden');
    if (lyricsBody) lyricsBody.classList.remove('hidden');
  });
}
// ==========================================
// MODO VEHÍCULO
// ==========================================
function syncVehicleMode() {
  if (!vehicleMode || !vehicleMode.classList.contains('active')) return;
  const song = songList[currentIndex];
  if (!song) return;
  if (vehicleCover) vehicleCover.src = song.cover;
  if (vehicleTitle) vehicleTitle.textContent = song.title;
  if (vehicleArtist) vehicleArtist.textContent = song.artist;
  if (vehicleBg) vehicleBg.style.backgroundImage = `url(${song.cover})`;
  if (vehiclePlayIcon && playIcon) vehiclePlayIcon.innerHTML = playIcon.innerHTML;
}

if (btnVehicleMode) {
  btnVehicleMode.addEventListener('click', () => {
    playSFX('open');
    if (songList.length === 0) return;
    if (vehicleMode) vehicleMode.classList.add('active');
    syncVehicleMode();
  });
}
if (btnExitVehicle) {
  btnExitVehicle.addEventListener('click', () => { playSFX('close'); vehicleMode.classList.remove('active'); });
}
const vehiclePrevBtn = document.getElementById('vehicle-prev');
const vehiclePlayBtn = document.getElementById('vehicle-play');
const vehicleNextBtn = document.getElementById('vehicle-next');
if (vehiclePrevBtn) vehiclePrevBtn.addEventListener('click', () => prevBtn.click());
if (vehiclePlayBtn) vehiclePlayBtn.addEventListener('click', () => playBtn.click());
if (vehicleNextBtn) vehicleNextBtn.addEventListener('click', () => nextBtn.click());

// ==========================================
// KARAOKE (reutiliza el Modo Cine + resaltado palabra por palabra)
// ==========================================
let karaokeActive = false;
if (btnOpenKaraoke) {
  btnOpenKaraoke.addEventListener('click', () => {
    karaokeActive = true;
    if (cinemaMode) cinemaMode.classList.add('karaoke-layout');
    if (btnCinemaMode) btnCinemaMode.click();
  });
}
if (btnConfigureKaraoke) {
  btnConfigureKaraoke.addEventListener('click', () => {
    if (btnCalibrateLyrics) btnCalibrateLyrics.click();
  });
}
if (btnCloseCinema) {
  btnCloseCinema.addEventListener('click', () => { karaokeActive = false; });
}

document.querySelectorAll('.lyrics-bg-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.lyrics-bg-mode-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    applyCinemaBgMode(e.currentTarget.dataset.bg);
  });
});

// Aplica el modo de fondo elegido para el Modo Cine / Karaoke.
// "Automático" usa tu fondo animado si tienes uno puesto; si no, usa la carátula difuminada.
function applyCinemaBgMode(mode) {
  if (!cinemaMode) return;
  cinemaMode.classList.remove('bg-black', 'bg-white', 'bg-animated');
  if (mode === 'auto') {
    const hasAnimatedBg = bgVideo && bgVideo.src && !bgVideo.classList.contains('bg-video-hidden');
    if (hasAnimatedBg) cinemaMode.classList.add('bg-animated');
  } else if (mode === 'black') cinemaMode.classList.add('bg-black');
  else if (mode === 'white') cinemaMode.classList.add('bg-white');
  else if (mode === 'animated') cinemaMode.classList.add('bg-animated');
}

// Resalta palabra por palabra dentro de la línea activa (aproximado: reparte el
// tiempo de la línea entre sus palabras, ya que no tenemos el tiempo exacto de cada una)
function updateKaraokeWords(activeLineEl, lineProgress) {
  if (!activeLineEl) return;
  const words = activeLineEl.querySelectorAll('.karaoke-word');
  if (words.length === 0) return;
  const activeWordIndex = Math.floor(lineProgress * words.length);
  words.forEach((w, i) => w.classList.toggle('word-active', i <= activeWordIndex));
}

// ==========================================
// PRESETS DE MODO (Juego / Noche / Estudio)
// ==========================================
function clearModePresets() {
  document.body.classList.remove('preset-game', 'preset-night', 'preset-study');
}
const presetNormalBtn = document.getElementById('preset-normal');
const presetGameBtn = document.getElementById('preset-game');
const presetNightBtn = document.getElementById('preset-night');
const presetStudyBtn = document.getElementById('preset-study');
if (presetNormalBtn) presetNormalBtn.addEventListener('click', () => { playSFX('click'); clearModePresets(); });
if (presetGameBtn) presetGameBtn.addEventListener('click', () => { playSFX('click'); clearModePresets(); document.body.classList.add('preset-game'); });
if (presetNightBtn) presetNightBtn.addEventListener('click', () => { playSFX('click'); clearModePresets(); document.body.classList.add('preset-night'); });
if (presetStudyBtn) presetStudyBtn.addEventListener('click', () => { playSFX('click'); clearModePresets(); document.body.classList.add('preset-study'); });

// ==========================================
// INTERRUPTORES DE ANIMACIONES
// ==========================================
if (toggleAnimMaster) {
  toggleAnimMaster.addEventListener('change', (e) => {
    document.body.classList.toggle('no-animations', !e.target.checked);
  });
}
if (toggleAnimGlide) {
  toggleAnimGlide.addEventListener('change', (e) => {
    document.body.classList.toggle('anim-no-glide', !e.target.checked);
  });
}
if (toggleAnimAddSong) {
  toggleAnimAddSong.addEventListener('change', (e) => {
    document.body.classList.toggle('anim-no-addsong', !e.target.checked);
  });
}
if (toggleAnimModals) {
  toggleAnimModals.addEventListener('change', (e) => {
    document.body.classList.toggle('anim-no-modals', !e.target.checked);
  });
}
