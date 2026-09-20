// ==========================================
// 1. BASE DE DATOS INDEXEDDB Y ESTADO GLOBAL
// ==========================================
let db;
const dbRequest = indexedDB.open("MusicPlayerDB", 4);
const GLASSTRACK_INITIALIZED_KEY = 'glasstrack_initialized';

async function requestPersistentStorage() {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
      return false;
    }

    if (typeof navigator.storage.persisted === 'function') {
      const alreadyPersistent = await navigator.storage.persisted();
      if (alreadyPersistent) {
        localStorage.setItem('glasstrack_storage_persisted', 'true');
        return true;
      }
    }

    const granted = await navigator.storage.persist();
    localStorage.setItem(
      'glasstrack_storage_persisted',
      granted ? 'true' : 'false'
    );
    return granted;
  } catch (error) {
    console.warn('No se pudo solicitar almacenamiento persistente:', error);
    return false;
  }
}

// La inicialización se marca una sola vez. Este build no inyecta canciones de prueba;
// la marca impide que futuras rutinas de seed vuelvan a poblar la biblioteca después
// de un refresco o una recarga.
function ensureGlasstrackInitialized() {
  if (localStorage.getItem(GLASSTRACK_INITIALIZED_KEY) !== 'true') {
    localStorage.setItem(GLASSTRACK_INITIALIZED_KEY, 'true');
  }
}

// El auto-scroll de letras se "peleaba" con el scroll manual del usuario (lo forzaba
// de vuelta arriba). Ahora, si el usuario desplaza a mano, dejamos de auto-scrollear
// durante 4 segundos para que pueda leer el resto de la letra con libertad.
let lyricsUserScrollUntil = 0;
let lyricsProgrammaticScrollUntil = 0;
let lastLyricsLineIndex = -1;
let lastCinemaLyricsLineIndex = -1;
function autoScrollLyricsLine(el) {
  if (!el || Date.now() < lyricsUserScrollUntil) return;
  lyricsProgrammaticScrollUntil = Date.now() + 700;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function watchManualLyricsScroll(container) {
  if (!container) return;
  container.addEventListener('scroll', () => {
    if (Date.now() < lyricsProgrammaticScrollUntil) return; // fue nuestro propio auto-scroll
    lyricsUserScrollUntil = Date.now() + 4000;
  }, { passive: true });
}

// Formato de tiempo centralizado (MM:SS) — con protección para que nunca salga
// un número raro (NaN, infinito, etc.) en ningún contador de la app.
function formatTime(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + ('0' + s).slice(-2);
}

dbRequest.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("songs")) {
    db.createObjectStore("songs", { keyPath: "id", autoIncrement: true });
  }
  // Nuevo en la versión 2: guarda el fondo de pantalla (imagen/video) para que
  // sobreviva a recargar la página, en vez de perderse siempre.
  if (!db.objectStoreNames.contains("settings")) {
    db.createObjectStore("settings", { keyPath: "key" });
  }
  // Versión 3: blobs de videos/GIF locales del Modo Estudio Y2K Stream.
  if (!db.objectStoreNames.contains("streamMedia")) {
    db.createObjectStore("streamMedia", { keyPath: "slot" });
  }
  // Versión 4: charts del Modo Ritmo, uno por canción.
  if (!db.objectStoreNames.contains("charts")) {
    db.createObjectStore("charts", { keyPath: "songId" });
  }
};

dbRequest.onsuccess = (e) => {
  db = e.target.result;
  requestPersistentStorage();
  loadStoredSongs();
  loadStoredBackground();
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
let sfxEnabled = localStorage.getItem('glasstrack_sfx_enabled') === 'true';
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
watchManualLyricsScroll(lyricsBody);
watchManualLyricsScroll(cinemaLyricsBody);
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
const toggleShowBar = document.getElementById('toggle-show-bar');
const controlNotificationBar = document.getElementById('control-notification-bar');
const toggleShowIcon = document.getElementById('toggle-show-icon');
const toggleShowName = document.getElementById('toggle-show-name');
const toggleMediaKeys = document.getElementById('toggle-media-keys');
const toggleDecoratedLyrics = document.getElementById('toggle-decorated-lyrics');
const toggleStreamStudio = document.getElementById('toggle-stream-studio');
const btnOpenStreamStudio = document.getElementById('btn-open-stream-studio');
const streamStudioMode = document.getElementById('stream-studio-mode');
const btnStreamStudioClose = document.getElementById('btn-stream-studio-close');
const btnStreamStudioPlay = document.getElementById('btn-stream-play');
const btnStreamStudioPause = document.getElementById('btn-stream-pause');
const btnStreamStudioRestart = document.getElementById('btn-stream-restart');
const btnStreamStudioReset = document.getElementById('btn-stream-reset');
const streamSlotList = document.getElementById('stream-slot-list');
const streamLivePreview = document.getElementById('stream-live-preview');
const streamPreviewClock = document.getElementById('stream-preview-clock');
const streamCurrentSlot = document.getElementById('stream-current-slot');
const streamCurrentMedia = document.getElementById('stream-current-media');
const streamStatus = document.getElementById('stream-studio-status');
const streamPreviewNick = document.getElementById('stream-preview-nick');
const streamPreviewBadge = document.getElementById('stream-preview-badge');
const streamProfilePreview = document.getElementById('stream-profile-preview');
const streamPreviewTitle = document.getElementById('stream-preview-title');
const streamPreviewArtist = document.getElementById('stream-preview-artist');
const streamLyricPreview = document.getElementById('stream-lyric-preview');
const streamMarkerFill = document.getElementById('stream-marker-fill');
const streamMediaA = document.getElementById('stream-media-a');
const streamMediaB = document.getElementById('stream-media-b');
const streamGifA = document.getElementById('stream-gif-a');
const streamGifB = document.getElementById('stream-gif-b');

const inputAudioSpeed = document.getElementById('input-audio-speed');
const audioSpeedVal = document.getElementById('audio-speed-val');
const toggleMonoAudio = document.getElementById('toggle-mono-audio');
const toggleNormalizeVolume = document.getElementById('toggle-normalize-volume');
const toggleFadePlayback = document.getElementById('toggle-fade-playback');
const toggleAutopauseTab = document.getElementById('toggle-autopause-tab');
const toggleResumePosition = document.getElementById('toggle-resume-position');
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
const btnClearLyrics = document.getElementById('btn-clear-lyrics');

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
setInterval(ensureBgVideoPlaying, 1500);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ensureBgVideoPlaying();
});
// Además de revisar cada rato, reaccionamos al instante si el navegador lo pausa o lo "atasca"
['pause', 'stalled', 'suspend', 'waiting'].forEach(evt => {
  bgVideo.addEventListener(evt, () => setTimeout(ensureBgVideoPlaying, 200));
});
const bgCustomImage = document.getElementById('bg-custom-image');
const inputBgImage = document.getElementById('input-bg-image');
const inputBgVideo = document.getElementById('input-bg-video');
const btnRemoveBg = document.getElementById('btn-remove-bg');
const selectFont = document.getElementById('select-font');
const inputCustomColor = document.getElementById('input-custom-color');
const btnFactoryReset = document.getElementById('btn-factory-reset');
const btnAppInfo = document.getElementById('btn-app-info');
const modalAppInfo = document.getElementById('modal-app-info');
const btnCloseAppInfo = document.getElementById('btn-close-app-info');
if (btnAppInfo) btnAppInfo.addEventListener('click', () => { playSFX('open'); openModal(modalAppInfo); });
if (btnCloseAppInfo) btnCloseAppInfo.addEventListener('click', () => { playSFX('close'); closeModal(modalAppInfo); });
if (modalAppInfo) {
  modalAppInfo.addEventListener('click', (e) => {
    if (e.target === modalAppInfo) { playSFX('close'); closeModal(modalAppInfo); }
  });
}

const toggleSFX = document.getElementById('toggle-sfx');
const toggleCrossfade = document.getElementById('toggle-crossfade');

// ==========================================
// 3. AUDIO CONTEXT, EQ Y SINTETIZADOR DE SFX
// ==========================================
let audioCtx, track1, track2;
let eqFilters = [];
let bassBoostFilter, pannerNode, lfo8d, lfoGain8d, limiterNode;
let midGain, sideGain;
let concludorAnalyser;
let stereoBypassGain, monoSplitter, monoSumGain, monoMerger, monoOutGain;

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function initAudioContext() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    track1 = audioCtx.createMediaElementSource(audio1);
    track2 = audioCtx.createMediaElementSource(audio2);

    // --- Ecualizador de 10 bandas ---
    eqFilters = EQ_FREQS.map((freq, i) => {
      const f = audioCtx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = freq;
      f.Q.value = 1.0;
      const sliders = document.querySelectorAll('.eq-band-range');
      f.gain.value = sliders[i] ? parseFloat(sliders[i].value) || 0 : 0;
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

    // Analizador para el visualizador de frecuencias del Modo Concluidor (dato de audio real, no decorativo)
    concludorAnalyser = audioCtx.createAnalyser();
    concludorAnalyser.fftSize = 64;
    limiterNode.connect(concludorAnalyser);

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
  saveAudioSettings();
}

// Guarda y restaura EQ, Mono/8D/Bass Boost/Normalización/Limitador, balance, velocidad y
// preset de modo — antes ninguno de estos ajustes sobrevivía a recargar la página.
function saveAudioSettings() {
  const preset = document.body.classList.contains('preset-game') ? 'game'
    : document.body.classList.contains('preset-night') ? 'night'
    : document.body.classList.contains('preset-study') ? 'study' : 'normal';
  const settings = {
    mono: toggleMonoAudio ? toggleMonoAudio.checked : false,
    bassBoost: toggleBassBoost ? toggleBassBoost.checked : false,
    eightD: toggle8dAudio ? toggle8dAudio.checked : false,
    limiter: toggleVolumeLimiter ? toggleVolumeLimiter.checked : false,
    normalize: toggleNormalizeVolume ? toggleNormalizeVolume.checked : false,
    balance: inputAudioBalance ? inputAudioBalance.value : 0,
    speed: inputAudioSpeed ? inputAudioSpeed.value : 1,
    eqBands: Array.from(document.querySelectorAll('.eq-band-range')).map(s => s.value),
    preset
  };
  localStorage.setItem('audioSettings', JSON.stringify(settings));
}

function loadAudioSettings() {
  let s;
  try { s = JSON.parse(localStorage.getItem('audioSettings') || 'null'); } catch (err) { s = null; }
  if (!s) return;
  if (toggleMonoAudio) toggleMonoAudio.checked = !!s.mono;
  if (toggleBassBoost) toggleBassBoost.checked = !!s.bassBoost;
  if (toggle8dAudio) toggle8dAudio.checked = !!s.eightD;
  if (toggleVolumeLimiter) toggleVolumeLimiter.checked = !!s.limiter;
  if (toggleNormalizeVolume) toggleNormalizeVolume.checked = !!s.normalize;
  if (inputAudioBalance && s.balance !== undefined) inputAudioBalance.value = s.balance;
  if (inputAudioSpeed && s.speed !== undefined) {
    inputAudioSpeed.value = s.speed;
    const val = parseFloat(s.speed);
    if (audioSpeedVal) audioSpeedVal.textContent = val.toFixed(2) + 'x';
    const quickLabel = document.getElementById('quick-speed-label');
    if (quickLabel) quickLabel.textContent = val.toFixed(2).replace(/\.?0+$/, '') + 'x';
  }
  if (s.eqBands) {
    document.querySelectorAll('.eq-band-range').forEach((slider, i) => {
      if (s.eqBands[i] !== undefined) slider.value = s.eqBands[i];
    });
  }
  if (s.preset && s.preset !== 'normal') {
    document.body.classList.add('preset-' + s.preset);
    if (s.preset === 'night') {
      const nightOverlay = document.getElementById('night-mode-overlay');
      if (nightOverlay) nightOverlay.classList.add('active');
    }
  }
}
loadAudioSettings();

if (inputAudioSpeed) {
  inputAudioSpeed.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (audioSpeedVal) audioSpeedVal.textContent = val.toFixed(2) + 'x';
    const quickLabel = document.getElementById('quick-speed-label');
    if (quickLabel) quickLabel.textContent = val.toFixed(2).replace(/\.?0+$/, '') + 'x';
    applyAudioEngineSettings();
  });
}

// Botón rápido de velocidad en el propio reproductor: alterna 1x -> 1.25x -> 1.5x -> 2x -> 1x
const btnQuickSpeed = document.getElementById('btn-quick-speed');
const QUICK_SPEEDS = [1, 1.25, 1.5, 2];
if (btnQuickSpeed) {
  btnQuickSpeed.addEventListener('click', () => {
    playSFX('click');
    const current = inputAudioSpeed ? parseFloat(inputAudioSpeed.value) : 1;
    let idx = QUICK_SPEEDS.findIndex(s => Math.abs(s - current) < 0.01);
    idx = (idx + 1) % QUICK_SPEEDS.length;
    const next = QUICK_SPEEDS[idx];
    if (inputAudioSpeed) inputAudioSpeed.value = next;
    if (audioSpeedVal) audioSpeedVal.textContent = next.toFixed(2) + 'x';
    const quickLabel = document.getElementById('quick-speed-label');
    if (quickLabel) quickLabel.textContent = (next % 1 === 0 ? next : next.toFixed(2).replace(/0$/, '')) + 'x';
    applyAudioEngineSettings();
    showToast('Velocidad: ' + next + 'x', 'info', 1500);
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
    saveAudioSettings();
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
    saveAudioSettings();
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

// Mensajes tipo "toast" abajo a la izquierda, en vez del alert() feo del navegador.
const toastContainer = document.getElementById('toast-container');
function showToast(message, type = 'info', duration = 4000) {
  if (!toastContainer) { console.warn(message); return; }
  const toast = document.createElement('div');
  toast.className = 'app-toast' + (type === 'error' ? ' toast-error' : '');
  toast.textContent = message;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('active'));
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Un solo AudioContext reutilizado para los SFX (antes se creaba uno nuevo cada vez,
// lo cual desperdicia recursos y puede sonar entrecortado).
let sfxAudioCtx = null;
function getSfxContext() {
  if (!sfxAudioCtx) {
    try { sfxAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (sfxAudioCtx.state === 'suspended') sfxAudioCtx.resume();
  return sfxAudioCtx;
}

// Sonido de interfaz estilo teclado mecánico: un golpe muy corto, con
// transitorio agudo + pequeño "thock" filtrado. No usa archivos externos.
function playMechanicalKey(ctx, startTime, intensity = 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  const clickFilter = ctx.createBiquadFilter();

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1850, startTime);
  filter.Q.value = 0.7;
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(125, startTime);
  osc.frequency.exponentialRampToValueAtTime(82, startTime + 0.045);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(0.026 * intensity, startTime + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.055);

  clickFilter.type = 'bandpass';
  clickFilter.frequency.setValueAtTime(4300, startTime);
  clickFilter.Q.value = 1.15;
  clickOsc.type = 'square';
  clickOsc.frequency.setValueAtTime(4100, startTime);
  clickOsc.frequency.exponentialRampToValueAtTime(2350, startTime + 0.018);
  clickOsc.connect(clickFilter);
  clickFilter.connect(clickGain);
  clickGain.connect(ctx.destination);
  clickGain.gain.setValueAtTime(0.0001, startTime);
  clickGain.gain.linearRampToValueAtTime(0.012 * intensity, startTime + 0.001);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.024);

  osc.start(startTime);
  osc.stop(startTime + 0.065);
  clickOsc.start(startTime);
  clickOsc.stop(startTime + 0.03);
}

function playSFX(type = 'click') {
  if (!sfxEnabled) return;
  const ctx = getSfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    if (type === 'open') {
      playMechanicalKey(ctx, now, 0.92);
      playMechanicalKey(ctx, now + 0.045, 0.72);
    } else if (type === 'close') {
      playMechanicalKey(ctx, now, 0.86);
      playMechanicalKey(ctx, now + 0.032, 0.62);
    } else {
      playMechanicalKey(ctx, now, 0.78);
    }
  } catch (e) {}
}

// ==========================================
// 4. MEDIA SESSION Y ESTADÍSTICAS
// ==========================================
function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;
  const showBar = toggleShowBar ? toggleShowBar.checked : true;
  const showIcon = toggleShowIcon ? toggleShowIcon.checked : true;
  const showName = toggleShowName ? toggleShowName.checked : true;
  const mediaKeys = toggleMediaKeys ? toggleMediaKeys.checked : true;

  if (!showBar) {
    try { navigator.mediaSession.metadata = null; } catch (e) {}
    clearMediaSessionHandlers();
    return;
  }

  const artwork = showIcon && song.cover ? [{ src: song.cover, sizes: '512x512', type: 'image/jpeg' }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: showName ? (song.title || 'Sin canción cargada') : '',
    artist: showName ? (song.artist || 'GLASSTRACK') : '',
    album: 'Mi Música',
    artwork
  });

  if (!mediaKeys) {
    clearMediaSessionHandlers();
    return;
  }

  try { navigator.mediaSession.setActionHandler('play', () => playSong()); } catch (e) {}
  try { navigator.mediaSession.setActionHandler('pause', () => pauseSong()); } catch (e) {}
  try { navigator.mediaSession.setActionHandler('previoustrack', () => prevBtn && prevBtn.click()); } catch (e) {}
  try { navigator.mediaSession.setActionHandler('nexttrack', () => nextBtn && nextBtn.click()); } catch (e) {}
}


setInterval(() => {
  if (playerCard && playerCard.classList.contains('playing')) {
    totalPlayedSeconds++;
    localStorage.setItem('totalPlayedSeconds', totalPlayedSeconds.toString());
    updateTimeStatDisplay();

    const todayKey = getDateKey();
    listeningStats.daily[todayKey] = (listeningStats.daily[todayKey] || 0) + 1;
    const song = songList[currentIndex];
    if (song) {
      const songKey = song.id !== undefined ? ('id:' + song.id) : (song.title + '||' + song.artist);
      listeningStats.bySong[songKey] = (listeningStats.bySong[songKey] || 0) + 1;
      if (song.artist) listeningStats.byArtist[song.artist] = (listeningStats.byArtist[song.artist] || 0) + 1;
    }
    saveListeningStats();
    updateListeningStatsDisplay();
  }
}, 1000);

function updateTimeStatDisplay() {
  const hours = Math.floor(totalPlayedSeconds / 3600);
  const minutes = Math.floor((totalPlayedSeconds % 3600) / 60);
  const seconds = Math.floor(totalPlayedSeconds % 60);

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

// --- Estadísticas de escucha: hoy, artista más escuchado, top canciones ---
function getDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return `${y}-${m}-${day}`;
}

let listeningStats = { daily: {}, bySong: {}, byArtist: {} };
try {
  const stored = JSON.parse(localStorage.getItem('listeningStats') || '{}');
  listeningStats.daily = stored.daily || {};
  listeningStats.bySong = stored.bySong || {};
  listeningStats.byArtist = stored.byArtist || {};
} catch (err) { /* datos corruptos o inexistentes: seguimos con listas vacías */ }

function saveListeningStats() {
  // Solo nos quedamos con los últimos 30 días para que esto no crezca sin límite
  const keys = Object.keys(listeningStats.daily).sort();
  if (keys.length > 30) keys.slice(0, keys.length - 30).forEach(k => delete listeningStats.daily[k]);
  localStorage.setItem('listeningStats', JSON.stringify(listeningStats));
}

function updateListeningStatsDisplay() {
  const todaySeconds = listeningStats.daily[getDateKey()] || 0;
  const statTodayTime = document.getElementById('stat-today-time');
  if (statTodayTime) statTodayTime.textContent = `${Math.floor(todaySeconds / 60)}m ${Math.floor(todaySeconds % 60)}s`;

  const artistEntries = Object.entries(listeningStats.byArtist).sort((a, b) => b[1] - a[1]);
  const statTopArtist = document.getElementById('stat-top-artist');
  if (statTopArtist) statTopArtist.textContent = artistEntries.length > 0 ? artistEntries[0][0] : '-';

  const statTopSongsList = document.getElementById('stat-top-songs');
  if (statTopSongsList) {
    const songEntries = Object.entries(listeningStats.bySong).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (songEntries.length === 0) {
      statTopSongsList.innerHTML = '<li class="empty-msg">Todavía no hay datos suficientes</li>';
    } else {
      statTopSongsList.innerHTML = songEntries.map(([key, seconds], i) => {
        let song = null;
        if (key.startsWith('id:')) {
          const idVal = key.slice(3);
          song = songList.find(s => String(s.id) === idVal);
        } else {
          const [t, a] = key.split('||');
          song = songList.find(s => s.title === t && s.artist === a);
        }
        const name = song ? song.title : 'Canción no disponible';
        const art = song ? song.artist : '';
        return `<li><span>${i + 1}. ${name}${art ? ' — ' + art : ''}</span><span class="stat-count">${Math.floor(seconds / 60)}m</span></li>`;
      }).join('');
    }
  }
}
updateListeningStatsDisplay();

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
// COPIA DE SEGURIDAD JSON / ZIP / JAR
// ==========================================
function downloadFileBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function serializeSongForBackup(song) {
  const copy = { ...song };
  delete copy.fileBlob;
  delete copy.url;
  return copy;
}

async function collectBackupPayload(includeFiles = false) {
  const songs = Array.isArray(songList) ? songList : [];
  const payload = {
    format: 'glasstrack-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    songs: songs.map(serializeSongForBackup),
    playlists,
    audioSettings: localStorage.getItem('audioSettings'),
    listeningStats: localStorage.getItem('listeningStats'),
    totalPlayedSeconds: localStorage.getItem('totalPlayedSeconds'),
    concludorChain: localStorage.getItem('concludorChain'),
    customCardStyles: localStorage.getItem('customCardStyles'),
    glasstrackGlassAlpha: localStorage.getItem('glasstrackGlassAlpha'),
    glasstrackShowBar: localStorage.getItem('glasstrackShowBar'),
    glasstrackShowIcon: localStorage.getItem('glasstrackShowIcon'),
    glasstrackShowName: localStorage.getItem('glasstrackShowName'),
    glasstrackMediaKeys: localStorage.getItem('glasstrackMediaKeys')
  };
  if (includeFiles) {
    payload.files = songs.map((song, index) => ({
      index,
      name: song.fileBlob?.name || `${String(song.title || 'song').replace(/[^a-z0-9._-]+/gi, '_')}.bin`,
      type: song.fileBlob?.type || 'application/octet-stream'
    }));
  }
  return payload;
}

async function exportLibraryJson() {
  const payload = await collectBackupPayload(false);
  downloadFileBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), 'glasstrack-backup.json');
  showToast('Copia JSON exportada.', 'info', 1800);
}

async function exportLibraryArchive(extension) {
  if (!window.JSZip) {
    showToast('No se pudo cargar el motor ZIP. Recarga la página e inténtalo de nuevo.', 'error');
    return;
  }
  const zip = new JSZip();
  const payload = await collectBackupPayload(true);
  zip.file('glasstrack-backup.json', JSON.stringify(payload, null, 2));
  const songsFolder = zip.folder('songs');
  for (let i = 0; i < songList.length; i++) {
    const blob = songList[i]?.fileBlob;
    if (blob && songsFolder) songsFolder.file(payload.files[i].name, blob);
  }
  const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const filename = `glasstrack-backup.${extension}`;
  downloadFileBlob(out, filename);
  showToast(`Copia ${extension.toUpperCase()} exportada.`, 'info', 1800);
}

function remapPlaylistEntries(importedPlaylists, idMap) {
  const result = {};
  Object.entries(importedPlaylists || {}).forEach(([name, entries]) => {
    result[name] = Array.isArray(entries) ? entries.map(entry => {
      const copy = { ...entry };
      if (copy.id !== undefined && idMap.has(String(copy.id))) copy.id = idMap.get(String(copy.id));
      return copy;
    }) : [];
  });
  return result;
}

async function importLibraryJsonPayload(payload, zip = null) {
  if (!payload || payload.format !== 'glasstrack-backup') throw new Error('El archivo no es una copia de Glasstrack Pro válida.');
  const importedSongs = Array.isArray(payload.songs) ? payload.songs : [];
  const idMap = new Map();
  let importedCount = 0;

  for (let i = 0; i < importedSongs.length; i++) {
    const source = importedSongs[i];
    let fileBlob = null;
    const fileInfo = Array.isArray(payload.files) ? payload.files.find(f => f.index === i) : null;
    if (zip && fileInfo) {
      const archiveFile = zip.file(`songs/${fileInfo.name}`);
      if (archiveFile) {
        const bytes = await archiveFile.async('uint8array');
        fileBlob = new Blob([bytes], { type: fileInfo.type || 'application/octet-stream' });
        try { fileBlob.name = fileInfo.name; } catch (e) {}
      }
    }
    if (!fileBlob && source.fileBlob) fileBlob = source.fileBlob;

    const song = {
      ...source,
      fileBlob,
      url: fileBlob ? URL.createObjectURL(fileBlob) : ''
    };
    delete song.id;

    if (!db) throw new Error('La base de datos aún no está lista.');
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['songs'], 'readwrite');
      const req = tx.objectStore('songs').add(song);
      req.onsuccess = e => {
        if (source.id !== undefined) idMap.set(String(source.id), e.target.result);
        song.id = e.target.result;
        resolve();
      };
      req.onerror = () => reject(req.error || new Error('No se pudo importar una canción.'));
    });
    importedCount++;
  }

  if (payload.playlists) {
    const importedPlaylists = remapPlaylistEntries(payload.playlists, idMap);
    playlists = { ...playlists, ...importedPlaylists };
    localStorage.setItem('playlistsDB', JSON.stringify(playlists));
  }
  const localKeys = ['audioSettings','listeningStats','totalPlayedSeconds','concludorChain','customCardStyles','glasstrackGlassAlpha','glasstrackShowBar','glasstrackShowIcon','glasstrackShowName','glasstrackMediaKeys'];
  localKeys.forEach(key => {
    if (payload[key] !== undefined && payload[key] !== null) localStorage.setItem(key, payload[key]);
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  loadStoredSongs();
  showToast(`Importación completada: ${importedCount} canción(es).`, 'info', 2200);
}

if (document.getElementById('btn-export-json')) document.getElementById('btn-export-json').addEventListener('click', exportLibraryJson);
if (document.getElementById('btn-export-zip')) document.getElementById('btn-export-zip').addEventListener('click', () => exportLibraryArchive('zip'));
if (document.getElementById('btn-export-jar')) document.getElementById('btn-export-jar').addEventListener('click', () => exportLibraryArchive('jar'));
if (document.getElementById('input-import-json')) {
  document.getElementById('input-import-json').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'json') {
        const payload = JSON.parse(await file.text());
        await importLibraryJsonPayload(payload);
      } else if (ext === 'zip' || ext === 'jar') {
        if (!window.JSZip) throw new Error('Motor ZIP no disponible.');
        const zip = await JSZip.loadAsync(file);
        const manifest = zip.file('glasstrack-backup.json');
        if (!manifest) throw new Error('El ZIP/JAR no contiene glasstrack-backup.json.');
        const payload = JSON.parse(await manifest.async('string'));
        await importLibraryJsonPayload(payload, zip);
      } else {
        throw new Error('Formato no soportado.');
      }
    } catch (err) {
      console.error(err);
      showToast(`No se pudo importar el archivo: ${err.message || 'formato inválido'}`, 'error', 3500);
    }
  });
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
    const storedSongs = Array.isArray(req.result) ? req.result : [];

    // Las canciones existentes siempre se restauran desde IndexedDB.
    // Nunca se vuelven a insertar canciones de prueba por un simple refresh.
    songList = storedSongs.map(song => ({
      ...song,
      url: song.fileBlob ? URL.createObjectURL(song.fileBlob) : ''
    }));

    ensureGlasstrackInitialized();

    renderPlaylist();
    if (songList.length > 0) {
      loadSong(0, false);
    }
  };
}

function handleFiles(files) {
  Array.from(files || []).forEach((file) => {
    if (!file) return;

    const mime = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    const isImage = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name);
    const isAudio = mime.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(name);

    // Las imágenes nunca pasan por el pipeline de audio.
    if (isImage) {
      if (bgCustomImage && bgVideo) {
        const objectUrl = URL.createObjectURL(file);
        bgCustomImage.style.backgroundImage = `url("${objectUrl}")`;
        bgCustomImage.style.display = 'block';
        bgVideo.classList.add('bg-video-hidden');

        saveBackgroundToDB('image', file);

        // No tocar audio, currentTime ni songList.
        showToast('Imagen aplicada como fondo sin detener la música.', 'info');
      }
      return;
    }

    // Solo archivos de audio soportados llegan a la biblioteca.
    if (!isAudio) {
      return;
    }

    const songObj = {
      title: file.name.replace(/\.[^/.]+$/, ''),
      artist: 'Artista Desconocido',
      cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80',
      lyrics: 'No hay letra cargada.',
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
            let base64String = '';
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
  const studioOpen = lyricsStudioEl && lyricsStudioEl.classList.contains('active');
  if (!studioOpen && e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
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

  // Si cambiaste de canción (ej. con las teclas multimedia) mientras el Estudio estaba
  // abierto, lo cerramos: si no, se queda mostrando/editando datos de la canción anterior.
  const lyricsStudioElCheck = document.getElementById('lyrics-studio');
  if (lyricsStudioElCheck && lyricsStudioElCheck.classList.contains('active')) {
    lyricsStudioElCheck.classList.remove('active');
    showToast('Se cerró el Estudio de Letras porque cambiaste de canción.', 'info');
  }

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
  if (typeof window.__glasstrackMobile3DSync === 'function') {
    window.__glasstrackMobile3DSync();
  }
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
  syncMobileNowPlaying();
  renderPlaylist();
  if (window.glasstrackRhythm && typeof window.glasstrackRhythm.syncSong === 'function') {
    try { window.glasstrackRhythm.syncSong(); } catch (_) {}
  }
}

function playSongWithCrossfade(newUrl, startAt = 0) {
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  const nextAudio = (activeAudio === audio1) ? audio2 : audio1;
  const currentAudio = activeAudio;

  nextAudio.src = newUrl;
  nextAudio.volume = 0;
  if (startAt) {
    const seekNext = () => { nextAudio.currentTime = startAt; nextAudio.removeEventListener('loadedmetadata', seekNext); };
    if (nextAudio.readyState >= 1) nextAudio.currentTime = startAt;
    else nextAudio.addEventListener('loadedmetadata', seekNext);
  } else {
    nextAudio.currentTime = 0;
  }

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

  const targetVol = volumeSlider ? parseFloat(volumeSlider.value) : 1;
  const useFade = !toggleFadePlayback || toggleFadePlayback.checked;
  activeAudio.volume = useFade ? 0 : targetVol;
  const playPromise = activeAudio.play();

  if (playPromise !== undefined) {
    playPromise.then(() => {
      if (playerCard) playerCard.classList.add('playing');
      if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      if (cinemaPlayIcon && playIcon) cinemaPlayIcon.innerHTML = playIcon.innerHTML;
      syncMiniPlayer();
      syncVehicleMode();
      syncMobileNowPlaying();
      if (useFade) fadeVolumeTo(activeAudio, targetVol, 300);
    }).catch(err => console.error("Error en reproducción:", err));
  }
}

function fadeVolumeTo(audioEl, target, ms) {
  clearInterval(audioEl._fadeInterval);
  const steps = Math.max(1, ms / 40);
  const step = (target - audioEl.volume) / steps;
  audioEl._fadeInterval = setInterval(() => {
    const next = audioEl.volume + step;
    if ((step > 0 && next >= target) || (step < 0 && next <= target)) {
      audioEl.volume = target;
      clearInterval(audioEl._fadeInterval);
    } else {
      audioEl.volume = next;
    }
  }, 40);
}

function pauseSong() {
  if (playerCard) playerCard.classList.remove('playing');
  if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  if (cinemaPlayIcon && playIcon) cinemaPlayIcon.innerHTML = playIcon.innerHTML;
  const useFade = !toggleFadePlayback || toggleFadePlayback.checked;
  if (useFade) {
    const a = activeAudio;
    clearInterval(a._fadeInterval);
    const startVol = a.volume;
    const steps = 6;
    let i = 0;
    a._fadeInterval = setInterval(() => {
      i++;
      a.volume = Math.max(0, startVol * (1 - i / steps));
      if (i >= steps) { clearInterval(a._fadeInterval); a.pause(); }
    }, 40);
  } else {
    activeAudio.pause();
  }
  syncMiniPlayer();
  syncVehicleMode();
  syncMobileNowPlaying();
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
    } else if (concludorPlaying) {
      // Si ya hicimos un crossfade manual hacia la siguiente pista, "activeAudio" ya cambió;
      // si esta pista vieja igual llega a su final natural, no hay que avanzar dos veces
      // (eso era el bug de "sincronización" — se desincronizaba por un doble avance).
      if (a === activeAudio) advanceConcludorChain();
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
  btnFocusMode.addEventListener('click', (event) => {
    event.preventDefault();

    try {
      playSFX('open');
    } catch (_) {}

    const isFocus = !document.body.classList.contains('focus-mode');
    document.body.classList.toggle('focus-mode', isFocus);
    btnFocusMode.classList.toggle('active', isFocus);

    if (!playerCard) return;

    if (isFocus) {
      playerCard.style.position = 'fixed';
      playerCard.style.top = '50%';
      playerCard.style.left = '50%';
      playerCard.style.transform = 'translate3d(-50%, -50%, 0)';
    } else {
      playerCard.style.removeProperty('position');
      playerCard.style.removeProperty('left');
      playerCard.style.removeProperty('top');
      playerCard.style.removeProperty('transform');
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

// El mini reproductor abre una ventana nueva (window.open), algo que en Chrome de celular
// casi nunca funciona bien (se bloquea o abre como pestaña rara). En celular avisamos en vez de fallar solo.
const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 480;
document.body.classList.toggle('is-mobile-device', isMobileDevice);

if (btnMiniPlayer) {
  btnMiniPlayer.addEventListener('click', () => {
    playSFX('open');
    if (isMobileDevice) {
      showToast('El Mini Reproductor es una función de escritorio (abre una ventana aparte) y no está disponible en el navegador de celular. Usa el reproductor principal.', 'error', 5000);
      return;
    }
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
            if (miniProgress) miniProgress.style.width = pct + '%';
      if (miniCurrentTime) miniCurrentTime.textContent = formatTime(activeAudio.currentTime);
      if (miniDuration) miniDuration.textContent = formatTime(activeAudio.duration);
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
    showToast('Ninguna canción de esta playlist está disponible en tu biblioteca actual.', 'error');
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

if (btnMainMenu) btnMainMenu.addEventListener('click', () => {
  playSFX('open');
  resetSettingsSlide();
  if (modalSettings) {
    modalSettings.style.display = 'flex';
    modalSettings.classList.add('active');
    modalSettings.setAttribute('aria-hidden', 'false');
  }
});
if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => { playSFX('close'); closeModalSettings(); });

function closeModalSettings() {
  if (modalSettings) {
    modalSettings.classList.remove('active');
    modalSettings.style.display = 'none';
    modalSettings.setAttribute('aria-hidden', 'true');
  }
  const secondaryButton = document.getElementById('btn-mobile-secondary-menu');
  if (secondaryButton) secondaryButton.setAttribute('aria-expanded', 'false');
  resetSettingsSlide();
  // La barra inferior de celular se quedaba marcando "Ajustes" aunque ya hubieras cerrado el panel
  const mobileTabBarEl = document.getElementById('mobile-tab-bar');
  if (mobileTabBarEl) {
    mobileTabBarEl.querySelectorAll('.mobile-tab-btn').forEach(b => b.classList.remove('active'));
    const inicioTab = mobileTabBarEl.querySelector('[data-tab="inicio"]');
    if (inicioTab) inicioTab.classList.add('active');
  }
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

async function hardDeleteSong(song) {
  if (!song || song.id === undefined || song.id === null) {
    showToast('No se pudo eliminar la canción: falta su ID de IndexedDB.', 'error');
    return false;
  }

  try {
    // 1) Elimina físicamente el registro que contiene el Blob de audio.
    await new Promise((resolve, reject) => {
      if (!db) {
        reject(new Error('IndexedDB no está disponible'));
        return;
      }

      const storeNames = ["songs"];
      if (db.objectStoreNames.contains("charts")) storeNames.push("charts");
      const tx = db.transaction(storeNames, "readwrite");
      const store = tx.objectStore("songs");
      store.delete(song.id);
      if (db.objectStoreNames.contains("charts")) {
        tx.objectStore("charts").delete(song.id);
      }

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Error eliminando la canción'));
      tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
    });

    // 2) Libera la URL temporal de memoria.
    if (song.url) {
      try { URL.revokeObjectURL(song.url); } catch (_) {}
    }

    const deletedIndex = songList.indexOf(song);
    const wasCurrent = deletedIndex === currentIndex;
    const wasPlaying = activeAudio && !activeAudio.paused;

    // 3) Elimina la referencia de memoria.
    if (deletedIndex > -1) {
      songList.splice(deletedIndex, 1);
    }

    // 4) Quita también la canción eliminada de todas las playlists guardadas.
    Object.keys(playlists).forEach(name => {
      const list = Array.isArray(playlists[name]) ? playlists[name] : [];
      playlists[name] = list.filter(item => {
        if (song.id !== undefined && item && item.id !== undefined) {
          return item.id !== song.id;
        }
        return !(
          item &&
          item.title === song.title &&
          item.artist === song.artist
        );
      });
    });
    savePlaylistsToStorage();

    // 5) Mantén currentIndex consistente.
    if (songList.length === 0) {
      currentIndex = 0;
      audio1.pause();
      audio2.pause();
      audio1.removeAttribute('src');
      audio2.removeAttribute('src');
      audio1.load();
      audio2.load();
      if (title) title.textContent = 'Sin canción cargada';
      if (artist) artist.textContent = '—';
      if (cover) cover.removeAttribute('src');
      if (playerBgFluid) playerBgFluid.style.backgroundImage = '';
      if (lyricsBg) lyricsBg.style.backgroundImage = '';
      if (cinemaCover) cinemaCover.removeAttribute('src');
      if (cinemaTitle) cinemaTitle.textContent = 'Sin canción cargada';
      if (cinemaArtist) cinemaArtist.textContent = '—';
      if (cinemaBg) cinemaBg.style.backgroundImage = '';
      displayLyrics('');
    } else if (wasCurrent) {
      currentIndex = Math.min(
        deletedIndex,
        songList.length - 1
      );
      loadSong(currentIndex, false);
      if (wasPlaying) pauseSong();
    } else {
      if (deletedIndex > -1 && deletedIndex < currentIndex) {
        currentIndex -= 1;
      }
      renderPlaylist();
      renderHiddenList();
    }

    selectedSongForMenu = null;
    renderPlaylist();
    renderHiddenList();
    showToast(`"${song.title}" eliminada permanentemente.`, 'info');
    return true;
  } catch (error) {
    console.error('Error en hardDeleteSong:', error);
    showToast('No se pudo eliminar la canción permanentemente.', 'error');
    return false;
  }
}

if (optDeleteSong) {
  optDeleteSong.addEventListener('click', async () => {
    playSFX('click');
    if (!selectedSongForMenu) return;

    const song = selectedSongForMenu;
    const confirmed = confirm(
      `¿Eliminar permanentemente "${song.title}"?\n\nEl archivo se borrará de la biblioteca local y no podrá recuperarse desde Glasstrack.`
    );

    if (!confirmed) return;

    closeModal(modalSongMenu);
    await hardDeleteSong(song);
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
      const alreadyIn = selectedSongForMenu && playlists[pName].some(s =>
        (selectedSongForMenu.id !== undefined && s.id === selectedSongForMenu.id) ||
        (s.title === selectedSongForMenu.title && s.artist === selectedSongForMenu.artist)
      );
      if (selectedSongForMenu && !alreadyIn) {
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
const inputGraphicsLevel = document.getElementById('input-graphics-level');
function applyGraphicsLevel(level) {
  document.body.classList.remove('graphics-level-0', 'graphics-level-1');
  if (level === '0' || level === 0) document.body.classList.add('graphics-level-0');
  else if (level === '1' || level === 1) document.body.classList.add('graphics-level-1');
  // Nivel 2 (Máxima Calidad) no agrega ninguna clase: todo queda con sus efectos normales.
}
if (inputGraphicsLevel) {
  const savedLevel = localStorage.getItem('graphicsLevel');
  if (savedLevel !== null) { inputGraphicsLevel.value = savedLevel; applyGraphicsLevel(savedLevel); }
  inputGraphicsLevel.addEventListener('input', (e) => {
    applyGraphicsLevel(e.target.value);
    localStorage.setItem('graphicsLevel', e.target.value);
  });
}

if (toggleSFX) {
  toggleSFX.checked = sfxEnabled;
  toggleSFX.addEventListener('change', (e) => {
    sfxEnabled = e.target.checked;
    localStorage.setItem('glasstrack_sfx_enabled', String(sfxEnabled));
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

// Barra de control: un único estado controla el bloque completo.
function setControlNotificationBarVisible(visible) {
  if (!controlNotificationBar) return;
  controlNotificationBar.classList.toggle('bar-hidden', !visible);
  localStorage.setItem('glasstrackShowBar', visible ? 'true' : 'false');
}
if (toggleShowBar) {
  const savedShowBar = localStorage.getItem('glasstrackShowBar');
  if (savedShowBar !== null) toggleShowBar.checked = savedShowBar !== 'false';
  setControlNotificationBarVisible(toggleShowBar.checked);
  toggleShowBar.addEventListener('change', e => setControlNotificationBarVisible(e.target.checked));
}

// Estas opciones controlan Media Session sin crear estados de interfaz que se queden visibles.
function clearMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  ['play','pause','previoustrack','nexttrack'].forEach(action => {
    try { navigator.mediaSession.setActionHandler(action, null); } catch (e) {}
  });
}
function applyMediaSessionVisibilitySettings() {
  if (!('mediaSession' in navigator)) return;
  const showBar = toggleShowBar ? toggleShowBar.checked : true;
  if (!showBar) {
    try { navigator.mediaSession.metadata = null; } catch (e) {}
    clearMediaSessionHandlers();
    return;
  }
  const song = songList[currentIndex];
  if (song) updateMediaSession(song);
}
if (toggleShowIcon) toggleShowIcon.addEventListener('change', () => {
  localStorage.setItem('glasstrackShowIcon', toggleShowIcon.checked ? 'true' : 'false');
  if (songList[currentIndex]) updateMediaSession(songList[currentIndex]);
});
if (toggleShowName) toggleShowName.addEventListener('change', () => {
  localStorage.setItem('glasstrackShowName', toggleShowName.checked ? 'true' : 'false');
  if (songList[currentIndex]) updateMediaSession(songList[currentIndex]);
});
if (toggleMediaKeys) toggleMediaKeys.addEventListener('change', () => {
  localStorage.setItem('glasstrackMediaKeys', toggleMediaKeys.checked ? 'true' : 'false');
  if (toggleMediaKeys.checked && songList[currentIndex]) updateMediaSession(songList[currentIndex]);
  else clearMediaSessionHandlers();
});



// Glassmorphism: el alfa se controla con una variable CSS para evitar fondos blancos
// al aumentar la transparencia. El rango visual permanece oscuro y equilibrado.
const inputGlassOpacity = document.getElementById('input-glass-opacity');
const glassOpacityVal = document.getElementById('glass-opacity-val');
function setGlassAlpha(value) {
  const raw = Number(value);
  const alpha = Number.isFinite(raw) ? Math.max(0.05, Math.min(0.90, raw)) : 0.25;
  document.documentElement.style.setProperty('--glass-alpha', alpha.toFixed(2));
  if (glassOpacityVal) glassOpacityVal.textContent = `${Math.round(alpha * 100)}%`;
  localStorage.setItem('glasstrackGlassAlpha', String(alpha));
}
if (inputGlassOpacity) {
  const savedGlassAlpha = Number(localStorage.getItem('glasstrackGlassAlpha'));
  if (Number.isFinite(savedGlassAlpha)) inputGlassOpacity.value = Math.max(0.05, Math.min(0.90, savedGlassAlpha));
  setGlassAlpha(inputGlassOpacity.value);
  inputGlassOpacity.addEventListener('input', (e) => setGlassAlpha(e.target.value));
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
      saveBackgroundToDB('image', file);
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
      saveBackgroundToDB('video', file);
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
    if (db) db.transaction(["settings"], "readwrite").objectStore("settings").delete("background");
  });
}

// Guarda el fondo (imagen o video) en IndexedDB para que no se pierda al recargar la página
function saveBackgroundToDB(type, file) {
  if (!db) return;
  const transaction = db.transaction(["settings"], "readwrite");
  transaction.objectStore("settings").put({ key: "background", type, blob: file });
}

// Al abrir la app, si hay un fondo guardado, lo vuelve a mostrar
function loadStoredBackground() {
  if (!db || !db.objectStoreNames.contains("settings")) return;
  const transaction = db.transaction(["settings"], "readonly");
  const request = transaction.objectStore("settings").get("background");
  request.onsuccess = () => {
    const entry = request.result;
    if (!entry || !entry.blob) return;
    const url = URL.createObjectURL(entry.blob);
    if (entry.type === 'video' && bgVideo && bgCustomImage) {
      bgVideo.src = url;
      bgVideo.classList.remove('bg-video-hidden');
      bgVideo.play().catch(() => {});
      bgCustomImage.style.display = 'none';
    } else if (entry.type === 'image' && bgCustomImage && bgVideo) {
      bgCustomImage.style.backgroundImage = `url('${url}')`;
      bgCustomImage.style.display = 'block';
      bgVideo.classList.add('bg-video-hidden');
    }
  };
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
            if (currentTimeEl) currentTimeEl.textContent = formatTime(currentTime);
      if (durationEl) durationEl.textContent = formatTime(duration);

      if (cinemaProgress) cinemaProgress.style.width = `${(currentTime / duration) * 100}%`;
      if (cinemaCurrentTimeEl) cinemaCurrentTimeEl.textContent = formatTime(currentTime);
      if (cinemaDurationEl) cinemaDurationEl.textContent = formatTime(duration);
    }

    syncMiniPlayer();

    if (!lyricsBody) return;
    const lines = lyricsBody.querySelectorAll('.lyrics-line');
    if (lines.length > 0) {
      const currentSong = songList[currentIndex] || {};
      const hasRealTimes = currentSong.lrcLines && currentSong.lrcLines.length > 0;
      // Los tiempos reales del Modo Estudio se marcaron contra el tiempo real de la pista
      // (currentTime), así que se comparan tal cual. La calibración de velocidad/desfase
      // es solo para el método aproximado de abajo — aplicarla también aquí era lo que
      // hacía que las letras se "adelantaran", sobre todo con velocidades de reproducción distintas a 1x.
      let adjustedTime = currentTime;
      if (!hasRealTimes) {
        const calib = currentSong.lyricsCalibration || { speed: 1, offset: 0 };
        adjustedTime = (currentTime + (calib.offset || 0)) * (calib.speed || 1);
        if (adjustedTime < 0) adjustedTime = 0;
      }

      let lineIndex;
      if (hasRealTimes) {
        // Tenemos tiempos reales (del Modo Estudio): usamos el momento exacto de cada línea,
        // saltando las que todavía no tienen tiempo marcado (time: null)
        lineIndex = -1;
        for (let i = 0; i < currentSong.lrcLines.length; i++) {
          const t = currentSong.lrcLines[i].time;
          if (t !== null && t !== undefined && t <= adjustedTime) lineIndex = i;
          else if (t !== null && t !== undefined) break;
        }
        if (lineIndex === -1) lineIndex = 0;
        if (lineIndex > lines.length - 1) lineIndex = lines.length - 1;
      } else {
        // Sin tiempos reales: repartimos proporcionalmente como antes
        lineIndex = Math.floor((adjustedTime / duration) * lines.length);
        if (lineIndex < 0) lineIndex = 0;
        if (lineIndex > lines.length - 1) lineIndex = lines.length - 1;
      }

      lines.forEach((l, idx) => {
        if (idx === lineIndex) {
          l.classList.add('active');
        } else {
          l.classList.remove('active');
        }
      });

      if (lineIndex !== lastLyricsLineIndex && lines[lineIndex]) {
        lastLyricsLineIndex = lineIndex;
        autoScrollLyricsLine(lines[lineIndex]);
      }

      if (cinemaLyricsBody) {
        const cinemaLines = cinemaLyricsBody.querySelectorAll('.lyrics-line');
        cinemaLines.forEach((l, idx) => {
          if (idx === lineIndex) {
            l.classList.add('active');
          } else {
            l.classList.remove('active');
          }
        });

        if (
          cinemaMode &&
          cinemaMode.classList.contains('active') &&
          lineIndex !== lastCinemaLyricsLineIndex &&
          cinemaLines[lineIndex]
        ) {
          lastCinemaLyricsLineIndex = lineIndex;
          autoScrollLyricsLine(cinemaLines[lineIndex]);
        }

        if (karaokeActive && cinemaLines[lineIndex]) {
          updateKaraokeWords(cinemaLines[lineIndex], lineIndex, adjustedTime, lines.length, duration);
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
      timeLabelEl.textContent = formatTime(t);
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

function isDecoratedLyricsEnabled() {
  return !!toggleDecoratedLyrics?.checked;
}

function normalizeDecoratedCharacter(char) {
  return char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function appendDecoratedCharacter(container, char) {
  const normalized = normalizeDecoratedCharacter(char);

  if (char === ' ') {
    const space = document.createElement('span');
    space.className = 'decorated-space';
    space.setAttribute('aria-hidden', 'true');
    container.appendChild(space);
    return;
  }

  const isLetter = /^[a-z]$/.test(normalized);
  const isNumber = /^[0-9]$/.test(normalized);

  if (isLetter || isNumber) {
    const img = document.createElement('img');
    img.className = `decorated-char ${isNumber ? 'decorated-number' : 'decorated-letter'}`;
    const variant = isNumber ? 1 : Math.floor(Math.random() * 3) + 1;
    img.src = `img/letras/${normalized}_${variant}.png`;
    img.alt = char;
    img.draggable = false;
    img.loading = 'lazy';
    img.onerror = function () { this.style.display = 'none'; };
    container.appendChild(img);
    return;
  }

  const fallback = document.createElement('span');
  fallback.className = 'decorated-fallback';
  fallback.textContent = char;
  container.appendChild(fallback);
}

function createDecoratedWordElement(word) {
  const wordSpan = document.createElement('span');
  wordSpan.className = 'karaoke-word decorated-word';
  const wrapper = document.createElement('span');
  wrapper.className = 'decorated-lyrics-wrapper';
  for (const char of word) appendDecoratedCharacter(wrapper, char);
  wordSpan.appendChild(wrapper);
  return wordSpan;
}

function displayLyrics(text) {
  if (!lyricsBody) return;
  lastLyricsLineIndex = -1;
  lastCinemaLyricsLineIndex = -1;
  lyricsBody.innerHTML = '';
  if (cinemaLyricsBody) cinemaLyricsBody.innerHTML = '';

  (text || '').split('\n').forEach(line => {
    const originalLine = line || '...';
    const p = document.createElement('p');
    p.className = 'lyrics-line';
    p.textContent = originalLine;
    lyricsBody.appendChild(p);

    if (cinemaLyricsBody) {
      const p2 = document.createElement('p');
      p2.className = 'lyrics-line';

      if (isDecoratedLyricsEnabled()) {
        const parts = originalLine.split(/(\s+)/);
        parts.forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            for (const char of part) appendDecoratedCharacter(p2, char);
          } else {
            p2.appendChild(createDecoratedWordElement(part));
          }
        });
      } else {
        const words = originalLine.split(' ');
        words.forEach((word, i) => {
          const span = document.createElement('span');
          span.className = 'karaoke-word';
          span.textContent = word + (i < words.length - 1 ? ' ' : '');
          p2.appendChild(span);
        });
      }

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
    const rawText = lyricsTextarea ? lyricsTextarea.value : "";
    const song = songList[currentIndex];
    // Si lo que se pegó ya trae marcas de tiempo tipo [mm:ss.xx], las usamos de una.
    // Si no, limpiamos cualquier tiempo viejo (de una edición anterior) para que no
    // quede desincronizado con el texto nuevo — eso era lo que "congelaba" la letra.
    if (/\[\d{2}:\d{2}[.:]\d{2,3}\]/.test(rawText)) {
      const parsed = parseLrcText(rawText);
      song.lyrics = parsed.map(l => l.text).join('\n');
      song.lrcLines = parsed;
    } else {
      song.lyrics = rawText;
      delete song.lrcLines;
    }
    updateSongInDB(song);
    displayLyrics(song.lyrics);
    if (lyricsEditor) lyricsEditor.classList.add('hidden');
    if (lyricsBody) lyricsBody.classList.remove('hidden');
  });
}

if (btnClearLyrics) {
  btnClearLyrics.addEventListener('click', () => {
    playSFX('click');
    if (songList.length === 0) return;
    if (!confirm('¿Seguro que vas a borrar las letras?')) return;
    const song = songList[currentIndex];
    song.lyrics = '';
    delete song.lrcLines;
    updateSongInDB(song);
    displayLyrics('');
    if (lyricsTextarea) lyricsTextarea.value = '';
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
  syncMobileNowPlaying();
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

// Resalta palabra por palabra dentro de la línea activa: usa los tiempos reales
// calibrados en el Modo Karaoke si existen; si no, aproxima repartiendo el tiempo.
function updateKaraokeWords(activeLineEl, lineIndex, adjustedTime, totalLines, duration) {
  if (!activeLineEl) return;
  const words = activeLineEl.querySelectorAll('.karaoke-word');
  if (words.length === 0) return;

  const song = songList[currentIndex];
  const realWords = song && song.karaokeWords && song.karaokeWords[lineIndex];
  if (realWords && realWords.length === words.length) {
    let activeWordIndex = -1;
    for (let i = 0; i < realWords.length; i++) {
      if (realWords[i].time <= adjustedTime) activeWordIndex = i; else break;
    }
    words.forEach((w, i) => w.classList.toggle('word-active', i <= activeWordIndex));
  } else {
    const rawLineProgress = (adjustedTime / duration) * totalLines - lineIndex;
    const lineProgress = Math.max(0, Math.min(1, rawLineProgress));
    const activeWordIndex = Math.floor(lineProgress * words.length);
    words.forEach((w, i) => w.classList.toggle('word-active', i <= activeWordIndex));
  }
}

// ==========================================
// PRESETS DE MODO (Juego / Noche / Estudio)
// ==========================================
function clearModePresets() {
  document.body.classList.remove('preset-game', 'preset-night', 'preset-study');
  const nightOverlay = document.getElementById('night-mode-overlay');
  if (nightOverlay) nightOverlay.classList.remove('active');
}
const presetNormalBtn = document.getElementById('preset-normal');
const presetGameBtn = document.getElementById('preset-game');
const presetNightBtn = document.getElementById('preset-night');
const presetStudyBtn = document.getElementById('preset-study');
if (presetNormalBtn) presetNormalBtn.addEventListener('click', () => { playSFX('click'); clearModePresets(); });
if (presetGameBtn) presetGameBtn.addEventListener('click', () => { playSFX('click'); clearModePresets(); document.body.classList.add('preset-game'); });
if (presetNightBtn) {
  presetNightBtn.addEventListener('click', () => {
    playSFX('click');
    clearModePresets();
    document.body.classList.add('preset-night');
    const nightOverlay = document.getElementById('night-mode-overlay');
    if (nightOverlay) nightOverlay.classList.add('active');
  });
}
if (presetStudyBtn) presetStudyBtn.addEventListener('click', () => { playSFX('click'); clearModePresets(); document.body.classList.add('preset-study'); });

// ==========================================
// INTERRUPTORES DE ANIMACIONES
// ==========================================
if (toggleAnimMaster) {
  toggleAnimMaster.addEventListener('change', (e) => {
    const enabled = !!e.target.checked;
    // .checked no dispara "change" por sí solo. Actualizamos los hijos directamente
    // y sincronizamos las clases una sola vez para evitar bucles al segundo clic.
    document.querySelectorAll('.anim-toggle-input').forEach(input => {
      input.checked = enabled;
    });
    document.body.classList.toggle('no-animations', !enabled);
    document.body.classList.toggle('anim-no-glide', !enabled);
    document.body.classList.toggle('anim-no-addsong', !enabled);
    document.body.classList.toggle('anim-no-modals', !enabled);
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



// ==========================================
// EDITOR VISUAL EN VIVO (base real: fondo, bordes, sombra y cristal por tarjeta)
// ==========================================
let visualEditorActive = false;
const EDITABLE_CARDS = {
  'player-card': document.getElementById('player-card'),
  'eq-panel': document.getElementById('eq-panel'),
  'vm-panel': document.getElementById('vm-panel'),
  'library-panel': document.getElementById('library-panel'),
  'lyrics-panel': document.getElementById('lyrics-panel')
};
let customCardStyles = {};
try { customCardStyles = JSON.parse(localStorage.getItem('customCardStyles') || '{}'); } catch (e) { customCardStyles = {}; }

function applyCardStyle(el, style) {
  if (!el || !style) return;
  if (style.bgImage) {
    el.style.backgroundImage = `url(${style.bgImage})`;
    el.style.backgroundSize = style.fit === 'contain' ? 'contain' : (style.fit === 'repeat' ? 'auto' : 'cover');
    el.style.backgroundRepeat = style.fit === 'repeat' ? 'repeat' : 'no-repeat';
    el.style.backgroundPosition = 'center';
  }
  if (style.radius !== undefined) el.style.borderRadius = style.radius + 'px';
  if (style.borderWidth !== undefined) el.style.borderWidth = style.borderWidth + 'px';
  if (style.borderColor) { el.style.borderStyle = 'solid'; el.style.borderColor = style.borderColor; }
  if (style.shadow !== undefined) el.style.boxShadow = style.shadow > 0 ? `0 8px ${style.shadow}px rgba(0,0,0,0.5)` : 'none';
  if (style.glass !== undefined) {
    const alpha = Math.max(0.05, Math.min(0.90, Number(style.glass) || 0.25));
    el.style.setProperty('--glass-alpha', alpha.toFixed(2));
    el.style.background = 'rgba(18, 18, 24, var(--glass-alpha))';
  }
}

Object.keys(customCardStyles).forEach(key => {
  if (EDITABLE_CARDS[key]) applyCardStyle(EDITABLE_CARDS[key], customCardStyles[key]);
});

const btnOpenVisualEditor = document.getElementById('btn-open-visual-editor');
const visualEditorToolbar = document.getElementById('visual-editor-toolbar');
const btnExitVisualEditor = document.getElementById('btn-exit-visual-editor');
const btnResetVisualEditor = document.getElementById('btn-reset-visual-editor');
const modalCardEditor = document.getElementById('modal-card-editor');
const btnCloseCardEditor = document.getElementById('btn-close-card-editor');
const cardEditorTitle = document.getElementById('card-editor-title');
const btnCardBgImage = document.getElementById('btn-card-bg-image');
const inputCardBgImage = document.getElementById('input-card-bg-image');
const inputCardRadius = document.getElementById('input-card-radius');
const inputCardBorderWidth = document.getElementById('input-card-border-width');
const inputCardBorderColor = document.getElementById('input-card-border-color');
const inputCardShadow = document.getElementById('input-card-shadow');
const inputCardGlass = document.getElementById('input-card-glass');
const btnApplyCardStyle = document.getElementById('btn-apply-card-style');
const btnClearCardStyle = document.getElementById('btn-clear-card-style');

let editingCardKey = null;
let pendingCardBgImage = null;
let forcedVisibleCards = [];

function enterVisualEditor() {
  visualEditorActive = true;
  if (modalSettings) {
    modalSettings.classList.add('ve-closing');
    setTimeout(() => { modalSettings.classList.remove('active', 've-closing'); }, 300);
  }
  if (visualEditorToolbar) visualEditorToolbar.classList.remove('hidden');
  forcedVisibleCards = [];
  Object.entries(EDITABLE_CARDS).forEach(([key, el]) => {
    if (!el) return;
    el.classList.add('editable-highlight');
    // Algunos paneles (EQ, Voz/Música, Letras) normalmente están ocultos hasta que los abres:
    // los mostramos igual durante la edición para que se puedan tocar y personalizar.
    if (el.classList.contains('hidden')) {
      el.classList.remove('hidden');
      forcedVisibleCards.push({ el, type: 'hidden' });
    }
    if (key === 'lyrics-panel' && !el.classList.contains('active')) {
      el.classList.add('active');
      forcedVisibleCards.push({ el, type: 'active' });
    }
  });
}
function exitVisualEditor() {
  visualEditorActive = false;
  if (visualEditorToolbar) visualEditorToolbar.classList.add('hidden');
  Object.values(EDITABLE_CARDS).forEach(el => { if (el) el.classList.remove('editable-highlight'); });
  forcedVisibleCards.forEach(({ el, type }) => {
    if (type === 'hidden') el.classList.add('hidden');
    else if (type === 'active') el.classList.remove('active');
  });
  forcedVisibleCards = [];
}

if (btnOpenVisualEditor) btnOpenVisualEditor.addEventListener('click', () => { playSFX('open'); enterVisualEditor(); });
if (btnExitVisualEditor) btnExitVisualEditor.addEventListener('click', () => { playSFX('close'); exitVisualEditor(); });

if (btnResetVisualEditor) {
  btnResetVisualEditor.addEventListener('click', () => {
    if (!confirm('¿Restablecer toda la interfaz personalizada a los valores por defecto?')) return;
    customCardStyles = {};
    localStorage.removeItem('customCardStyles');
    Object.values(EDITABLE_CARDS).forEach(el => {
      if (!el) return;
      ['backgroundImage', 'backgroundColor', 'borderRadius', 'borderWidth', 'borderColor', 'borderStyle', 'boxShadow'].forEach(p => el.style[p] = '');
    });
    playSFX('click');
  });
}

Object.keys(EDITABLE_CARDS).forEach(key => {
  const el = EDITABLE_CARDS[key];
  if (!el) return;
  el.addEventListener('click', (e) => {
    if (!visualEditorActive) return;
    e.stopPropagation();
    editingCardKey = key;
    pendingCardBgImage = null;
    const existing = customCardStyles[key] || {};
    if (inputCardRadius) inputCardRadius.value = existing.radius !== undefined ? existing.radius : 20;
    if (inputCardBorderWidth) inputCardBorderWidth.value = existing.borderWidth !== undefined ? existing.borderWidth : 1;
    if (inputCardBorderColor) inputCardBorderColor.value = existing.borderColor || '#ffffff';
    if (inputCardShadow) inputCardShadow.value = existing.shadow !== undefined ? existing.shadow : 0;
    if (inputCardGlass) inputCardGlass.value = existing.glass !== undefined ? existing.glass : 0.9;
    document.querySelectorAll('.card-fit-btn').forEach(b => b.classList.toggle('active', b.dataset.fit === (existing.fit || 'cover')));
    if (cardEditorTitle) cardEditorTitle.textContent = 'Personalizar: ' + key;
    openModal(modalCardEditor);
  });
});

if (btnCloseCardEditor) btnCloseCardEditor.addEventListener('click', () => { playSFX('close'); closeModal(modalCardEditor); });
if (btnCardBgImage) btnCardBgImage.addEventListener('click', () => { if (inputCardBgImage) inputCardBgImage.click(); });
if (inputCardBgImage) {
  inputCardBgImage.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { pendingCardBgImage = ev.target.result; };
    reader.readAsDataURL(file);
  });
}
document.querySelectorAll('.card-fit-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.card-fit-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
  });
});

if (btnApplyCardStyle) {
  btnApplyCardStyle.addEventListener('click', () => {
    playSFX('click');
    if (!editingCardKey || !EDITABLE_CARDS[editingCardKey]) { closeModal(modalCardEditor); return; }
    const activeFitBtn = document.querySelector('.card-fit-btn.active');
    const style = {
      radius: inputCardRadius ? parseInt(inputCardRadius.value, 10) : 20,
      borderWidth: inputCardBorderWidth ? parseInt(inputCardBorderWidth.value, 10) : 1,
      borderColor: inputCardBorderColor ? inputCardBorderColor.value : '#ffffff',
      shadow: inputCardShadow ? parseInt(inputCardShadow.value, 10) : 0,
      glass: inputCardGlass ? parseFloat(inputCardGlass.value) : 0.9,
      fit: activeFitBtn ? activeFitBtn.dataset.fit : 'cover'
    };
    if (pendingCardBgImage) style.bgImage = pendingCardBgImage;
    else if (customCardStyles[editingCardKey] && customCardStyles[editingCardKey].bgImage) style.bgImage = customCardStyles[editingCardKey].bgImage;

    customCardStyles[editingCardKey] = style;
    try { localStorage.setItem('customCardStyles', JSON.stringify(customCardStyles)); }
    catch (err) { showToast('La imagen es muy grande para guardarse permanentemente. Prueba con una imagen más liviana.', 'error'); }
    applyCardStyle(EDITABLE_CARDS[editingCardKey], style);
    closeModal(modalCardEditor);
  });
}

// Dibuja SOLO el marco (fondo, borde y sombra) de la tarjeta en un canvas, sin su
// ícono ni texto, y lo descarga como PNG con transparencia real.
function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function downloadCardTemplate(key) {
  const el = EDITABLE_CARDS[key];
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const w = Math.max(Math.round(rect.width), 40);
  const h = Math.max(Math.round(rect.height), 40);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  const radius = inputCardRadius ? parseInt(inputCardRadius.value, 10) : 20;
  const borderWidth = inputCardBorderWidth ? parseInt(inputCardBorderWidth.value, 10) : 1;
  const borderColor = inputCardBorderColor ? inputCardBorderColor.value : '#ffffff';
  const shadow = inputCardShadow ? parseInt(inputCardShadow.value, 10) : 0;
  const glass = inputCardGlass ? parseFloat(inputCardGlass.value) : 0.9;
  const bgImageSrc = pendingCardBgImage || (customCardStyles[key] && customCardStyles[key].bgImage);

  function strokeBorder() {
    if (borderWidth > 0) {
      roundRectPath(ctx, borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth, radius);
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = borderColor;
      ctx.stroke();
    }
  }

  function triggerDownload() {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `plantilla-${key}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  if (bgImageSrc) {
    const img = new Image();
    img.onload = () => {
      roundRectPath(ctx, borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth, radius);
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
      strokeBorder();
      triggerDownload();
    };
    img.onerror = () => { strokeBorder(); triggerDownload(); };
    img.src = bgImageSrc;
  } else {
    if (shadow > 0) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = shadow;
      ctx.shadowOffsetY = 8;
    }
    roundRectPath(ctx, borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth, radius);
    ctx.fillStyle = `rgba(20,21,30,${glass})`;
    ctx.fill();
    if (shadow > 0) ctx.restore();
    strokeBorder();
    triggerDownload();
  }
}

const btnDownloadCardTemplate = document.getElementById('btn-download-card-template');
if (btnDownloadCardTemplate) {
  btnDownloadCardTemplate.addEventListener('click', () => {
    playSFX('click');
    if (editingCardKey) downloadCardTemplate(editingCardKey);
  });
}

if (btnClearCardStyle) {
  btnClearCardStyle.addEventListener('click', () => {
    playSFX('click');
    if (!editingCardKey) { closeModal(modalCardEditor); return; }
    delete customCardStyles[editingCardKey];
    localStorage.setItem('customCardStyles', JSON.stringify(customCardStyles));
    const el = EDITABLE_CARDS[editingCardKey];
    if (el) {
      ['backgroundImage', 'backgroundColor', 'borderRadius', 'borderWidth', 'borderColor', 'borderStyle', 'boxShadow'].forEach(p => el.style[p] = '');
    }
    closeModal(modalCardEditor);
  });
}

// ==========================================
// MODO CONCLUIDOR (cadena de canciones + mezcla en secuencia, con recorte por pista)
// ==========================================
function songKeyOf(song) {
  return song.id !== undefined ? ('id:' + song.id) : (song.title + '||' + song.artist);
}

let concludorChain = []; // [{ song, clipStart, clipDuration }]
let concludorPlaying = false;
let concludorPosition = 0;
let concludorPreviewAudio = null;

function findSongByKey(key) {
  if (key.startsWith('id:')) {
    const idVal = key.slice(3);
    return songList.find(s => String(s.id) === idVal);
  }
  const [t, a] = key.split('||');
  return songList.find(s => s.title === t && s.artist === a);
}

function loadConcludorChain() {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem('concludorChain') || '[]'); } catch (e) { stored = []; }
  concludorChain = stored.map(entry => {
    const song = findSongByKey(entry.key);
    if (!song) return null;
    const clipStart = entry.clipStart || 0;
    const clipEnd = entry.clipEnd !== undefined ? entry.clipEnd : clipStart + (entry.clipDuration || 20);
    return {
      song, clipStart, clipEnd, clipDuration: clipEnd - clipStart,
      fadeAt: entry.fadeAt !== undefined ? entry.fadeAt : clipEnd,
      fadeOutDuration: entry.fadeOutDuration !== undefined ? entry.fadeOutDuration : 2
    };
  }).filter(Boolean);
}
function saveConcludorChain() {
  localStorage.setItem('concludorChain', JSON.stringify(concludorChain.map(e => ({
    key: songKeyOf(e.song), clipStart: e.clipStart, clipEnd: e.clipEnd,
    fadeAt: e.fadeAt, fadeOutDuration: e.fadeOutDuration
  }))));
}

function renderConcludorCarousel() {
  const carousel = document.getElementById('concludor-carousel');
  const cable = document.getElementById('concludor-cable');
  if (!carousel) return;
  if (concludorChain.length === 0) {
    carousel.innerHTML = '<p class="empty-msg">Toca "Elegir Música" para armar tu cadena de canciones.</p>';
    if (cable) cable.style.display = 'none';
    return;
  }
  if (cable) cable.style.display = 'block';
  carousel.innerHTML = concludorChain.map((entry, i) => `
    <div class="concludor-card" data-idx="${i}">
      <button class="concludor-remove" data-idx="${i}" title="Quitar">✕</button>
      <img src="${entry.song.cover}" alt="Portada">
      <div class="concludor-card-title">${entry.song.title}</div>
      <div class="concludor-card-artist">${entry.song.artist}${entry.clipDuration ? ' · ' + entry.clipDuration + 's' : ''}</div>
      <div class="concludor-card-controls">
        <button class="concludor-move-up" data-idx="${i}" title="Mover antes" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="concludor-move-down" data-idx="${i}" title="Mover después" ${i === concludorChain.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="concludor-edit-clip" data-idx="${i}" title="Editar recorte y conexión"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
      </div>
    </div>
  `).join('');
  carousel.querySelectorAll('.concludor-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      concludorChain.splice(idx, 1);
      saveConcludorChain();
      renderConcludorCarousel();
    });
  });
  carousel.querySelectorAll('.concludor-move-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      if (idx > 0) {
        [concludorChain[idx - 1], concludorChain[idx]] = [concludorChain[idx], concludorChain[idx - 1]];
        saveConcludorChain();
        renderConcludorCarousel();
      }
    });
  });
  carousel.querySelectorAll('.concludor-move-down').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      if (idx < concludorChain.length - 1) {
        [concludorChain[idx + 1], concludorChain[idx]] = [concludorChain[idx], concludorChain[idx + 1]];
        saveConcludorChain();
        renderConcludorCarousel();
      }
    });
  });
  carousel.querySelectorAll('.concludor-edit-clip').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      const entry = concludorChain[idx];
      renderConcludorAddList();
      openModal(document.getElementById('modal-concludor-add'));
      openConcludorTrimView(entry.song, entry, idx);
    });
  });
}

function renderConcludorAddList(filterText) {
  const list = document.getElementById('concludor-add-list');
  const trimView = document.getElementById('concludor-trim-view');
  if (!list) return;
  list.classList.remove('hidden');
  if (trimView) trimView.classList.add('hidden');
  if (songList.length === 0) {
    list.innerHTML = '<li class="empty-msg">No tienes canciones cargadas todavía.</li>';
    return;
  }
  const term = (filterText || '').trim().toLowerCase();
  const visibleSongs = songList
    .map((song, i) => ({ song, i }))
    .filter(({ song }) => !term || song.title.toLowerCase().includes(term) || song.artist.toLowerCase().includes(term));

  if (visibleSongs.length === 0) {
    list.innerHTML = '<li class="empty-msg">Sin resultados para esa búsqueda.</li>';
    return;
  }
  list.innerHTML = visibleSongs.map(({ song, i }) => `<li class="playlist-item" data-idx="${i}" style="cursor:pointer;">
      <img src="${song.cover}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;">
      <div style="flex:1;overflow:hidden;">
        <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${song.title}</div>
        <div style="font-size:0.73rem;color:var(--text-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${song.artist}</div>
      </div>
      <button class="menu-opt-btn concludor-choose-one" data-idx="${i}" style="width:auto;padding:8px 14px;font-size:0.75rem;flex-shrink:0;">Elegir</button>
    </li>`).join('');
  list.querySelectorAll('.concludor-choose-one').forEach(btn => {
    btn.addEventListener('click', (e) => {
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      openConcludorTrimView(songList[idx]);
    });
  });
}

const concludorSearchInput = document.getElementById('concludor-search');
if (concludorSearchInput) {
  concludorSearchInput.addEventListener('input', (e) => renderConcludorAddList(e.target.value));
}

let trimTargetSong = null;
let trimEditingIndex = null; // si no es null, estamos EDITANDO esa entrada de la cadena, no agregando una nueva
let trimClipStart = 0;
let trimClipEnd = 20;
let trimFadeAt = 20; // segundo (relativo a 0, igual que start/end) donde se conecta con la siguiente canción
let trimDuration = 180;
let trimAudioBuffer = null;

function redrawTrimWaveform() {
  const canvas = document.getElementById('concludor-trim-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (trimAudioBuffer) {
    const data = trimAudioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / w);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    for (let x = 0; x < w; x++) {
      let min = 1.0, max = -1.0;
      const base = x * step;
      for (let j = 0; j < step; j += 4) {
        const idx = base + j;
        if (idx >= data.length) break;
        const v = data[idx];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = (1 + min) * h / 2;
      const y2 = (1 + max) * h / 2;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }

  const startX = (trimClipStart / trimDuration) * w;
  const endX = (trimClipEnd / trimDuration) * w;
  const fadeX = (trimFadeAt / trimDuration) * w;

  // Región seleccionada (el fragmento que se va a usar), resaltada en amarillo neón
  ctx.fillStyle = 'rgba(255, 229, 0, 0.22)';
  ctx.fillRect(startX, 0, endX - startX, h);
  ctx.fillStyle = '#FFE500';
  ctx.fillRect(startX - 1, 0, 3, h);
  ctx.fillRect(endX - 1, 0, 3, h);

  // Línea blanca: el segundo exacto de conexión con la siguiente canción
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 6;
  ctx.fillRect(fadeX - 1, 0, 3, h);
  ctx.shadowBlur = 0;
}

function updateTrimTimeLabels() {
  const startVal = document.getElementById('concludor-trim-start-value');
  const endVal = document.getElementById('concludor-trim-end-value');
  const fadeVal = document.getElementById('concludor-trim-fade-value');
  if (startVal) startVal.textContent = formatTime(trimClipStart);
  if (endVal) endVal.textContent = formatTime(trimClipEnd);
  if (fadeVal) fadeVal.textContent = formatTime(trimFadeAt);
}

// Arrastre: detecta cuál de los 3 controles (inicio, fin, conexión) está más cerca del punto tocado
let trimDragMode = null;
function pickTrimHandle(canvas, clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const startX = (trimClipStart / trimDuration) * rect.width;
  const endX = (trimClipEnd / trimDuration) * rect.width;
  const fadeX = (trimFadeAt / trimDuration) * rect.width;
  const distances = [
    { mode: 'fade', d: Math.abs(x - fadeX) },
    { mode: 'start', d: Math.abs(x - startX) },
    { mode: 'end', d: Math.abs(x - endX) }
  ].sort((a, b) => a.d - b.d);
  return distances[0].mode;
}
function dragTrimHandle(canvas, clientX) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const t = Math.round(ratio * trimDuration * 10) / 10;
  if (trimDragMode === 'start') {
    trimClipStart = Math.min(t, trimClipEnd - 1);
    if (trimFadeAt < trimClipStart) trimFadeAt = trimClipStart;
  } else if (trimDragMode === 'end') {
    trimClipEnd = Math.max(t, trimClipStart + 1);
    if (trimFadeAt > trimClipEnd) trimFadeAt = trimClipEnd;
  } else if (trimDragMode === 'fade') {
    trimFadeAt = Math.max(trimClipStart, Math.min(t, trimClipEnd));
  }
  updateTrimTimeLabels();
  redrawTrimWaveform();
}

function openConcludorTrimView(song, existingEntry, existingIndex) {
  trimTargetSong = song;
  trimEditingIndex = existingIndex !== undefined ? existingIndex : null;
  trimClipStart = existingEntry ? existingEntry.clipStart : 0;
  trimClipEnd = existingEntry ? existingEntry.clipEnd : 20;
  trimFadeAt = existingEntry && existingEntry.fadeAt !== undefined ? existingEntry.fadeAt : trimClipEnd;
  trimAudioBuffer = null;
  const list = document.getElementById('concludor-add-list');
  const trimView = document.getElementById('concludor-trim-view');
  const trimCover = document.getElementById('concludor-trim-cover');
  const trimTitle = document.getElementById('concludor-trim-title');
  const trimArtist = document.getElementById('concludor-trim-artist');
  const fadeoutInput = document.getElementById('concludor-trim-fadeout');
  const fadeoutVal = document.getElementById('concludor-trim-fadeout-value');
  const confirmBtn = document.getElementById('btn-concludor-confirm-add');
  if (!trimView) return;

  if (trimCover) trimCover.src = song.cover;
  if (trimTitle) trimTitle.textContent = song.title;
  if (trimArtist) trimArtist.textContent = song.artist;
  const fadeOutValue = existingEntry ? (existingEntry.fadeOutDuration || 2) : 2;
  if (fadeoutInput) fadeoutInput.value = fadeOutValue;
  if (fadeoutVal) fadeoutVal.textContent = fadeOutValue.toFixed(1) + 's';
  if (confirmBtn) confirmBtn.textContent = existingEntry ? 'Guardar Cambios' : 'Agregar a la Cadena';
  updateTrimTimeLabels();

  if (list) list.classList.add('hidden');
  trimView.classList.remove('hidden');

  // Decodificamos el audio real para dibujar su forma de onda de verdad (no es decorativo)
  initAudioContext();
  fetch(song.url)
    .then(res => res.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(audioBuffer => {
      trimAudioBuffer = audioBuffer;
      trimDuration = audioBuffer.duration || 180;
      if (!existingEntry) { trimClipEnd = Math.min(20, trimDuration); trimFadeAt = trimClipEnd; updateTrimTimeLabels(); }
      redrawTrimWaveform();
    })
    .catch(() => { trimDuration = 180; redrawTrimWaveform(); });
}

const concludorTrimFadeoutInput = document.getElementById('concludor-trim-fadeout');
if (concludorTrimFadeoutInput) {
  concludorTrimFadeoutInput.addEventListener('input', (e) => {
    const el = document.getElementById('concludor-trim-fadeout-value');
    if (el) el.textContent = parseFloat(e.target.value).toFixed(1) + 's';
  });
}

const concludorTrimCanvas = document.getElementById('concludor-trim-waveform');
if (concludorTrimCanvas) {
  concludorTrimCanvas.addEventListener('mousedown', (e) => { trimDragMode = pickTrimHandle(concludorTrimCanvas, e.clientX); dragTrimHandle(concludorTrimCanvas, e.clientX); });
  window.addEventListener('mousemove', (e) => { if (trimDragMode) dragTrimHandle(concludorTrimCanvas, e.clientX); });
  window.addEventListener('mouseup', () => { trimDragMode = null; });
  concludorTrimCanvas.addEventListener('touchstart', (e) => { trimDragMode = pickTrimHandle(concludorTrimCanvas, e.touches[0].clientX); dragTrimHandle(concludorTrimCanvas, e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (trimDragMode) dragTrimHandle(concludorTrimCanvas, e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend', () => { trimDragMode = null; });
}

const btnConcludorPreview = document.getElementById('btn-concludor-preview');
if (btnConcludorPreview) {
  btnConcludorPreview.addEventListener('click', () => {
    playSFX('click');
    if (!trimTargetSong) return;
    if (concludorPreviewAudio) { concludorPreviewAudio.pause(); concludorPreviewAudio = null; }
    concludorPreviewAudio = new Audio(trimTargetSong.url);
    const startAt = trimClipStart;
    const dur = Math.max(0.5, trimClipEnd - trimClipStart);
    const startPreview = () => {
      if (!concludorPreviewAudio) return;
      concludorPreviewAudio.currentTime = startAt;
      concludorPreviewAudio.play().catch(() => {});
      setTimeout(() => {
        if (concludorPreviewAudio) { concludorPreviewAudio.pause(); concludorPreviewAudio = null; }
      }, dur * 1000);
    };
    concludorPreviewAudio.addEventListener('loadedmetadata', startPreview, { once: true });
  });
}

const btnConcludorBackList = document.getElementById('btn-concludor-back-list');
if (btnConcludorBackList) {
  btnConcludorBackList.addEventListener('click', () => {
    playSFX('click');
    if (concludorPreviewAudio) { concludorPreviewAudio.pause(); concludorPreviewAudio = null; }
    if (concludorSearchInput) concludorSearchInput.value = '';
    renderConcludorAddList();
  });
}

const btnConcludorConfirmAdd = document.getElementById('btn-concludor-confirm-add');
if (btnConcludorConfirmAdd) {
  btnConcludorConfirmAdd.addEventListener('click', () => {
    playSFX('click');
    if (!trimTargetSong) return;
    if (concludorPreviewAudio) { concludorPreviewAudio.pause(); concludorPreviewAudio = null; }
    const fadeoutInput = document.getElementById('concludor-trim-fadeout');
    const entry = {
      song: trimTargetSong,
      clipStart: trimClipStart,
      clipEnd: trimClipEnd,
      clipDuration: trimClipEnd - trimClipStart,
      fadeAt: trimFadeAt,
      fadeOutDuration: fadeoutInput ? parseFloat(fadeoutInput.value) : 2
    };
    const wasEditing = trimEditingIndex !== null;
    if (trimEditingIndex !== null) concludorChain[trimEditingIndex] = entry;
    else concludorChain.push(entry);
    saveConcludorChain();
    renderConcludorCarousel();
    trimTargetSong = null;
    trimEditingIndex = null;
    closeModal(document.getElementById('modal-concludor-add'));
    showToast(wasEditing ? 'Cambios guardados.' : 'Canción agregada a la cadena.', 'info', 2500);
  });
}

// Dispara el crossfade real hacia la siguiente canción de la cadena, respetando el punto
// de conexión y el fundido configurados en el editor (antes esto se ignoraba por completo).
let concludorFadeTriggered = false;

function triggerConcludorCrossfade() {
  const nextIndex = concludorPosition + 1;
  if (nextIndex >= concludorChain.length) return;
  const nextEntry = concludorChain[nextIndex];
  const realIndex = songList.indexOf(nextEntry.song);
  if (realIndex < 0) { concludorPosition = nextIndex; triggerConcludorCrossfade(); return; }

  const currentEntry = concludorChain[concludorPosition];
  const fadeSeconds = Math.max(0.3, currentEntry.fadeOutDuration || 0.3);
  const nextAudio = (activeAudio === audio1) ? audio2 : audio1;
  const currentAudio = activeAudio;

  initAudioContext();
  nextAudio.src = nextEntry.song.url;
  nextAudio.volume = 0;

  // BUG arreglado: poner currentTime justo después de cambiar el src casi nunca funciona
  // (el navegador todavía no sabe la duración real) y por eso siempre sonaba desde el inicio.
  // Ahora esperamos a "loadedmetadata" antes de buscar el segundo exacto y recién ahí reproducir.
  const startCrossfadePlayback = () => {
    nextAudio.currentTime = nextEntry.clipStart || 0;
    const playPromise = nextAudio.play();
    if (playPromise === undefined) return;
    playPromise.then(() => {
      const tickMs = 60;
      const steps = Math.max(1, (fadeSeconds * 1000) / tickMs);
      const step = 1 / steps;
      const targetVol = volumeSlider ? parseFloat(volumeSlider.value) : 1;

      const fade = setInterval(() => {
        if (currentAudio.volume > step) currentAudio.volume -= step;
        else { currentAudio.volume = 0; currentAudio.pause(); }
        if (nextAudio.volume < targetVol - step) nextAudio.volume += step;
        else { nextAudio.volume = targetVol; clearInterval(fade); }
      }, tickMs);

      activeAudio = nextAudio;
      concludorPosition = nextIndex;
      concludorFadeTriggered = false;

      // Actualizamos toda la pantalla (sin volver a llamar loadSong, eso reiniciaría el
      // audio y cortaría el crossfade que recién empezamos)
      currentIndex = realIndex;
      const song = nextEntry.song;
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
      displayLyrics(song.lyrics);
      updateMediaSession(song);
      syncMiniPlayer(true);
      syncVehicleMode();
  syncMobileNowPlaying();
      renderPlaylist();
      renderConcludorCarousel();
    }).catch(err => console.error('Error en crossfade del Concluidor:', err));
  };

  if (nextAudio.readyState >= 1) startCrossfadePlayback();
  else nextAudio.addEventListener('loadedmetadata', startCrossfadePlayback, { once: true });
}

function playConcludorEntry(entry) {
  const realIndex = songList.indexOf(entry.song);
  if (realIndex < 0) { advanceConcludorChain(); return; }

  // Igual que en el crossfade: poner currentTime justo después de cambiar el src no funciona
  // de forma confiable (el navegador todavía no conoce la duración real), así que esperamos
  // a "loadedmetadata" antes de buscar el segundo exacto. Esto es lo que causaba que
  // siempre sonara desde el inicio en vez del fragmento elegido.
  initAudioContext();
  audio1.pause();
  audio2.pause();
  activeAudio = audio1;
  currentIndex = realIndex;
  activeAudio.src = entry.song.url;
  activeAudio.volume = volumeSlider ? parseFloat(volumeSlider.value) : 1;

  const startPlayback = () => {
    activeAudio.currentTime = entry.clipStart || 0;
    activeAudio.play().catch(err => console.error('Error al reproducir en Concluidor:', err));
  };
  if (activeAudio.readyState >= 1) startPlayback();
  else activeAudio.addEventListener('loadedmetadata', startPlayback, { once: true });

  const song = entry.song;
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
  displayLyrics(song.lyrics);
  updateMediaSession(song);
  syncMiniPlayer(true);
  syncVehicleMode();
  syncMobileNowPlaying();
  renderPlaylist();
  renderConcludorCarousel();

  concludorFadeTriggered = false;
}

function advanceConcludorChain() {
  concludorPosition++;
  if (concludorPosition < concludorChain.length) {
    playConcludorEntry(concludorChain[concludorPosition]);
  } else {
    concludorPlaying = false;
    const playBtn = document.getElementById('btn-concludor-play');
    if (playBtn) playBtn.textContent = '▶ REPRODUCIR MEZCLA COMPLETA';
    showToast('Mezcla completa terminada.', 'info');
  }
}

// Visualizador de frecuencias con audio real (no decorativo)
let concludorBars = [];
let concludorRafId = null;
function setupConcludorVisualizer() {
  const viz = document.getElementById('concludor-eq-viz');
  if (!viz || concludorBars.length > 0) return;
  viz.innerHTML = '';
  for (let i = 0; i < 32; i++) {
    const bar = document.createElement('div');
    bar.className = 'concludor-eq-bar';
    bar.style.animation = 'none';
    bar.style.height = '15%';
    viz.appendChild(bar);
    concludorBars.push(bar);
  }
}
function drawConcludorVisualizer() {
  const concludorModeEl = document.getElementById('concludor-mode');
  if (!concludorModeEl || !concludorModeEl.classList.contains('active')) { concludorRafId = null; return; }
  if (concludorAnalyser && concludorBars.length > 0) {
    const data = new Uint8Array(concludorAnalyser.frequencyBinCount);
    concludorAnalyser.getByteFrequencyData(data);
    const step = Math.max(1, Math.floor(data.length / concludorBars.length));
    concludorBars.forEach((bar, i) => {
      const val = data[i * step] || 0;
      bar.style.height = Math.max(6, (val / 255) * 60) + 'px';
    });
  }
  concludorRafId = requestAnimationFrame(drawConcludorVisualizer);
}

const btnConcludorMode = document.getElementById('btn-concludor-mode');
const concludorMode = document.getElementById('concludor-mode');
const btnConcludorFinish = document.getElementById('btn-concludor-finish');
const btnConcludorClose = document.getElementById('btn-concludor-close');
const btnConcludorAdd = document.getElementById('btn-concludor-add');
const modalConcludorAdd = document.getElementById('modal-concludor-add');
const btnCloseConcludorAdd = document.getElementById('btn-close-concludor-add');
const btnConcludorPlay = document.getElementById('btn-concludor-play');
const btnConcludorVoice = document.getElementById('btn-concludor-voice');
const btnConcludorMusic = document.getElementById('btn-concludor-music');

if (btnConcludorMode) {
  btnConcludorMode.addEventListener('click', () => {
    playSFX('open');
    loadConcludorChain();
    renderConcludorCarousel();
    setupConcludorVisualizer();
    if (concludorMode) concludorMode.classList.add('active');
    if (!concludorRafId) drawConcludorVisualizer();
  });
}
if (btnConcludorFinish) {
  btnConcludorFinish.addEventListener('click', () => {
    playSFX('close');
    saveConcludorChain();
    if (concludorMode) concludorMode.classList.remove('active');
  });
}
if (btnConcludorClose) {
  btnConcludorClose.addEventListener('click', () => {
    playSFX('close');
    if (concludorMode) concludorMode.classList.remove('active');
  });
}
if (btnConcludorAdd) {
  btnConcludorAdd.addEventListener('click', () => {
    playSFX('click');
    if (concludorSearchInput) concludorSearchInput.value = '';
    renderConcludorAddList();
    openModal(modalConcludorAdd);
  });
}
if (btnCloseConcludorAdd) {
  btnCloseConcludorAdd.addEventListener('click', () => {
    playSFX('close');
    if (concludorPreviewAudio) { concludorPreviewAudio.pause(); concludorPreviewAudio = null; }
    closeModal(modalConcludorAdd);
  });
}

if (btnConcludorPlay) {
  btnConcludorPlay.addEventListener('click', () => {
    playSFX('click');
    if (concludorPlaying) {
      // Ya está sonando la mezcla: este toque solo pausa/reanuda, no reinicia desde el principio
      if (activeAudio.paused) {
        activeAudio.play().catch(() => {});
        btnConcludorPlay.textContent = '⏸ PAUSAR MEZCLA';
      } else {
        activeAudio.pause();
        btnConcludorPlay.textContent = '▶ CONTINUAR MEZCLA';
      }
      return;
    }
    if (concludorChain.length === 0) { showToast('Agrega al menos una canción a la cadena primero.', 'error'); return; }
    concludorPlaying = true;
    concludorPosition = 0;
    playConcludorEntry(concludorChain[0]);
    btnConcludorPlay.textContent = '⏸ PAUSAR MEZCLA';
  });
}

// "Voz" / "Música" reutilizan el mismo motor de Separación de Voz/Música ya construido
if (btnConcludorVoice) {
  btnConcludorVoice.addEventListener('click', () => {
    playSFX('click');
    initAudioContext();
    btnConcludorVoice.classList.add('active');
    btnConcludorMusic.classList.remove('active');
    if (toggleVmEnabled) toggleVmEnabled.checked = true;
    if (midGain) midGain.gain.value = 1.6;
    if (sideGain) sideGain.gain.value = 0.5;
  });
}
if (btnConcludorMusic) {
  btnConcludorMusic.addEventListener('click', () => {
    playSFX('click');
    initAudioContext();
    btnConcludorMusic.classList.add('active');
    btnConcludorVoice.classList.remove('active');
    if (toggleVmEnabled) toggleVmEnabled.checked = true;
    if (midGain) midGain.gain.value = 0.5;
    if (sideGain) sideGain.gain.value = 1.6;
  });
}

// Dispara la transición en el punto de conexión exacto que se eligió en el editor,
// con el fundido configurado (antes esto se ignoraba y cortaba de golpe siempre).
setInterval(() => {
  if (!concludorPlaying) return;
  const entry = concludorChain[concludorPosition];
  if (!entry) return;
  const fadeAt = entry.fadeAt !== undefined ? entry.fadeAt : entry.clipEnd;
  const fadeOutDuration = entry.fadeOutDuration || 0;
  const triggerPoint = Math.max(entry.clipStart || 0, fadeAt - fadeOutDuration);

  if (!concludorFadeTriggered && activeAudio.currentTime >= triggerPoint) {
    concludorFadeTriggered = true;
    if (concludorPosition + 1 < concludorChain.length) {
      triggerConcludorCrossfade();
    }
  }
  if (concludorPosition === concludorChain.length - 1 && activeAudio.currentTime >= fadeAt) {
    concludorPlaying = false;
    const playBtn = document.getElementById('btn-concludor-play');
    if (playBtn) playBtn.textContent = '▶ REPRODUCIR MEZCLA COMPLETA';
    showToast('Mezcla completa terminada.', 'info');
  }
}, 300);

// ==========================================
// BUSCADOR DE BIBLIOTECA
// ==========================================
const librarySearchInput = document.getElementById('library-search');
if (librarySearchInput) {
  librarySearchInput.addEventListener('input', (e) => {
    const term = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#playlist > li').forEach(item => {
      const match = !term || item.textContent.toLowerCase().includes(term);
      item.style.display = match ? '' : 'none';
    });
  });
}

// ==========================================
// MODO INTERFAZ CELULAR (diseño tipo app de celular, con barra inferior)
// ==========================================
const toggleMobileLayout = document.getElementById('toggle-mobile-layout');
const mobileNowplayingBar = document.getElementById('mobile-nowplaying-bar');
const mobileTabBar = document.getElementById('mobile-tab-bar');

let mobileLayoutRafId = 0;

function scheduleMobileLayoutFrame(callback) {
  if (mobileLayoutRafId) return;
  mobileLayoutRafId = window.requestAnimationFrame(() => {
    mobileLayoutRafId = 0;
    callback();
  });
}

function cancelMobileLayoutFrame() {
  if (!mobileLayoutRafId) return;
  window.cancelAnimationFrame(mobileLayoutRafId);
  mobileLayoutRafId = 0;
}

function restoreDesktopPointerEvents() {
  const restoreTargets = [
    document.body,
    document.documentElement,
    document.getElementById('app-layout'),
    document.getElementById('control-notification-bar'),
    document.querySelector('.top-global-bar'),
    document.querySelector('.top-left-global-bar'),
    document.getElementById('player-card')
  ];

  restoreTargets.forEach(el => {
    if (!el) return;
    el.style.pointerEvents = 'auto';
  });

  const hiddenMobileOverlays = [
    document.getElementById('mobile-quick-menu'),
    document.getElementById('top-experiences-menu')
  ];

  hiddenMobileOverlays.forEach(el => {
    if (!el) return;
    el.style.pointerEvents = 'none';
  });
}

function applyMobileLayoutState(enabled) {
  const body = document.body;
  const root = document.documentElement;
  const wasMobile = body.classList.contains('mobile-layout') ||
    body.classList.contains('mobile-mode') ||
    body.classList.contains('mobile-layout-active') ||
    body.classList.contains('mobile-mode-active');

  if (enabled) {
    if (!wasMobile) {
      const currentScroll = window.scrollY || root.scrollTop || 0;
      body.dataset.mobileScrollY = String(currentScroll);
    }

    body.classList.add(
      'mobile-layout',
      'mobile-mode',
      'mobile-layout-active',
      'mobile-mode-active'
    );
    root.classList.add('mobile-layout-enabled');

    const currentScroll = Number(body.dataset.mobileScrollY || 0);

    scheduleMobileLayoutFrame(() => {
      body.style.top = `-${Math.max(0, currentScroll)}px`;
      body.style.pointerEvents = 'auto';
    });
    return;
  }

  const previousScroll = Number(body.dataset.mobileScrollY || 0);

  // Al salir, cancelar cualquier frame pendiente del estado anterior.
  // Así nunca se ejecuta después del cleanup un callback que vuelva a escribir
  // estilos móviles sobre la interfaz de escritorio.
  cancelMobileLayoutFrame();

  body.classList.remove(
    'mobile-layout',
    'mobile-mode',
    'mobile-layout-active',
    'mobile-mode-active',
    'mobile-player-expanded',
    'mobile-modal-lock',
    'mobile-ui-hidden',
    'mobile-player-layer-open'
  );

  root.classList.remove('mobile-layout-enabled');
  body.style.removeProperty('top');
  body.style.removeProperty('pointer-events');
  root.style.removeProperty('pointer-events');

  const player = document.getElementById('player-card');
  if (player) player.classList.remove('mobile-expanded');

  const topMenu = document.getElementById('top-experiences-menu');
  const secondaryButton = document.getElementById('btn-mobile-secondary-menu');
  const quickMenu = document.getElementById('mobile-quick-menu');
  const mobileBar = document.getElementById('mobile-nowplaying-bar');
  const mobileTabBar = document.getElementById('mobile-tab-bar');

  if (topMenu) {
    topMenu.classList.add('hidden');
    topMenu.style.pointerEvents = 'none';
    topMenu.setAttribute('aria-hidden', 'true');
  }
  if (secondaryButton) secondaryButton.setAttribute('aria-expanded', 'false');
  if (quickMenu) {
    quickMenu.classList.remove('active');
    quickMenu.style.pointerEvents = 'none';
    quickMenu.setAttribute('aria-hidden', 'true');
  }
  if (mobileBar) mobileBar.removeAttribute('aria-hidden');
  if (mobileTabBar) mobileTabBar.removeAttribute('aria-hidden');

  restoreDesktopPointerEvents();

  /* Un solo reajuste del layout después de retirar las clases móviles. */
  scheduleMobileLayoutFrame(() => {
    window.scrollTo(0, Math.max(0, previousScroll));
  });
}

if (toggleMobileLayout) {
  const savedMobileLayout = localStorage.getItem('mobileLayoutEnabled') === 'true';
  toggleMobileLayout.checked = savedMobileLayout;
  applyMobileLayoutState(savedMobileLayout);

  toggleMobileLayout.addEventListener('change', event => {
    const enabled = !!event.target.checked;
    playSFX('click');
    localStorage.setItem('mobileLayoutEnabled', enabled ? 'true' : 'false');
    applyMobileLayoutState(enabled);
  });
}

function syncMobileNowPlaying() {
  const mnpCover = document.getElementById('mobile-np-cover');
  const mnpTitle = document.getElementById('mobile-np-title');
  const mnpArtist = document.getElementById('mobile-np-artist');
  const mnpPlayIcon = document.getElementById('mobile-np-play-icon');
  if (mnpCover && cover) mnpCover.src = cover.src;
  if (mnpTitle && title) mnpTitle.textContent = title.textContent;
  if (mnpArtist && artist) mnpArtist.textContent = artist.textContent;
  if (mnpPlayIcon && playIcon) mnpPlayIcon.innerHTML = playIcon.innerHTML;
}

if (mobileNowplayingBar) {
  mobileNowplayingBar.addEventListener('click', (e) => {
    if (e.target.closest('#mobile-np-play')) return; // el botón de play/pausa se maneja aparte
    playSFX('click');
    if (playerCard) playerCard.classList.toggle('mobile-expanded');
    document.body.classList.toggle('mobile-player-expanded');
  });
}
const mobileNpPlayBtn = document.getElementById('mobile-np-play');
if (mobileNpPlayBtn) mobileNpPlayBtn.addEventListener('click', (e) => { e.stopPropagation(); if (playBtn) playBtn.click(); });

const mobileSecondaryMenu = document.getElementById('btn-mobile-secondary-menu');
if (mobileSecondaryMenu) {
  mobileSecondaryMenu.addEventListener('click', () => {
    playSFX('open');
    const settingsOpen = modalSettings && modalSettings.classList.contains('active');
    if (settingsOpen) {
      closeModalSettings();
      mobileSecondaryMenu.setAttribute('aria-expanded', 'false');
    } else if (btnMainMenu) {
      btnMainMenu.click();
      mobileSecondaryMenu.setAttribute('aria-expanded', 'true');
    }
  });
}

if (mobileTabBar) {
  mobileTabBar.querySelectorAll('.mobile-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSFX('click');
      mobileTabBar.querySelectorAll('.mobile-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (playerCard) playerCard.classList.remove('mobile-expanded');
      document.body.classList.remove('mobile-player-expanded');
      if (tab === 'ajustes') {
        if (btnMainMenu) btnMainMenu.click();
      } else if (tab === 'buscar') {
        if (librarySearchInput) setTimeout(() => librarySearchInput.focus(), 100);
      }
    });
  });
}


// =========================================================
// MENÚ SUPERIOR — MODOS Y EXPERIENCIAS
// =========================================================
(() => {
  'use strict';

  const trigger = document.getElementById('btn-top-experiences');
  const menu = document.getElementById('top-experiences-menu');
  const stageItem = document.getElementById('top-mode-stage');
  const rhythmItem = document.getElementById('top-mode-rhythm');
  const jkItem = document.getElementById('top-mode-jk');

  if (!trigger || !menu) return;

  const isOpen = () => !menu.classList.contains('hidden');

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const positionMenu = () => {
    if (!isOpen()) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(340, Math.max(280, menu.offsetWidth || 320));
    const menuHeight = menu.offsetHeight || 210;
    const gap = 8;
    const viewportPadding = 10;

    let left = rect.right - menuWidth;
    let top = rect.bottom + gap;

    left = clamp(left, viewportPadding, window.innerWidth - menuWidth - viewportPadding);

    if (top + menuHeight > window.innerHeight - viewportPadding) {
      top = rect.top - menuHeight - gap;
    }

    top = clamp(top, viewportPadding, Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };

  const openMenu = () => {
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    positionMenu();
  };

  const closeMenu = () => {
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  };

  const toggleMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      if (typeof playSFX === 'function') playSFX('click');
    } catch (_) {}

    if (isOpen()) closeMenu();
    else openMenu();
  };

  trigger.addEventListener('click', toggleMenu);

  document.addEventListener('click', event => {
    if (!isOpen()) return;
    if (menu.contains(event.target) || trigger.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      closeMenu();
      trigger.focus();
    }
  });

  window.addEventListener('resize', positionMenu, { passive: true });
  window.addEventListener('scroll', positionMenu, { passive: true });

  if (stageItem) {
    stageItem.addEventListener('click', () => {
      closeMenu();
      try {
        if (typeof playSFX === 'function') playSFX('click');
      } catch (_) {}

      const manager = window.StageManager;
      if (manager && typeof manager.show === 'function') {
        manager.show();
      } else {
        console.warn('[Glasstrack] StageManager no está disponible todavía.');
      }
    });
  }

  if (rhythmItem) {
    rhythmItem.addEventListener('click', () => {
      closeMenu();
      try {
        if (typeof playSFX === 'function') playSFX('click');
      } catch (_) {}

      const rhythm = window.glasstrackRhythm;
      if (!rhythm || typeof rhythm.open !== 'function') {
        console.warn('[Glasstrack] Modo Ritmo no está disponible todavía.');
        return;
      }

      // El acceso ya no depende del panel de Ajustes Generales.
      // Se reactiva automáticamente para que el nuevo menú sea el punto de entrada único.
      if (typeof rhythm.enableAndOpen === 'function') {
        rhythm.enableAndOpen('game');
      } else {
        rhythm.open('game');
      }
    });
  }

  // Modo JK permanece visible en el menú, pero bloqueado hasta que exista su módulo.
  if (jkItem) {
    jkItem.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
})();

// Botón X para cerrar el reproductor expandido en celular
const btnCloseMobilePlayer = document.getElementById('btn-close-mobile-player');
if (btnCloseMobilePlayer) {
  btnCloseMobilePlayer.addEventListener('click', () => {
    playSFX('close');
    if (playerCard) playerCard.classList.remove('mobile-expanded');
    document.body.classList.remove('mobile-player-expanded');
  });
}

// ==========================================
// AUTO-PAUSA AL CAMBIAR DE PESTAÑA Y RECORDAR POSICIÓN EXACTA
// ==========================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden && toggleAutopauseTab && toggleAutopauseTab.checked) {
    if (playerCard && playerCard.classList.contains('playing') && pauseBtn) pauseBtn.click();
  }
});

// Guarda el segundo exacto de la canción actual cada pocos segundos
setInterval(() => {
  if (!toggleResumePosition || !toggleResumePosition.checked) return;
  const song = songList[currentIndex];
  if (!song || !activeAudio || isNaN(activeAudio.currentTime)) return;
  localStorage.setItem('resumePlayback', JSON.stringify({
    key: songKeyOf(song), time: activeAudio.currentTime
  }));
}, 4000);

// Al cargar la app, si hay una posición guardada de la última canción, la retoma
function tryResumeLastPosition() {
  if (!toggleResumePosition || !toggleResumePosition.checked) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('resumePlayback') || 'null'); } catch (e) { saved = null; }
  if (!saved || !saved.key) return;
  const song = findSongByKey(saved.key);
  if (!song) return;
  const realIndex = songList.indexOf(song);
  if (realIndex < 0) return;
  loadSong(realIndex, false);
  const seekOnce = () => { activeAudio.currentTime = saved.time || 0; activeAudio.removeEventListener('canplay', seekOnce); };
  if (activeAudio.readyState >= 2) activeAudio.currentTime = saved.time || 0;
  else activeAudio.addEventListener('canplay', seekOnce);
}
setTimeout(tryResumeLastPosition, 800);

// ==========================================
// VISUALIZADOR DE AUDIO EN EL REPRODUCTOR PRINCIPAL (reutiliza el analizador real ya existente)
// ==========================================
const toggleAudioVisualizer = document.getElementById('toggle-audio-visualizer');
const playerVisualizerCanvas = document.getElementById('player-visualizer');
let playerVizRafId = null;

function drawPlayerVisualizer() {
  if (!toggleAudioVisualizer || !toggleAudioVisualizer.checked || !playerVisualizerCanvas) { playerVizRafId = null; return; }
  const ctx = playerVisualizerCanvas.getContext('2d');
  const w = playerVisualizerCanvas.width = playerVisualizerCanvas.clientWidth;
  const h = playerVisualizerCanvas.height = playerVisualizerCanvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (concludorAnalyser) {
    const data = new Uint8Array(concludorAnalyser.frequencyBinCount);
    concludorAnalyser.getByteFrequencyData(data);
    const barCount = 40;
    const step = Math.max(1, Math.floor(data.length / barCount));
    const barWidth = w / barCount;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-color') || '#fff';
    for (let i = 0; i < barCount; i++) {
      const val = data[i * step] || 0;
      const barHeight = Math.max(2, (val / 255) * h);
      ctx.fillRect(i * barWidth + 1, h - barHeight, barWidth - 2, barHeight);
    }
  }
  playerVizRafId = requestAnimationFrame(drawPlayerVisualizer);
}

if (toggleAudioVisualizer) {
  toggleAudioVisualizer.addEventListener('change', (e) => {
    playSFX('click');
    initAudioContext();
    if (playerVisualizerCanvas) playerVisualizerCanvas.classList.toggle('hidden', !e.target.checked);
    if (e.target.checked && !playerVizRafId) drawPlayerVisualizer();
  });
}

// ==========================================
// MODO ESTUDIO DE LETRAS (importar .lrc/.txt, tap-sync, ajuste fino, exportar .lrc)
// ==========================================
let studioLines = []; // [{ time: segundos|null, text: "", instrumental: bool }]
let studioTapIndex = 0;

function parseLrcText(text) {
  const lines = text.split('\n');
  const result = [];
  const timeTag = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
  lines.forEach(rawLine => {
    const matches = [...rawLine.matchAll(timeTag)];
    const cleanText = rawLine.replace(timeTag, '').trim();
    if (matches.length > 0) {
      matches.forEach(m => {
        const mins = parseInt(m[1], 10);
        const secs = parseInt(m[2], 10);
        const frac = parseInt(m[3].padEnd(3, '0'), 10) / 1000;
        result.push({ time: mins * 60 + secs + frac, text: cleanText, instrumental: false });
      });
    } else if (cleanText) {
      result.push({ time: null, text: cleanText, instrumental: false });
    }
  });
  return result;
}
function parseTxtText(text) {
  return text.split('\n').filter(l => l.trim() !== '').map(l => ({ time: null, text: l.trim(), instrumental: false }));
}
function formatLrcTime(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2) + '.' + ('0' + ms).slice(-2);
}

function renderStudioList() {
  const list = document.getElementById('studio-line-list');
  if (!list) return;
  if (studioLines.length === 0) {
    list.innerHTML = '<li class="empty-msg">Importa un archivo o edita la letra normal primero.</li>';
    return;
  }
  list.innerHTML = studioLines.map((line, i) => `
    <li class="studio-line-row${line.instrumental ? ' studio-instrumental' : ''}" data-idx="${i}">
      <span class="studio-line-time">${formatLrcTime(line.time)}</span>
      <input class="studio-line-text" data-idx="${i}" value="${line.text.replace(/"/g, '&quot;')}">
      <button class="studio-nudge-btn" data-idx="${i}" data-nudge="-500">-.5</button>
      <button class="studio-nudge-btn" data-idx="${i}" data-nudge="-100">-.1</button>
      <button class="studio-nudge-btn" data-idx="${i}" data-nudge="100">+.1</button>
      <button class="studio-nudge-btn" data-idx="${i}" data-nudge="500">+.5</button>
      <button class="studio-nudge-btn studio-instrumental-toggle" data-idx="${i}" title="Marcar como instrumental">🎵</button>
      <button class="studio-nudge-btn studio-delete-line" data-idx="${i}" title="Eliminar esta línea">✕</button>
    </li>`).join('');

  list.querySelectorAll('.studio-line-text').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (studioLines[idx]) { studioLines[idx].text = e.target.value; saveStudioLyrics(); }
    });
  });
  list.querySelectorAll('.studio-nudge-btn[data-nudge]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      const delta = parseInt(e.currentTarget.dataset.nudge, 10) / 1000;
      if (studioLines[idx] && studioLines[idx].time !== null) {
        studioLines[idx].time = Math.max(0, studioLines[idx].time + delta);
        renderStudioList();
        saveStudioLyrics();
      }
    });
  });
  list.querySelectorAll('.studio-instrumental-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      if (studioLines[idx]) {
        studioLines[idx].instrumental = !studioLines[idx].instrumental;
        renderStudioList();
        saveStudioLyrics();
      }
    });
  });
  list.querySelectorAll('.studio-delete-line').forEach(btn => {
    btn.addEventListener('click', (e) => {
      playSFX('click');
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      studioLines.splice(idx, 1);
      if (studioTapIndex > idx) studioTapIndex--;
      renderStudioList();
      saveStudioLyrics();
    });
  });
}

// Agregar una línea nueva vacía al final, para letras que quedaron incompletas
const btnStudioAddLine = document.getElementById('btn-studio-add-line');
if (btnStudioAddLine) {
  btnStudioAddLine.addEventListener('click', () => {
    playSFX('click');
    studioLines.push({ time: null, text: '', instrumental: false });
    renderStudioList();
    saveStudioLyrics();
    const rows = document.querySelectorAll('.studio-line-row');
    if (rows.length > 0) rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// Elimina todos los tiempos marcados (conserva el texto) para volver a calibrar desde cero
const btnStudioResetAll = document.getElementById('btn-studio-reset-all');
if (btnStudioResetAll) {
  btnStudioResetAll.addEventListener('click', () => {
    playSFX('click');
    if (!confirm('¿Seguro que vas a borrar todos los tiempos marcados? El texto de las líneas se conserva.')) return;
    studioLines.forEach(l => { l.time = null; });
    studioTapIndex = 0;
    const song = songList[currentIndex];
    if (song) song.karaokeWords = {};
    renderStudioList();
    saveStudioLyrics();
    showToast('Se borraron todos los tiempos. Puedes volver a calibrar desde cero.', 'info');
  });
}

function saveStudioLyrics() {
  if (songList.length === 0) return;
  const song = songList[currentIndex];
  // Guardamos TODAS las líneas (con time:null si aún no se marcaron), para que la posición
  // de cada una siga coincidiendo con su línea real en el texto de la letra.
  song.lrcLines = studioLines.map(l => ({ time: l.time, text: l.text, instrumental: l.instrumental }));
  song.lyrics = studioLines.map(l => l.text).join('\n');
  updateSongInDB(song);
  displayLyrics(song.lyrics);
}

const btnLyricsStudio = document.getElementById('btn-lyrics-studio');
const lyricsStudioEl = document.getElementById('lyrics-studio');
const btnCloseStudio = document.getElementById('btn-close-studio');
const studioDropzone = document.getElementById('studio-dropzone');
const inputStudioFile = document.getElementById('input-studio-file');
const btnStudioBrowse = document.getElementById('btn-studio-browse');
const btnTapSync = document.getElementById('btn-tap-sync');
const btnStudioPlayPause = document.getElementById('btn-studio-playpause');
const btnStudioExport = document.getElementById('btn-studio-export');
const btnStudioHelp = document.getElementById('btn-studio-help');
const modalStudioHelp = document.getElementById('modal-studio-help');
const btnCloseStudioHelp = document.getElementById('btn-close-studio-help');
if (btnStudioHelp) btnStudioHelp.addEventListener('click', () => { playSFX('open'); openModal(modalStudioHelp); });
if (btnCloseStudioHelp) btnCloseStudioHelp.addEventListener('click', () => { playSFX('close'); closeModal(modalStudioHelp); });
const btnStudioDistribute = document.getElementById('btn-studio-distribute');
const studioProgressContainer = document.getElementById('studio-progress-container');
const studioProgress = document.getElementById('studio-progress');

if (btnLyricsStudio) {
  btnLyricsStudio.addEventListener('click', () => {
    playSFX('open');
    if (songList.length === 0) { showToast('Carga una canción primero.', 'error'); return; }
    const song = songList[currentIndex];
    const studioCover = document.getElementById('studio-cover');
    const studioTitle = document.getElementById('studio-title');
    const studioArtist = document.getElementById('studio-artist');
    if (studioCover) studioCover.src = song.cover;
    if (studioTitle) studioTitle.textContent = song.title;
    if (studioArtist) studioArtist.textContent = song.artist;

    if (song.lrcLines && song.lrcLines.length > 0) {
      studioLines = song.lrcLines.map(l => ({ ...l }));
    } else if (song.lyrics) {
      studioLines = parseTxtText(song.lyrics);
    } else {
      studioLines = [];
    }
    studioTapIndex = 0;
    renderStudioList();
    document.querySelectorAll('.studio-speed-btn').forEach(b => b.classList.toggle('active', b.dataset.speed === '1'));
    // Siempre arranca en la pestaña de Letras Normales, aunque la última vez hayas usado Karaoke
    if (studioTabLines) studioTabLines.click();
    karaokeRenderedLineIndex = null;
    if (lyricsStudioEl) lyricsStudioEl.classList.add('active');
  });
}
if (btnCloseStudio) {
  btnCloseStudio.addEventListener('click', () => {
    playSFX('close');
    if (lyricsStudioEl) lyricsStudioEl.classList.remove('active');
    applyAudioEngineSettings(); // restablece la velocidad real (la del Estudio era solo temporal)
  });
}

// Arrastrar y soltar / buscar archivo .txt o .lrc
function handleStudioFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const isLrc = file.name.toLowerCase().endsWith('.lrc') || /\[\d{2}:\d{2}/.test(text);
    studioLines = isLrc ? parseLrcText(text) : parseTxtText(text);
    studioTapIndex = studioLines.findIndex(l => l.time === null);
    if (studioTapIndex === -1) studioTapIndex = studioLines.length;
    renderStudioList();
    saveStudioLyrics();
    showToast(isLrc ? 'Archivo .lrc importado con sus tiempos.' : 'Archivo .txt importado. Usa Tap Sync para ponerle tiempos.', 'info');
  };
  reader.readAsText(file);
}
if (studioDropzone) {
  studioDropzone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); studioDropzone.classList.add('drag-over'); });
  studioDropzone.addEventListener('dragleave', (e) => { e.stopPropagation(); studioDropzone.classList.remove('drag-over'); });
  studioDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    studioDropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleStudioFile(e.dataTransfer.files[0]);
  });
}
if (btnStudioBrowse) btnStudioBrowse.addEventListener('click', () => { if (inputStudioFile) inputStudioFile.click(); });
if (inputStudioFile) inputStudioFile.addEventListener('change', (e) => handleStudioFile(e.target.files[0]));

// Tap-Sync: marca el segundo exacto en la línea actual y pasa a la siguiente
let studioTabMode = 'lines'; // 'lines' | 'karaoke'

function doTapSync() {
  if (studioTabMode === 'karaoke') { showToast('Tap-Sync está desactivado en la pestaña de Calibración Karaoke.', 'error'); return; }
  if (studioLines.length === 0) return;
  if (studioTapIndex >= studioLines.length) { showToast('Ya marcaste todas las líneas.', 'info', 2000); return; }
  studioLines[studioTapIndex].time = activeAudio.currentTime || 0;
  studioTapIndex++;
  renderStudioList();
  saveStudioLyrics();
  const rows = document.querySelectorAll('.studio-line-row');
  if (rows[studioTapIndex]) rows[studioTapIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
if (btnTapSync) btnTapSync.addEventListener('click', () => { playSFX('click'); doTapSync(); });
document.addEventListener('keydown', (e) => {
  if (lyricsStudioEl && lyricsStudioEl.classList.contains('active') && e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    doTapSync();
  }
});

if (btnStudioPlayPause) btnStudioPlayPause.addEventListener('click', () => { if (playBtn) playBtn.click(); });

const btnStudioBack5 = document.getElementById('btn-studio-back5');
const btnStudioFwd5 = document.getElementById('btn-studio-fwd5');
if (btnStudioBack5) {
  btnStudioBack5.addEventListener('click', () => {
    playSFX('click');
    activeAudio.currentTime = Math.max(0, activeAudio.currentTime - 5);
  });
}
if (btnStudioFwd5) {
  btnStudioFwd5.addEventListener('click', () => {
    playSFX('click');
    activeAudio.currentTime = Math.min(activeAudio.duration || Infinity, activeAudio.currentTime + 5);
  });
}

// Velocidad de escucha lenta SOLO dentro del Estudio (no toca tu velocidad normal guardada
// en Ajustes); al cerrar el Estudio, vuelve a la velocidad real de forma automática.
document.querySelectorAll('.studio-speed-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    document.querySelectorAll('.studio-speed-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    const rate = parseFloat(e.currentTarget.dataset.speed);
    [audio1, audio2].forEach(a => {
      a.playbackRate = rate;
      a.preservesPitch = false; a.mozPreservesPitch = false; a.webkitPreservesPitch = false;
    });
  });
});

makeSeekbarDraggable(studioProgressContainer, studioProgress, document.getElementById('studio-current-time'));

// Ajuste en lote: mueve TODAS las líneas ya marcadas la misma cantidad de tiempo
document.querySelectorAll('.studio-mini-btn[data-batch]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    playSFX('click');
    const delta = parseInt(e.currentTarget.dataset.batch, 10) / 1000;
    studioLines.forEach(l => { if (l.time !== null) l.time = Math.max(0, l.time + delta); });
    renderStudioList();
    saveStudioLyrics();
  });
});

// Distribución uniforme: reparte el tiempo entre la primera y la última línea ya marcadas
if (btnStudioDistribute) {
  btnStudioDistribute.addEventListener('click', () => {
    playSFX('click');
    const markedIdxs = studioLines.map((l, i) => l.time !== null ? i : -1).filter(i => i !== -1);
    if (markedIdxs.length < 2) { showToast('Marca al menos la primera y la última línea del tramo primero.', 'error'); return; }
    const first = markedIdxs[0];
    const last = markedIdxs[markedIdxs.length - 1];
    const startTime = studioLines[first].time;
    const endTime = studioLines[last].time;
    const span = last - first;
    if (span > 0) {
      for (let i = first; i <= last; i++) {
        studioLines[i].time = startTime + ((endTime - startTime) * (i - first)) / span;
      }
    }
    renderStudioList();
    saveStudioLyrics();
    showToast('Tiempos repartidos entre las líneas marcadas.', 'info');
  });
}

// Exportar como .lrc (copia y descarga)
if (btnStudioExport) {
  btnStudioExport.addEventListener('click', () => {
    playSFX('click');
    const timed = studioLines.filter(l => l.time !== null).sort((a, b) => a.time - b.time);
    if (timed.length === 0) { showToast('Todavía no hay líneas con tiempo marcado.', 'error'); return; }
    const lrcText = timed.map(l => `[${formatLrcTime(l.time)}]${l.instrumental ? '[Instrumental] ' : ''}${l.text}`).join('\n');
    const song = songList[currentIndex];
    const blob = new Blob([lrcText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(song ? song.title : 'letra')}.lrc`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    if (navigator.clipboard) navigator.clipboard.writeText(lrcText).catch(() => {});
    showToast('Archivo .lrc descargado (y copiado al portapapeles).', 'info');
  });
}

// Sincroniza la vista previa del estudio en vivo con la reproducción real
function getActiveStudioLineIndex(currentTime) {
  const timed = studioLines.map((l, i) => ({ ...l, i })).filter(l => l.time !== null);
  if (timed.length === 0) return -1;
  let active = -1;
  for (const l of timed) {
    if (l.time <= currentTime) active = l.i;
    else break;
  }
  return active;
}
setInterval(() => {
  if (!lyricsStudioEl || !lyricsStudioEl.classList.contains('active')) return;
  const duration = activeAudio.duration || 0;
  const currentTime = activeAudio.currentTime || 0;
  if (studioProgress && duration) studioProgress.style.width = (currentTime / duration * 100) + '%';
  const curEl = document.getElementById('studio-current-time');
  const durEl = document.getElementById('studio-duration');
  if (curEl) curEl.textContent = formatTime(currentTime);
  if (durEl) durEl.textContent = formatTime(duration);

  const activeIdx = getActiveStudioLineIndex(currentTime);
  const previewLine = document.getElementById('studio-preview-line');
  if (previewLine) {
    if (activeIdx > -1 && studioLines[activeIdx]) {
      previewLine.textContent = studioLines[activeIdx].instrumental ? '🎵 (Instrumental)' : studioLines[activeIdx].text;
    } else {
      previewLine.textContent = 'Sin letra cargada todavía';
    }
  }
  document.querySelectorAll('.studio-line-row').forEach((row, i) => {
    row.classList.toggle('studio-active-row', i === activeIdx);
  });
  if (activeIdx > -1) {
    const activeRow = document.querySelector(`.studio-line-row[data-idx="${activeIdx}"]`);
    if (activeRow) activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (btnStudioPlayPause && playIcon) {
    const icon = document.getElementById('studio-play-icon');
    if (icon) icon.innerHTML = playIcon.innerHTML;
  }
}, 300);

// ==========================================
// MODO CALIBRACIÓN KARAOKE (desglosa la línea activa en palabras editables)
// ==========================================
const studioTabLines = document.getElementById('studio-tab-lines');
const studioTabKaraoke = document.getElementById('studio-tab-karaoke');
const studioLineList = document.getElementById('studio-line-list');
const studioDropzoneEl = document.getElementById('studio-dropzone');
const studioBatchRow = document.querySelector('.studio-batch-row');
const studioKaraokePanel = document.getElementById('studio-karaoke-panel');
let karaokeRenderedLineIndex = null;

function songHasCalibratedLines() {
  return studioLines.some(l => l.time !== null && l.time !== undefined);
}

if (studioTabLines) {
  studioTabLines.addEventListener('click', () => {
    playSFX('click');
    studioTabMode = 'lines';
    studioTabLines.classList.add('active');
    if (studioTabKaraoke) studioTabKaraoke.classList.remove('active');
    if (studioLineList) studioLineList.classList.remove('hidden');
    if (studioDropzoneEl) studioDropzoneEl.classList.remove('hidden');
    if (studioBatchRow) studioBatchRow.classList.remove('hidden');
    if (studioKaraokePanel) studioKaraokePanel.classList.add('hidden');
  });
}
if (studioTabKaraoke) {
  studioTabKaraoke.addEventListener('click', () => {
    playSFX('click');
    if (!songHasCalibratedLines()) {
      showToast('No puedes entrar aquí, primero tienes que calibrar las letras normales.', 'error', 5000);
      return;
    }
    studioTabMode = 'karaoke';
    studioTabKaraoke.classList.add('active');
    if (studioTabLines) studioTabLines.classList.remove('active');
    if (studioLineList) studioLineList.classList.add('hidden');
    if (studioDropzoneEl) studioDropzoneEl.classList.add('hidden');
    if (studioBatchRow) studioBatchRow.classList.add('hidden');
    if (studioKaraokePanel) studioKaraokePanel.classList.remove('hidden');
    karaokeRenderedLineIndex = null; // fuerza a redibujar la línea actual ya
  });
}

// Reparte parejo el tiempo entre las palabras de una línea, entre su inicio y el inicio
// de la siguiente línea con tiempo (o +3s si es la última). Es solo el punto de partida:
// después se ajusta fino con los botones de milisegundos.
function generateWordTimes(lineIndex) {
  const line = studioLines[lineIndex];
  if (!line || line.time === null) return [];
  const words = line.text.split(' ').filter(w => w !== '');
  let nextTime = line.time + 3;
  for (let i = lineIndex + 1; i < studioLines.length; i++) {
    if (studioLines[i].time !== null) { nextTime = studioLines[i].time; break; }
  }
  const span = Math.max(0.3, nextTime - line.time);
  return words.map((word, i) => ({ word, time: line.time + (span * i) / words.length }));
}

function renderKaraokeWords(lineIndex) {
  const wordsContainer = document.getElementById('studio-karaoke-words');
  const prevLineEl = document.getElementById('studio-karaoke-prev-line');
  const nextLineEl = document.getElementById('studio-karaoke-next-line');
  if (!wordsContainer) return;

  if (lineIndex < 0 || !studioLines[lineIndex]) {
    wordsContainer.innerHTML = '<p class="empty-msg">Esperando a que suene una línea con tiempo asignado...</p>';
    if (prevLineEl) prevLineEl.textContent = '';
    if (nextLineEl) nextLineEl.textContent = '';
    return;
  }

  if (prevLineEl) prevLineEl.textContent = studioLines[lineIndex - 1] ? studioLines[lineIndex - 1].text : '';
  if (nextLineEl) nextLineEl.textContent = studioLines[lineIndex + 1] ? studioLines[lineIndex + 1].text : '';

  const song = songList[currentIndex];
  if (!song.karaokeWords) song.karaokeWords = {};
  if (!song.karaokeWords[lineIndex]) {
    song.karaokeWords[lineIndex] = generateWordTimes(lineIndex);
    updateSongInDB(song);
  }
  const wordTimes = song.karaokeWords[lineIndex];

  wordsContainer.innerHTML = wordTimes.map((w, i) => `
    <div class="studio-karaoke-word-chip" data-line="${lineIndex}" data-word="${i}">
      <button class="studio-karaoke-word-text" data-line="${lineIndex}" data-word="${i}" title="Tócala justo cuando se cante">${w.word}</button>
      <span class="studio-karaoke-word-time">${formatLrcTime(w.time)}</span>
      <div class="studio-karaoke-word-btns">
        <button class="studio-nudge-btn" data-nudge="-100">-100</button>
        <button class="studio-nudge-btn" data-nudge="-50">-50</button>
        <button class="studio-nudge-btn" data-nudge="50">+50</button>
        <button class="studio-nudge-btn" data-nudge="100">+100</button>
      </div>
    </div>`).join('');

  // Tap-sync por palabra: tócala justo cuando se cante y le marca su tiempo real
  wordsContainer.querySelectorAll('.studio-karaoke-word-text').forEach(btn => {
    btn.addEventListener('click', (e) => {
      playSFX('click');
      const li = parseInt(e.currentTarget.dataset.line, 10);
      const wi = parseInt(e.currentTarget.dataset.word, 10);
      const song2 = songList[currentIndex];
      if (song2.karaokeWords && song2.karaokeWords[li] && song2.karaokeWords[li][wi]) {
        song2.karaokeWords[li][wi].time = activeAudio.currentTime || 0;
        updateSongInDB(song2);
        renderKaraokeWords(li);
      }
    });
  });

  wordsContainer.querySelectorAll('.studio-nudge-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      playSFX('click');
      const chip = e.currentTarget.closest('.studio-karaoke-word-chip');
      const li = parseInt(chip.dataset.line, 10);
      const wi = parseInt(chip.dataset.word, 10);
      const delta = parseInt(e.currentTarget.dataset.nudge, 10) / 1000;
      const song2 = songList[currentIndex];
      if (song2.karaokeWords && song2.karaokeWords[li] && song2.karaokeWords[li][wi]) {
        song2.karaokeWords[li][wi].time = Math.max(0, song2.karaokeWords[li][wi].time + delta);
        updateSongInDB(song2);
        renderKaraokeWords(li);
      }
    });
  });
}

// Se conecta al mismo reloj que ya sigue la línea activa del Estudio
setInterval(() => {
  if (!lyricsStudioEl || !lyricsStudioEl.classList.contains('active') || studioTabMode !== 'karaoke') return;
  const activeIdx = getActiveStudioLineIndex(activeAudio.currentTime || 0);
  if (activeIdx !== karaokeRenderedLineIndex) {
    karaokeRenderedLineIndex = activeIdx;
    renderKaraokeWords(activeIdx);
  }
}, 300);

// ==========================================
// LETRAS DECORADAS EN MODO CINE
// ==========================================
if (toggleDecoratedLyrics) {
  const savedDecoratedLyrics = localStorage.getItem('decoratedLyricsEnabled');

  // Por defecto comienza desactivado. Si existe una elección guardada,
  // se respeta esa preferencia.
  toggleDecoratedLyrics.checked = savedDecoratedLyrics === 'true';

  toggleDecoratedLyrics.addEventListener('change', (event) => {
    const enabled = event.target.checked;

    localStorage.setItem(
      'decoratedLyricsEnabled',
      enabled ? 'true' : 'false'
    );

    if (typeof playSFX === 'function') {
      playSFX('click');
    }

    if (
      typeof songList !== 'undefined' &&
      Array.isArray(songList) &&
      songList.length > 0
    ) {
      const song = songList[currentIndex];

      if (song) {
        displayLyrics(song.lyrics || '');
      }
    }
  });
}


// =========================================================
// =========================================================
// MODO ESTUDIO Y2K STREAM — INDEPENDIENTE DEL MODO CINE
// =========================================================
const STREAM_STUDIO_DEPRECATED = true;
const STREAM_STUDIO_KEY = 'glasstrackStreamStudioConfig';
const STREAM_MEDIA_DB = 'streamMedia';

const defaultStreamSlots = [1, 2, 3, 4].map(i => ({
  slot: i,
  sourceType: 'none',
  sourceName: '',
  sourceUrl: '',
  clipStart: 0,
  clipEnd: 30,
  timelineStart: (i - 1) * 30,
  timelineEnd: i * 30
}));

let streamStudioConfig = {
  enabled: false,
  profile: { name: 'GLASSTRACK', badge: 'STREAMER', frame: 'glass' },
  style: {
    font: 'impact',
    color: '#ffffff',
    neon: true,
    stroke: 2,
    decorated: false,
    lines: 3,
    layout: 'staggered',
    vhsScanlines: true,
    vhsNoise: true,
    vhsFlicker: true,
    vhsRgb: true
  },
  crossfade: 1,
  totalDuration: 120,
  slots: defaultStreamSlots.map(s => ({ ...s }))
};

let streamRuntime = {
  open: false,
  playing: false,
  startedAt: 0,
  elapsedBeforePause: 0,
  currentSlot: 0,
  raf: 0,
  activeLayer: 'a',
  activeSlotKey: null,
  crossfadeSlotKey: null,
  objectUrls: {},
  lastSongIndex: null,
  kineticTimer: null,
  lyricBlockIndex: 0
};

function saveStreamStudioConfig() {
  try {
    localStorage.setItem(STREAM_STUDIO_KEY, JSON.stringify(streamStudioConfig));
  } catch (err) {
    console.warn('No se pudo guardar el Modo Estudio Y2K:', err);
  }
}

function loadStreamStudioConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(STREAM_STUDIO_KEY) || 'null');
    if (!raw) return;

    streamStudioConfig = {
      ...streamStudioConfig,
      ...raw,
      profile: { ...streamStudioConfig.profile, ...(raw.profile || {}) },
      style: { ...streamStudioConfig.style, ...(raw.style || {}) },
      slots: defaultStreamSlots.map(def => ({
        ...def,
        ...((raw.slots || [])[def.slot - 1] || {})
      }))
    };
  } catch (err) {
    console.warn('No se pudo cargar el Modo Estudio Y2K:', err);
  }
}

function streamFormatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function escapeHtmlStream(value) {
  return String(value || '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

function escapeAttrStream(value) {
  return escapeHtmlStream(value);
}

function openStreamMediaDB(mode = 'readonly') {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('IndexedDB principal aún no está listo'));
    try {
      const tx = db.transaction([STREAM_MEDIA_DB], mode);
      resolve(tx.objectStore(STREAM_MEDIA_DB));
    } catch (err) {
      reject(err);
    }
  });
}

async function saveLocalStreamBlob(slot, file) {
  try {
    const store = await openStreamMediaDB('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.put({ slot, blob: file, name: file.name, type: file.type });
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch (err) {
    console.warn('No se pudo guardar el video local del Stream Studio:', err);
    return false;
  }
}

async function loadLocalStreamBlob(slot) {
  try {
    const store = await openStreamMediaDB('readonly');
    return await new Promise((resolve, reject) => {
      const req = store.get(slot);
      req.onsuccess = () => resolve(req.result?.blob || null);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return null;
  }
}

async function deleteLocalStreamBlob(slot) {
  try {
    const store = await openStreamMediaDB('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.delete(slot);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  } catch (_) {}
}

function revokeStreamObjectUrls() {
  Object.values(streamRuntime.objectUrls).forEach(url => {
    try { URL.revokeObjectURL(url); } catch (_) {}
  });
  streamRuntime.objectUrls = {};
}

function streamSourceLabel(slot) {
  if (!slot) return 'Sin fuente';
  if (slot.sourceType === 'local') return slot.sourceName || 'Archivo local';
  if (slot.sourceType === 'url') return slot.sourceUrl || 'URL externa';
  return 'Sin fuente';
}

function streamIsGif(slot) {
  const src = `${slot?.sourceName || ''} ${slot?.sourceUrl || ''}`.toLowerCase();
  return src.includes('.gif') || (slot?.sourceType === 'local' && /\.gif$/i.test(slot.sourceName || ''));
}

function streamMediaUrl(slot) {
  if (!slot) return '';
  if (slot.sourceType === 'url') return slot.sourceUrl || '';
  return streamRuntime.objectUrls[slot.slot] || '';
}

function renderStreamSlotEditor() {
  if (!streamSlotList) return;
  streamSlotList.innerHTML = '';

  streamStudioConfig.slots.forEach(slot => {
    const wrap = document.createElement('div');
    wrap.className = 'stream-slot-card';
    wrap.dataset.slot = String(slot.slot);
    wrap.innerHTML = `
      <div class="stream-slot-head">
        <strong>VIDEO ${slot.slot}</strong>
        <span class="stream-slot-source">${escapeHtmlStream(streamSourceLabel(slot))}</span>
      </div>
      <div class="stream-source-row">
        <label class="stream-file-label">
          <span>Archivo</span>
          <input class="stream-file-input" data-action="file" type="file" accept="video/mp4,video/webm,image/gif">
        </label>
        <label class="stream-url-field">
          <span>URL / GIF</span>
          <input class="stream-url-input" data-action="url" type="url" placeholder="https://.../video.mp4 o .gif" value="${escapeAttrStream(slot.sourceUrl)}">
        </label>
        <button type="button" class="stream-mini-btn" data-action="apply-url">Usar URL</button>
        <button type="button" class="stream-mini-btn stream-danger-btn" data-action="clear-source">Quitar</button>
      </div>
      <div class="stream-range-grid">
        <label>Recorte inicio<input data-action="clip-start" type="number" min="0" step="0.1" value="${slot.clipStart}"></label>
        <label>Recorte fin<input data-action="clip-end" type="number" min="0.1" step="0.1" value="${slot.clipEnd}"></label>
        <label>Timeline inicio<input data-action="timeline-start" type="number" min="0" step="0.1" value="${slot.timelineStart}"></label>
        <label>Timeline fin<input data-action="timeline-end" type="number" min="0.1" step="0.1" value="${slot.timelineEnd}"></label>
      </div>`;
    streamSlotList.appendChild(wrap);
  });
}

function normalizeKineticCharacter(char) {
  return String(char || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function createStreamDecoratedChar(char) {
  const normalized = normalizeKineticCharacter(char);

  if (char === ' ') {
    const space = document.createElement('span');
    space.className = 'decorated-space';
    return space;
  }

  if (/^[a-z]$/.test(normalized) || /^[0-9]$/.test(normalized)) {
    const img = document.createElement('img');
    const variant = /^[0-9]$/.test(normalized) ? 1 : Math.floor(Math.random() * 3) + 1;
    img.className = 'stream-decorated-char';
    img.src = `img/letras/${normalized}_${variant}.png`;
    img.alt = char;
    img.draggable = false;
    img.onerror = function () {
      this.style.display = 'none';
      const fallback = document.createElement('span');
      fallback.className = 'stream-decorated-fallback';
      fallback.textContent = char;
      if (this.parentNode) this.parentNode.appendChild(fallback);
    };
    return img;
  }

  const fallback = document.createElement('span');
  fallback.className = 'stream-decorated-fallback';
  fallback.textContent = char;
  return fallback;
}

function createStreamKineticLine(text) {
  const line = document.createElement('span');
  line.className = 'stream-kinetic-line';

  if (!streamStudioConfig.style.decorated) {
    line.textContent = text;
    return line;
  }

  Array.from(text).forEach(char => {
    line.appendChild(createStreamDecoratedChar(char));
  });
  return line;
}

function getStreamLyricBlocks(text) {
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);

  if (!rawLines.length) return [['Modo'], ['Stream Y2K'], ['Visualizer']];

  const wanted = Math.min(4, Math.max(2, Number(streamStudioConfig.style.lines) || 3));
  const blocks = [];

  for (let i = 0; i < rawLines.length; i += wanted) {
    const block = rawLines.slice(i, i + wanted);
    if (block.length >= 2) blocks.push(block);
  }

  if (!blocks.length) {
    const words = rawLines[0].split(/\s+/).filter(Boolean);
    const count = Math.min(wanted, Math.max(2, words.length));
    const perLine = Math.ceil(words.length / count);
    const block = [];
    for (let i = 0; i < words.length; i += perLine) block.push(words.slice(i, i + perLine).join(' '));
    while (block.length < 2) block.push('');
    return [block.slice(0, wanted)];
  }

  return blocks;
}

function renderStreamLyricPreview(text, animate = true) {
  if (!streamLyricPreview) return;

  const blocks = getStreamLyricBlocks(text);
  streamLyricPreview.innerHTML = '';

  const block = blocks[streamRuntime.lyricBlockIndex % blocks.length] || blocks[0];
  block.forEach((lineText, index) => {
    const line = createStreamKineticLine(lineText || ' ');
    line.style.setProperty('--kinetic-index', index);
    line.dataset.index = String(index);
    streamLyricPreview.appendChild(line);
  });

  streamLyricPreview.dataset.layout = streamStudioConfig.style.layout || 'staggered';

  if (animate) {
    streamLyricPreview.classList.remove('kinetic-snap');
    requestAnimationFrame(() => streamLyricPreview.classList.add('kinetic-snap'));
  }
}

function startKineticPreview(text) {
  clearInterval(streamRuntime.kineticTimer);
  const blocks = getStreamLyricBlocks(text);
  streamRuntime.lyricBlockIndex = 0;
  renderStreamLyricPreview(text, true);

  if (blocks.length <= 1) return;

  streamRuntime.kineticTimer = setInterval(() => {
    if (!streamRuntime.open) return;
    streamRuntime.lyricBlockIndex = (streamRuntime.lyricBlockIndex + 1) % blocks.length;
    renderStreamLyricPreview(text, true);
  }, 2500);
}

function updateStreamPreviewInfo() {
  const name = streamStudioConfig.profile.name.trim() || 'GLASSTRACK';
  const badge = streamStudioConfig.profile.badge || 'STREAMER';

  if (streamPreviewNick) streamPreviewNick.textContent = name;
  if (streamPreviewBadge) streamPreviewBadge.textContent = badge;
  if (streamProfilePreview) streamProfilePreview.dataset.frame = streamStudioConfig.profile.frame || 'glass';

  if (streamLivePreview) {
    streamLivePreview.dataset.font = streamStudioConfig.style.font || 'impact';
    streamLivePreview.style.setProperty('--stream-accent', streamStudioConfig.style.color || '#ffffff');
    streamLivePreview.style.setProperty('--stream-stroke', `${Number(streamStudioConfig.style.stroke) || 0}px`);
    streamLivePreview.classList.toggle('stream-neon-off', !streamStudioConfig.style.neon);
    streamLivePreview.classList.toggle('stream-decorated-on', !!streamStudioConfig.style.decorated);
    streamLivePreview.classList.toggle('stream-rgb-off', !streamStudioConfig.style.vhsRgb);
  }

  const scan = document.getElementById('stream-vhs-scanlines-layer');
  const noise = document.getElementById('stream-vhs-noise-layer');
  const flicker = document.getElementById('stream-vhs-flicker-layer');
  const rgb = document.getElementById('stream-vhs-rgb-layer');
  if (scan) scan.hidden = !streamStudioConfig.style.vhsScanlines;
  if (noise) noise.hidden = !streamStudioConfig.style.vhsNoise;
  if (flicker) flicker.hidden = !streamStudioConfig.style.vhsFlicker;
  if (rgb) rgb.hidden = !streamStudioConfig.style.vhsRgb;

  const song = songList[currentIndex];
  if (song) {
    if (streamPreviewTitle) streamPreviewTitle.textContent = song.title || 'Sin título';
    if (streamPreviewArtist) streamPreviewArtist.textContent = song.artist || '—';
    startKineticPreview(song.lyrics || '');
  } else {
    startKineticPreview('Modo Stream Y2K\nKinetic Visualizer\nGLASSTRACK');
  }
}

function getStreamTimelineDuration() {
  const configured = Math.max(1, Number(streamStudioConfig.totalDuration) || 1);
  const slotsMax = streamStudioConfig.slots.reduce((max, slot) => Math.max(max, Number(slot.timelineEnd) || 0), 0);
  return Math.max(configured, slotsMax);
}

function findStreamSlot(time) {
  const candidates = streamStudioConfig.slots.filter(slot => {
    const start = Number(slot.timelineStart) || 0;
    const end = Number(slot.timelineEnd) || 0;
    return slot.sourceType !== 'none' && end > start && time >= start && time < end;
  });
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function clearStreamLayer(layerName) {
  const video = layerName === 'a' ? streamMediaA : streamMediaB;
  const gif = layerName === 'a' ? streamGifA : streamGifB;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    try { video.load(); } catch (_) {}
    video.style.opacity = '0';
  }
  if (gif) {
    gif.removeAttribute('src');
    gif.style.opacity = '0';
  }
}

function setStreamLayerVisibility(layerName, opacity) {
  const video = layerName === 'a' ? streamMediaA : streamMediaB;
  const gif = layerName === 'a' ? streamGifA : streamGifB;
  if (video) video.style.opacity = String(opacity);
  if (gif) gif.style.opacity = String(opacity);
}

function configureStreamVideo(video, slot, url) {
  if (!video) return;
  video.pause();
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.load();
  video.onloadedmetadata = () => {
    try {
      video.currentTime = Math.max(0, Number(slot.clipStart) || 0);
    } catch (_) {}
    if (streamRuntime.playing) video.play().catch(() => {});
  };
}

function loadStreamSlotIntoLayer(slot, layerName) {
  clearStreamLayer(layerName);
  if (!slot) return;
  const url = streamMediaUrl(slot);
  if (!url) return;

  if (streamIsGif(slot)) {
    const gif = layerName === 'a' ? streamGifA : streamGifB;
    if (gif) {
      gif.src = url;
      gif.style.opacity = '0';
    }
  } else {
    configureStreamVideo(layerName === 'a' ? streamMediaA : streamMediaB, slot, url);
  }
}

function playStreamLayerAtTime(slot, layerName, globalTime) {
  if (!slot || streamIsGif(slot)) return;
  const video = layerName === 'a' ? streamMediaA : streamMediaB;
  if (!video) return;

  const clipStart = Math.max(0, Number(slot.clipStart) || 0);
  const clipEnd = Math.max(clipStart + 0.1, Number(slot.clipEnd) || clipStart + 0.1);
  const timelineStart = Number(slot.timelineStart) || 0;
  let target = clipStart + Math.max(0, globalTime - timelineStart);
  if (target >= clipEnd) target = clipStart;

  try {
    if (Math.abs((video.currentTime || 0) - target) > 0.25) video.currentTime = target;
  } catch (_) {}

  if (streamRuntime.playing) video.play().catch(() => {});
}

function updateStreamLayers(slot, time) {
  if (!slot) return;

  if (streamRuntime.activeSlotKey !== slot.slot) {
    const nextLayer = streamRuntime.activeLayer === 'a' ? 'b' : 'a';
    loadStreamSlotIntoLayer(slot, nextLayer);
    setStreamLayerVisibility(nextLayer, 1);
    clearStreamLayer(streamRuntime.activeLayer);
    streamRuntime.activeLayer = nextLayer;
    streamRuntime.activeSlotKey = slot.slot;
    streamRuntime.crossfadeSlotKey = null;
  }

  const fade = Math.min(5, Math.max(0, Number(streamStudioConfig.crossfade) || 0));
  const end = Number(slot.timelineEnd) || 0;
  const remaining = end - time;
  const nextSlot = streamStudioConfig.slots.find(candidate =>
    candidate.slot !== slot.slot &&
    candidate.sourceType !== 'none' &&
    Math.abs((Number(candidate.timelineStart) || 0) - end) < 0.01
  );

  if (fade > 0 && nextSlot && remaining > 0 && remaining <= fade) {
    const nextLayer = streamRuntime.activeLayer === 'a' ? 'b' : 'a';
    if (streamRuntime.crossfadeSlotKey !== nextSlot.slot) {
      loadStreamSlotIntoLayer(nextSlot, nextLayer);
      streamRuntime.crossfadeSlotKey = nextSlot.slot;
    }

    const amount = Math.max(0, Math.min(1, 1 - remaining / fade));
    setStreamLayerVisibility(streamRuntime.activeLayer, 1 - amount);
    setStreamLayerVisibility(nextLayer, amount);
    playStreamLayerAtTime(nextSlot, nextLayer, time);
  } else {
    setStreamLayerVisibility(streamRuntime.activeLayer, 1);
  }

  playStreamLayerAtTime(slot, streamRuntime.activeLayer, time);
}

function renderStreamAtTime(time) {
  const duration = getStreamTimelineDuration();
  const safeTime = Math.min(duration, Math.max(0, Number(time) || 0));
  streamRuntime.elapsedBeforePause = safeTime;

  if (streamPreviewClock) streamPreviewClock.textContent = `${streamFormatTime(safeTime)} / ${streamFormatTime(duration)}`;
  if (streamMarkerFill) streamMarkerFill.style.width = `${duration ? (safeTime / duration) * 100 : 0}%`;

  const slot = findStreamSlot(safeTime);
  if (slot) {
    streamRuntime.currentSlot = slot.slot;
    if (streamCurrentSlot) streamCurrentSlot.textContent = `Video ${slot.slot}`;
    if (streamCurrentMedia) streamCurrentMedia.textContent = streamSourceLabel(slot);
    updateStreamLayers(slot, safeTime);
  } else {
    streamRuntime.currentSlot = 0;
    streamRuntime.activeSlotKey = null;
    streamRuntime.crossfadeSlotKey = null;
    if (streamCurrentSlot) streamCurrentSlot.textContent = 'Sin video activo';
    if (streamCurrentMedia) streamCurrentMedia.textContent = 'Añade una fuente a una ranura';
    clearStreamLayer('a');
    clearStreamLayer('b');
  }

  if (streamRuntime.lastSongIndex !== currentIndex) {
    streamRuntime.lastSongIndex = currentIndex;
    updateStreamPreviewInfo();
  }
}

function streamAnimationLoop(now) {
  if (!streamRuntime.playing) return;
  const elapsed = (now - streamRuntime.startedAt) / 1000 + streamRuntime.elapsedBeforePause;
  const duration = getStreamTimelineDuration();

  if (elapsed >= duration) {
    streamRuntime.elapsedBeforePause = duration;
    streamRuntime.playing = false;
    streamStatus && (streamStatus.textContent = 'READY');
    renderStreamAtTime(duration);
    return;
  }

  renderStreamAtTime(elapsed);
  streamRuntime.raf = requestAnimationFrame(streamAnimationLoop);
}

function playStreamSequence() {
  if (STREAM_STUDIO_DEPRECATED) return;
  if (!streamRuntime.open) openStreamStudio();
  streamRuntime.playing = true;
  streamRuntime.startedAt = performance.now();
  if (streamStatus) streamStatus.textContent = 'LIVE';
  cancelAnimationFrame(streamRuntime.raf);
  streamRuntime.raf = requestAnimationFrame(streamAnimationLoop);
}

function pauseStreamSequence() {
  streamRuntime.playing = false;
  cancelAnimationFrame(streamRuntime.raf);
  [streamMediaA, streamMediaB].forEach(v => { if (v) v.pause(); });
  if (streamStatus) streamStatus.textContent = 'PAUSED';
}

function restartStreamSequence() {
  if (STREAM_STUDIO_DEPRECATED) return;
  streamRuntime.playing = false;
  cancelAnimationFrame(streamRuntime.raf);
  streamRuntime.elapsedBeforePause = 0;
  streamRuntime.activeSlotKey = null;
  streamRuntime.crossfadeSlotKey = null;
  streamRuntime.activeLayer = 'a';
  renderStreamAtTime(0);
  playStreamSequence();
}

async function prepareStreamMedia() {
  revokeStreamObjectUrls();
  await Promise.all(streamStudioConfig.slots.map(async slot => {
    if (slot.sourceType !== 'local') return;
    const blob = await loadLocalStreamBlob(slot.slot);
    if (blob) streamRuntime.objectUrls[slot.slot] = URL.createObjectURL(blob);
  }));
}

async function setStreamSlotSource(slotNumber, file) {
  const slot = streamStudioConfig.slots[slotNumber - 1];
  if (!slot || !file) return;

  slot.sourceType = 'local';
  slot.sourceName = file.name;
  slot.sourceUrl = '';

  await saveLocalStreamBlob(slot.slot, file);
  await prepareStreamMedia();
  saveStreamStudioConfig();
  renderStreamSlotEditor();
  renderStreamAtTime(streamRuntime.elapsedBeforePause);
}

async function setStreamSlotUrl(slotNumber, url) {
  const slot = streamStudioConfig.slots[slotNumber - 1];
  if (!slot) return;

  const clean = String(url || '').trim();
  if (!clean) return;

  slot.sourceType = 'url';
  slot.sourceName = clean.split('/').pop() || 'URL externa';
  slot.sourceUrl = clean;

  await deleteLocalStreamBlob(slot.slot);
  await prepareStreamMedia();
  saveStreamStudioConfig();
  renderStreamSlotEditor();
  renderStreamAtTime(streamRuntime.elapsedBeforePause);
}

async function clearStreamSlot(slotNumber) {
  const slot = streamStudioConfig.slots[slotNumber - 1];
  if (!slot) return;

  slot.sourceType = 'none';
  slot.sourceName = '';
  slot.sourceUrl = '';

  await deleteLocalStreamBlob(slot.slot);
  await prepareStreamMedia();
  saveStreamStudioConfig();
  renderStreamSlotEditor();
  renderStreamAtTime(streamRuntime.elapsedBeforePause);
}

function openStreamStudio() {
  if (STREAM_STUDIO_DEPRECATED || !streamStudioMode) return;

  streamRuntime.open = true;
  streamStudioMode.classList.add('active');
  streamStudioMode.setAttribute('aria-hidden', 'false');
  document.body.classList.add('stream-studio-open');
  if (toggleStreamStudio) toggleStreamStudio.checked = true;
  streamStudioConfig.enabled = true;
  if (streamStatus) streamStatus.textContent = 'READY';

  updateStreamPreviewInfo();
  renderStreamSlotEditor();
  prepareStreamMedia().then(() => renderStreamAtTime(streamRuntime.elapsedBeforePause));
}

function closeStreamStudio() {
  if (!streamStudioMode) return;

  streamRuntime.open = false;
  streamRuntime.playing = false;
  clearInterval(streamRuntime.kineticTimer);
  streamRuntime.kineticTimer = null;
  cancelAnimationFrame(streamRuntime.raf);

  [streamMediaA, streamMediaB].forEach(v => { if (v) v.pause(); });

  streamStudioMode.classList.remove('active');
  streamStudioMode.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('stream-studio-open');
  if (toggleStreamStudio) toggleStreamStudio.checked = false;
  streamStudioConfig.enabled = false;
  if (streamStatus) streamStatus.textContent = 'OFFLINE';
  saveStreamStudioConfig();
}

function bindStreamStudioUI() {
  loadStreamStudioConfig();
  if (STREAM_STUDIO_DEPRECATED) {
    if (toggleStreamStudio) { toggleStreamStudio.disabled = true; toggleStreamStudio.checked = false; }
    if (btnOpenStreamStudio) btnOpenStreamStudio.disabled = true;
    if (streamStudioMode) { streamStudioMode.classList.remove('active'); streamStudioMode.setAttribute('aria-hidden', 'true'); }
    return;
  }
  if (toggleStreamStudio) toggleStreamStudio.checked = false;

  // Pestañas
  document.querySelectorAll('.stream-tab[data-stream-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.streamTab;
      document.querySelectorAll('.stream-tab[data-stream-tab]').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.stream-tab-panel[data-stream-panel]').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.streamPanel === target);
      });
    });
  });

  if (toggleStreamStudio) {
    toggleStreamStudio.disabled = STREAM_STUDIO_DEPRECATED;
    toggleStreamStudio.checked = false;
    if (!STREAM_STUDIO_DEPRECATED) {
      toggleStreamStudio.addEventListener('change', () => {
        if (toggleStreamStudio.checked) openStreamStudio();
        else closeStreamStudio();
      });
    }
  }

  if (btnOpenStreamStudio) {
    btnOpenStreamStudio.disabled = STREAM_STUDIO_DEPRECATED;
    if (!STREAM_STUDIO_DEPRECATED) {
      btnOpenStreamStudio.addEventListener('click', () => { playSFX('open'); openStreamStudio(); });
    }
  }
  if (btnStreamStudioClose) btnStreamStudioClose.addEventListener('click', () => { playSFX('close'); closeStreamStudio(); });
  if (btnStreamStudioPlay) btnStreamStudioPlay.addEventListener('click', () => { playSFX('click'); playStreamSequence(); });
  if (btnStreamStudioPause) btnStreamStudioPause.addEventListener('click', () => { playSFX('click'); pauseStreamSequence(); });
  if (btnStreamStudioRestart) btnStreamStudioRestart.addEventListener('click', () => { playSFX('click'); restartStreamSequence(); });

  if (btnStreamStudioReset) {
    btnStreamStudioReset.addEventListener('click', async () => {
      playSFX('click');
      if (!confirm('¿Restablecer el Modo Estudio Y2K Stream?')) return;
      for (const slot of streamStudioConfig.slots) await deleteLocalStreamBlob(slot.slot);
      revokeStreamObjectUrls();
      streamStudioConfig = {
        enabled: false,
        profile: { name: 'GLASSTRACK', badge: 'STREAMER', frame: 'glass' },
        style: {
          font: 'impact', color: '#ffffff', neon: true, stroke: 2, decorated: false,
          lines: 3, layout: 'staggered', vhsScanlines: true, vhsNoise: true,
          vhsFlicker: true, vhsRgb: true
        },
        crossfade: 1,
        totalDuration: 120,
        slots: defaultStreamSlots.map(s => ({ ...s }))
      };
      streamRuntime.elapsedBeforePause = 0;
      streamRuntime.activeSlotKey = null;
      streamRuntime.crossfadeSlotKey = null;
      if (toggleStreamStudio) toggleStreamStudio.checked = false;
      syncStreamInputsFromConfig();
      renderStreamSlotEditor();
      updateStreamPreviewInfo();
      renderStreamAtTime(0);
      closeStreamStudio();
      saveStreamStudioConfig();
    });
  }

  // Slots
  if (streamSlotList) {
    streamSlotList.addEventListener('change', async e => {
      const card = e.target.closest('.stream-slot-card');
      if (!card) return;
      const slotNum = Number(card.dataset.slot);
      const slot = streamStudioConfig.slots[slotNum - 1];
      if (!slot) return;

      const action = e.target.dataset.action;
      if (action === 'file') {
        await setStreamSlotSource(slotNum, e.target.files?.[0]);
        return;
      }
      if (action === 'clip-start') slot.clipStart = Math.max(0, Number(e.target.value) || 0);
      if (action === 'clip-end') slot.clipEnd = Math.max(slot.clipStart + 0.1, Number(e.target.value) || 0);
      if (action === 'timeline-start') slot.timelineStart = Math.max(0, Number(e.target.value) || 0);
      if (action === 'timeline-end') slot.timelineEnd = Math.max(slot.timelineStart + 0.1, Number(e.target.value) || 0);

      saveStreamStudioConfig();
      renderStreamSlotEditor();
      renderStreamAtTime(streamRuntime.elapsedBeforePause);
    });

    streamSlotList.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-action]');
      const card = e.target.closest('.stream-slot-card');
      if (!btn || !card) return;

      const slotNum = Number(card.dataset.slot);
      if (btn.dataset.action === 'apply-url') {
        const input = card.querySelector('.stream-url-input');
        await setStreamSlotUrl(slotNum, input?.value || '');
      } else if (btn.dataset.action === 'clear-source') {
        await clearStreamSlot(slotNum);
      }
    });
  }

  const bindValue = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const apply = () => {
      fn(el.value, el);
      saveStreamStudioConfig();
      updateStreamPreviewInfo();
      renderStreamAtTime(streamRuntime.elapsedBeforePause);
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  };

  bindValue('stream-profile-name', v => streamStudioConfig.profile.name = v);
  bindValue('stream-profile-badge', v => streamStudioConfig.profile.badge = v);
  bindValue('stream-profile-frame', v => streamStudioConfig.profile.frame = v);
  bindValue('stream-style-font', v => streamStudioConfig.style.font = v);
  bindValue('stream-style-color', v => streamStudioConfig.style.color = v);
  bindValue('stream-style-stroke', v => streamStudioConfig.style.stroke = Number(v) || 0);
  bindValue('stream-style-lines', v => streamStudioConfig.style.lines = Math.min(4, Math.max(2, Number(v) || 3)));
  bindValue('stream-style-layout', v => streamStudioConfig.style.layout = v || 'staggered');
  bindValue('stream-crossfade', v => streamStudioConfig.crossfade = Math.min(5, Math.max(0, Number(v) || 0)));
  bindValue('stream-total-duration', v => streamStudioConfig.totalDuration = Math.max(1, Number(v) || 1));

  const bindCheck = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      streamStudioConfig.style[key] = !!el.checked;
      saveStreamStudioConfig();
      updateStreamPreviewInfo();
    });
  };

  bindCheck('stream-style-neon', 'neon');
  bindCheck('stream-style-decorated', 'decorated');
  bindCheck('stream-vhs-scanlines', 'vhsScanlines');
  bindCheck('stream-vhs-noise', 'vhsNoise');
  bindCheck('stream-vhs-flicker', 'vhsFlicker');
  bindCheck('stream-vhs-rgb', 'vhsRgb');

  syncStreamInputsFromConfig();
  renderStreamSlotEditor();
  updateStreamPreviewInfo();

  if (!STREAM_STUDIO_DEPRECATED) {
    document.addEventListener('keydown', e => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.code === 'KeyP') {
        e.preventDefault();
        if (streamRuntime.open) closeStreamStudio();
        else openStreamStudio();
      } else if (e.code === 'KeyI') {
        e.preventDefault();
        if (streamRuntime.open) closeStreamStudio();
      }
    });
  }
}

function syncStreamInputsFromConfig() {
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  const setCheck = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  };

  setVal('stream-profile-name', streamStudioConfig.profile.name);
  setVal('stream-profile-badge', streamStudioConfig.profile.badge);
  setVal('stream-profile-frame', streamStudioConfig.profile.frame);
  setVal('stream-style-font', streamStudioConfig.style.font);
  setVal('stream-style-color', streamStudioConfig.style.color);
  setVal('stream-style-stroke', streamStudioConfig.style.stroke);
  setVal('stream-style-lines', streamStudioConfig.style.lines);
  setVal('stream-style-layout', streamStudioConfig.style.layout);
  setVal('stream-crossfade', streamStudioConfig.crossfade);
  setVal('stream-total-duration', streamStudioConfig.totalDuration);
  setCheck('stream-style-neon', streamStudioConfig.style.neon);
  setCheck('stream-style-decorated', streamStudioConfig.style.decorated);
  setCheck('stream-vhs-scanlines', streamStudioConfig.style.vhsScanlines);
  setCheck('stream-vhs-noise', streamStudioConfig.style.vhsNoise);
  setCheck('stream-vhs-flicker', streamStudioConfig.style.vhsFlicker);
  setCheck('stream-vhs-rgb', streamStudioConfig.style.vhsRgb);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', bindStreamStudioUI);
}


// =========================================================
// MODO PERSPECTIVA MOBILE 3D — INDEPENDIENTE
// =========================================================
(() => {
  'use strict';

  const overlay = document.getElementById('mobile-3d-mode');
  const phone = document.getElementById('mobile-3d-phone');
  const closeBtn = document.getElementById('mobile-3d-close');
  const art = document.getElementById('mobile-3d-art');
  const trackTitle = document.getElementById('mobile-3d-title');
  const trackArtist = document.getElementById('mobile-3d-artist');
  const progress = document.getElementById('mobile-3d-progress');
  const currentTimeEl = document.getElementById('mobile-3d-current-time');
  const durationEl = document.getElementById('mobile-3d-duration');
  const playButton = document.getElementById('mobile-3d-play');
  const playIcon = document.getElementById('mobile-3d-play-icon');
  const canvas = document.getElementById('mobile-3d-visualizer');

  if (!overlay || !phone || !canvas) return;

  let visualizerFrame = 0;
  let lastColorSource = '';
  let isSeeking = false;

  function format3DTime(seconds) {
    const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function setAccent(r, g, b) {
    const rgb = `${r}, ${g}, ${b}`;
    const root = document.documentElement;
    root.style.setProperty('--dominant-rgb', rgb);
    root.style.setProperty('--m3d-accent', `rgb(${rgb})`);
    root.style.setProperty('--m3d-accent-rgb', rgb);
  }

  function setAccentFromHex(hex) {
    const clean = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
      setAccent(154, 163, 173);
      return;
    }
    setAccent(
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    );
  }

  async function extractDominantColor(src) {
    if (!src) return null;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = src;
    });

    const sample = 64;
    const temp = document.createElement('canvas');
    temp.width = sample;
    temp.height = sample;

    const ctx = temp.getContext('2d', {
      willReadFrequently: true
    });

    if (!ctx) return null;

    ctx.drawImage(image, 0, 0, sample, sample);

    const data = ctx.getImageData(
      0,
      0,
      sample,
      sample
    ).data;

    // Cuantizamos colores en cubos de 32 niveles para encontrar
    // un color dominante real en lugar de promediar toda la portada.
    const buckets = new Map();

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 120) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max - min;

      // Evitamos negros/grises casi puros y blancos lavados.
      if (max < 22 || (min > 242 && saturation < 18)) continue;

      const rq = Math.round(r / 32) * 32;
      const gq = Math.round(g / 32) * 32;
      const bq = Math.round(b / 32) * 32;
      const key = `${rq},${gq},${bq}`;

      const weight =
        1 +
        Math.min(3, saturation / 70) +
        Math.min(2, max / 170);

      const existing = buckets.get(key) || {
        weight: 0,
        r: 0,
        g: 0,
        b: 0
      };

      existing.weight += weight;
      existing.r += r * weight;
      existing.g += g * weight;
      existing.b += b * weight;

      buckets.set(key, existing);
    }

    if (!buckets.size) return null;

    let winner = null;

    for (const bucket of buckets.values()) {
      if (!winner || bucket.weight > winner.weight) {
        winner = bucket;
      }
    }

    if (!winner || !winner.weight) return null;

    return {
      r: Math.max(0, Math.min(255, Math.round(winner.r / winner.weight))),
      g: Math.max(0, Math.min(255, Math.round(winner.g / winner.weight))),
      b: Math.max(0, Math.min(255, Math.round(winner.b / winner.weight)))
    };
  }

  async function updatePalette(src) {
    const source = String(src || '');
    if (!source || source === lastColorSource) return;
    lastColorSource = source;

    try {
      const color = await extractDominantColor(source);
      if (color) setAccent(color.r, color.g, color.b);
      else setAccent(154, 163, 173);
    } catch (_) {
      // CORS o imagen inaccesible: color neutro de respaldo.
      setAccent(154, 163, 173);
    }
  }

  function syncMetadata() {
    if (typeof songList !== 'undefined' && Array.isArray(songList)) {
      const song = songList[currentIndex];
      if (song) {
        if (trackTitle) trackTitle.textContent = song.title || 'Sin canción cargada';
        if (trackArtist) trackArtist.textContent = song.artist || '—';
        if (art && song.cover && art.src !== song.cover) art.src = song.cover;
        updatePalette(song.cover || (cover && cover.src) || '');
        return;
      }
    }

    if (title && trackTitle) trackTitle.textContent = title.textContent || 'Sin canción cargada';
    if (artist && trackArtist) trackArtist.textContent = artist.textContent || '—';
    if (cover && art && cover.src) {
      art.src = cover.src;
      updatePalette(cover.src);
    }
  }

  // Permite que loadSong sincronice este panel incluso si la portada no cambia.
  window.__glasstrackMobile3DSync = syncMetadata;

  function updatePlayIcon() {
    if (!playIcon || typeof activeAudio === 'undefined') return;
    playIcon.textContent = activeAudio && !activeAudio.paused ? 'Ⅱ' : '▶';
  }

  function syncProgress() {
    if (typeof activeAudio === 'undefined' || !activeAudio) return;
    const duration = Number(activeAudio.duration);
    const current = Number(activeAudio.currentTime);

    if (Number.isFinite(duration) && duration > 0 && !isSeeking) {
      progress.max = String(duration);
      progress.value = String(Math.min(duration, Math.max(0, current || 0)));
      durationEl.textContent = format3DTime(duration);
    } else if (!Number.isFinite(duration) || duration <= 0) {
      progress.max = '100';
      progress.value = '0';
      durationEl.textContent = '0:00';
    }

    currentTimeEl.textContent = format3DTime(current);
    updatePlayIcon();
  }

  function togglePlayback() {
    if (playBtn) {
      playBtn.click();
    }
  }

  function seekFromProgress() {
    if (typeof activeAudio === 'undefined' || !activeAudio) return;
    const duration = Number(activeAudio.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    activeAudio.currentTime = Math.min(duration, Math.max(0, Number(progress.value) || 0));
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height, dpr };
  }

  function drawVisualizer() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = resizeCanvas();
    ctx.clearRect(0, 0, width, height);

    let data = null;
    if (typeof concludorAnalyser !== 'undefined' && concludorAnalyser) {
      data = new Uint8Array(concludorAnalyser.frequencyBinCount);
      concludorAnalyser.getByteFrequencyData(data);
    }

    const bars = 30;
    const gap = Math.max(1, width / (bars * 8));
    const barWidth = (width - gap * (bars - 1)) / bars;
    const rgb = getComputedStyle(document.documentElement).getPropertyValue('--m3d-accent-rgb').trim() || '154, 163, 173';

    for (let i = 0; i < bars; i++) {
      let value = 0.06;
      if (data && data.length) {
        const index = Math.min(data.length - 1, Math.floor((i / bars) * data.length));
        value = Math.max(0.06, data[index] / 255);
      }

      const barHeight = Math.max(4, value * height * 0.88);
      const x = i * (barWidth + gap);
      const y = height - barHeight;

      ctx.fillStyle = `rgba(${rgb}, 0.92)`;
      ctx.shadowColor = `rgba(${rgb}, 0.85)`;
      ctx.shadowBlur = 10;
      ctx.fillRect(x, y, barWidth, barHeight);
    }

    ctx.shadowBlur = 0;
    visualizerFrame = requestAnimationFrame(drawVisualizer);
  }

  function open() {
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mobile-3d-open');
    syncMetadata();
    syncProgress();
    cancelAnimationFrame(visualizerFrame);
    drawVisualizer();
  }

  function close() {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mobile-3d-open');
    cancelAnimationFrame(visualizerFrame);
  }

  closeBtn?.addEventListener('click', close);
  playButton?.addEventListener('click', togglePlayback);

  progress?.addEventListener('pointerdown', () => { isSeeking = true; });
  progress?.addEventListener('pointerup', () => { isSeeking = false; seekFromProgress(); });
  progress?.addEventListener('change', () => { isSeeking = false; seekFromProgress(); });
  progress?.addEventListener('input', () => {
    const duration = Number(activeAudio?.duration);
    currentTimeEl.textContent = format3DTime(
      Number.isFinite(duration) && duration > 0 ? Number(progress.value) : 0
    );
  });

  window.addEventListener('resize', () => {
    if (overlay.classList.contains('active')) resizeCanvas();
  });

  [audio1, audio2].forEach(audio => {
    if (!audio) return;
    audio.addEventListener('timeupdate', syncProgress);
    audio.addEventListener('loadedmetadata', syncProgress);
    audio.addEventListener('play', syncProgress);
    audio.addEventListener('pause', syncProgress);
    audio.addEventListener('durationchange', syncProgress);
  });

  if (cover) {
    cover.addEventListener('load', () => {
      if (!cover.src) return;
      if (art) art.src = cover.src;
      updatePalette(cover.src);
    });
  }

  // Cierre del Modo Perspectiva Mobile 3D con Escape.
  // El antiguo atajo H fue eliminado por completo.
  document.addEventListener('keydown', event => {
    if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (event.code === 'Escape' && overlay.classList.contains('active')) {
      event.preventDefault();
      close();
    }
  });

  syncMetadata();
  syncProgress();
  setAccentFromHex('#9aa3ad');
})();


/* =========================================================
   GLASSTRACK PRO — MODO MINIJUEGO DE RITMO / CHART STUDIO
   - Gameplay por carriles
   - Editor/grabador en tiempo real
   - Mapeo 2K / 4K / Custom
   - Charts persistentes en IndexedDB
   - Atajo global X / guardado L
   ========================================================= */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const rhythmOverlay = $('rhythm-overlay');
  if (!rhythmOverlay) return;

  const rhythmTabGame = $('rhythm-tab-game');
  const rhythmTabStudy = $('rhythm-tab-study');
  const rhythmGameView = $('rhythm-game-view');
  const rhythmStudyView = $('rhythm-study-view');
  const rhythmClose = $('rhythm-close');
  const toggleRhythm = $('toggle-rhythm-mode');
  const toggleRhythmDetail = $('toggle-rhythm-mode-detail');
  const btnOpenRhythmGame = $('btn-open-rhythm-game');
  const btnOpenRhythmStudy = $('btn-open-rhythm-study');

  const songCover = $('rhythm-song-cover');
  const songTitle = $('rhythm-song-title');
  const songArtist = $('rhythm-song-artist');
  const songStatus = $('rhythm-song-status');

  const gameHighway = $('rhythm-highway');
  const gameLanes = $('rhythm-lanes');
  const gameKeyRow = $('rhythm-key-row');
  const gameJudgement = $('rhythm-judgement');
  const gameScoreEl = $('rhythm-score');
  const gameComboEl = $('rhythm-combo');
  const gameAccuracyEl = $('rhythm-accuracy');
  const gameFeedback = $('rhythm-feedback');
  const gameProgressFill = $('rhythm-progress-fill');
  const gameTimeReadout = $('rhythm-time-readout');
  const gameChartName = $('rhythm-chart-name');
  const gameChartCount = $('rhythm-chart-count');
  const gameEnergyFill = $('rhythm-energy-fill');
  const gameEnergyText = $('rhythm-energy-text');
  const gameRestart = $('rhythm-game-restart');
  const gameStudy = $('rhythm-game-study');

  const editorCover = $('rhythm-editor-cover');
  const editorTitle = $('rhythm-editor-title');
  const editorArtist = $('rhythm-editor-artist');
  const editorTime = $('rhythm-editor-time');
  const editorPlay = $('rhythm-editor-play');
  const editorBack = $('rhythm-editor-back');
  const editorForward = $('rhythm-editor-forward');
  const editorStage = $('rhythm-editor-stage');
  const editorGrid = $('rhythm-editor-grid');
  const editorCursor = $('rhythm-editor-cursor');
  const editorReadheadLabel = $('rhythm-editor-readhead-label');
  const rhythmSave = $('rhythm-save-chart');
  const rhythmExport = $('rhythm-export-chart');
  const rhythmImport = $('rhythm-import-chart');
  const rhythmImportInput = $('rhythm-import-input');
  const rhythmClear = $('rhythm-clear-chart');
  const rhythmKeyModeLabel = $('rhythm-key-mode-label');
  const rhythmKeyConfig = $('rhythm-key-config');
  const rhythmApplyMapping = $('rhythm-apply-mapping');
  const rhythmNoteList = $('rhythm-note-list');
  const rhythmNotesCount = $('rhythm-notes-count');

  const rhythmSettingsOpen = $('rhythm-settings-open');
  const rhythmSettingsModal = $('rhythm-settings-modal');
  const rhythmSettingsClose = $('rhythm-settings-close');
  const rhythmSettingsApply = $('rhythm-settings-apply');
  const rhythmSettingsReset = $('rhythm-settings-reset');
  const rhythmSettingsKeyConfig = $('rhythm-settings-key-config');
  const rhythmSettingsApplyMapping = $('rhythm-settings-apply-mapping');
  const rhythmScrollSpeedInput = $('rhythm-scroll-speed');
  const rhythmScrollSpeedValue = $('rhythm-scroll-speed-value');
  const rhythmOffsetInput = $('rhythm-offset');
  const rhythmOffsetValue = $('rhythm-offset-value');
  const rhythmMusicVolumeInput = $('rhythm-music-volume');
  const rhythmMusicVolumeValue = $('rhythm-music-volume-value');
  const rhythmSfxVolumeInput = $('rhythm-sfx-volume');
  const rhythmSfxVolumeValue = $('rhythm-sfx-volume-value');
  const rhythmAccentColorInput = $('rhythm-accent-color');

  const RYTHM_SETTING_KEY = 'glasstrack_rhythm_enabled';
  const RYTHM_GAME_SETTINGS_KEY = 'glasstrack_rhythm_game_settings';
  const RYTHM_MAPPING_KEY = 'glasstrack_rhythm_mapping';
  const RYTHM_TAB_KEY = 'glasstrack_rhythm_last_tab';
  const RYTHM_CHART_VERSION = 1;
  const JUDGEMENT_WINDOWS = [
    { name: 'Sick', max: 45, points: 350, accuracy: 1 },
    { name: 'Perfect', max: 70, points: 300, accuracy: 0.98 },
    { name: 'Good', max: 105, points: 180, accuracy: 0.80 },
    { name: 'Bad', max: 150, points: 60, accuracy: 0.45 }
  ];
  const MISS_WINDOW = 190;
  const SPAWN_WINDOW = 1800;

  const DEFAULT_MAPPINGS = {
    '2k': ['KeyD', 'KeyK'],
    '4k': ['KeyS', 'KeyD', 'KeyK', 'KeyL']
  };
  const DEFAULT_RHYTHM_GAME_SETTINGS = {
    scrollSpeed: 1,
    offsetMs: 0,
    musicVolume: 1,
    sfxVolume: 0.65,
    layout: 'window',
    accentColor: '#9aa3ad'
  };

  let rhythmGameSettings = { ...DEFAULT_RHYTHM_GAME_SETTINGS };
  try {
    const savedSettings = JSON.parse(localStorage.getItem(RYTHM_GAME_SETTINGS_KEY) || 'null');
    if (savedSettings && typeof savedSettings === 'object') {
      rhythmGameSettings = {
        ...DEFAULT_RHYTHM_GAME_SETTINGS,
        ...savedSettings
      };
      rhythmGameSettings.scrollSpeed = Math.max(0.5, Math.min(2.5, Number(rhythmGameSettings.scrollSpeed) || 1));
      rhythmGameSettings.offsetMs = Math.max(-250, Math.min(250, Number(rhythmGameSettings.offsetMs) || 0));
      rhythmGameSettings.musicVolume = Math.max(0, Math.min(1, Number(rhythmGameSettings.musicVolume) ?? 1));
      rhythmGameSettings.sfxVolume = Math.max(0, Math.min(1, Number(rhythmGameSettings.sfxVolume) ?? 0.65));
      rhythmGameSettings.layout = rhythmGameSettings.layout === 'centered' ? 'centered' : 'window';
      if (!/^#[0-9a-f]{6}$/i.test(String(rhythmGameSettings.accentColor || ''))) rhythmGameSettings.accentColor = DEFAULT_RHYTHM_GAME_SETTINGS.accentColor;
    }
  } catch (_) {}

  let rhythmEnabled = true;
  let rhythmOriginalPlaybackRate = null;
  try {
    const raw = localStorage.getItem(RYTHM_SETTING_KEY);
    if (raw === 'false') rhythmEnabled = false;
  } catch (_) {}

  let rhythmMappingMode = '2k';
  let rhythmMapping = [...DEFAULT_MAPPINGS['2k']];
  try {
    const saved = JSON.parse(localStorage.getItem(RYTHM_MAPPING_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      rhythmMappingMode = ['2k', '4k', 'custom'].includes(saved.mode) ? saved.mode : '2k';
      rhythmMapping = Array.isArray(saved.keys) && saved.keys.length >= 2 ? saved.keys.map(String) : [...DEFAULT_MAPPINGS['2k']];
    }
  } catch (_) {}

  let rhythmActiveTab = 'game';
  let chart = [];
  let chartLoadedForSongId = null;
  let chartDirty = false;
  let gameRunning = false;
  let gameRaf = null;
  let gameRoundId = 0;
  let gameNotes = [];
  let gameScore = 0;
  let gameCombo = 0;
  let gameEnergy = 100;
  let gameJudgedCount = 0;
  let gameAccuracyTotal = 0;
  let gameLastSongId = null;
  let editorRaf = null;
  const pressedKeys = new Set();
  const lastRecordedByLane = new Map();
  let editorSpeed = 1;
  let rhythmOriginalVolume = null;

  function hexToRgbString(hex) {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return '154, 163, 173';
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }

  function saveRhythmGameSettings() {
    try {
      localStorage.setItem(RYTHM_GAME_SETTINGS_KEY, JSON.stringify(rhythmGameSettings));
    } catch (_) {}
  }

  function applyRhythmGameSettings() {
    const rgb = hexToRgbString(rhythmGameSettings.accentColor);
    rhythmOverlay.style.setProperty('--dominant-rgb', rgb);
    rhythmOverlay.classList.toggle('is-centered', rhythmGameSettings.layout === 'centered');

    if (rhythmScrollSpeedInput) rhythmScrollSpeedInput.value = String(rhythmGameSettings.scrollSpeed);
    if (rhythmScrollSpeedValue) rhythmScrollSpeedValue.textContent = `${rhythmGameSettings.scrollSpeed.toFixed(2)}×`;
    if (rhythmOffsetInput) rhythmOffsetInput.value = String(rhythmGameSettings.offsetMs);
    if (rhythmOffsetValue) rhythmOffsetValue.textContent = `${rhythmGameSettings.offsetMs > 0 ? '+' : ''}${Math.round(rhythmGameSettings.offsetMs)} ms`;
    if (rhythmMusicVolumeInput) rhythmMusicVolumeInput.value = String(rhythmGameSettings.musicVolume);
    if (rhythmMusicVolumeValue) rhythmMusicVolumeValue.textContent = `${Math.round(rhythmGameSettings.musicVolume * 100)}%`;
    if (rhythmSfxVolumeInput) rhythmSfxVolumeInput.value = String(rhythmGameSettings.sfxVolume);
    if (rhythmSfxVolumeValue) rhythmSfxVolumeValue.textContent = `${Math.round(rhythmGameSettings.sfxVolume * 100)}%`;
    if (rhythmAccentColorInput) rhythmAccentColorInput.value = rhythmGameSettings.accentColor;
    document.querySelectorAll('.rhythm-layout-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.rhythmLayout === rhythmGameSettings.layout);
    });

    const audio = getRhythmAudio();
    if (audio && !rhythmOverlay.classList.contains('hidden') && rhythmOriginalVolume !== null) {
      try { audio.volume = rhythmGameSettings.musicVolume; } catch (_) {}
    }
  }

  function resetRhythmGameSettings() {
    rhythmGameSettings = { ...DEFAULT_RHYTHM_GAME_SETTINGS };
    saveRhythmGameSettings();
    applyRhythmGameSettings();
    rhythmNotify('Ajustes de juego restablecidos.');
  }

  function openRhythmSettings() {
    if (!rhythmSettingsModal) return;
    rhythmSettingsModal.classList.remove('hidden');
    rhythmSettingsModal.setAttribute('aria-hidden', 'false');
    renderMappingEditor();
  }

  function closeRhythmSettings() {
    if (!rhythmSettingsModal) return;
    rhythmSettingsModal.classList.add('hidden');
    rhythmSettingsModal.setAttribute('aria-hidden', 'true');
  }

  function syncRhythmSongIfChanged() {
    const song = getRhythmSong();
    const id = song?.id ?? null;
    if (id === lastObservedSongId && chartLoadedForSongId === id) return;
    lastObservedSongId = id;
    setSongMeta();
    loadRhythmChart(id);
    resetGameStats();
    lastRecordedByLane.clear();
    clearPressedKeys();
    gameLastSongId = id;
  }

  function playRhythmSfx(kind) {
    if (rhythmGameSettings.sfxVolume <= 0) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (typeof audioCtx !== 'undefined' && audioCtx) ? audioCtx : new Ctx();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const freq = kind === 'Miss' ? 130 : kind === 'Sick' ? 880 : kind === 'Perfect' ? 720 : kind === 'Good' ? 560 : 380;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(100, freq * 0.72), now + 0.07);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.045 * rhythmGameSettings.sfxVolume), now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch (_) {}
  }

  function clearPressedKeys() {
    pressedKeys.clear();
    if (gameKeyRow) {
      gameKeyRow.querySelectorAll('.rhythm-key.is-down').forEach(el => el.classList.remove('is-down'));
    }
  }

  function setGameplayKeyVisual(code, isDown) {
    if (!gameKeyRow) return;
    gameKeyRow.querySelectorAll('.rhythm-key').forEach(key => {
      if (key.dataset.code === code) key.classList.toggle('is-down', isDown);
    });
  }

  function getMappingFromContainer(container) {
    if (!container) return null;
    const inputs = Array.from(container.querySelectorAll('.rhythm-key-input'));
    const values = inputs.map(input => String(input.value || '').trim()).filter(Boolean);
    if (!values.length || values.some(value => value === 'Presiona tecla...')) return null;
    if (values.length < 2 || new Set(values).size !== values.length) return null;
    return values;
  }

  function getRhythmAudio() {
    return typeof activeAudio !== 'undefined' && activeAudio ? activeAudio : null;
  }

  function getRhythmSong() {
    try {
      if (Array.isArray(songList) && songList.length && Number.isInteger(currentIndex)) {
        return songList[currentIndex] || null;
      }
    } catch (_) {}
    return null;
  }

  function setRhythmEnabled(enabled) {
    rhythmEnabled = !!enabled;
    try { localStorage.setItem(RYTHM_SETTING_KEY, rhythmEnabled ? 'true' : 'false'); } catch (_) {}
    if (toggleRhythm) toggleRhythm.checked = rhythmEnabled;
    if (toggleRhythmDetail) toggleRhythmDetail.checked = rhythmEnabled;
    if (!rhythmEnabled && !rhythmOverlay.classList.contains('hidden')) closeRhythm();
  }

  function formatRhythmMs(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n < 0) return '0.000 ms';
    return `${(n * 1000).toFixed(3)} ms`;
  }

  function formatRhythmClock(sec) {
    const n = Math.max(0, Number(sec) || 0);
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    const ms = Math.floor((n % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function rhythmNotify(text) {
    if (typeof showToast === 'function') {
      showToast(text, 'info');
    }
  }

  function getDominantAccentVars() {
    try {
      const styles = getComputedStyle(document.documentElement);
      return styles.getPropertyValue('--dominant-rgb').trim() || '138, 153, 173';
    } catch (_) {
      return '138, 153, 173';
    }
  }

  function setSongMeta() {
    const song = getRhythmSong();
    if (!song) {
      [songCover, editorCover].forEach(img => { if (img) img.removeAttribute('src'); });
      [songTitle, editorTitle].forEach(el => { if (el) el.textContent = 'Sin canción'; });
      [songArtist, editorArtist].forEach(el => { if (el) el.textContent = 'Selecciona una canción para empezar'; });
      if (songStatus) songStatus.textContent = 'SIN CANCIÓN';
      return;
    }
    const coverSrc = song.cover || '';
    [songCover, editorCover].forEach(img => { if (img) { img.src = coverSrc; img.style.opacity = coverSrc ? '1' : '.35'; } });
    if (songTitle) songTitle.textContent = song.title || 'Sin título';
    if (songArtist) songArtist.textContent = song.artist || 'Artista desconocido';
    if (editorTitle) editorTitle.textContent = song.title || 'Sin título';
    if (editorArtist) editorArtist.textContent = song.artist || 'Artista desconocido';
  }

  function getChartRecordFromState(songId) {
    return {
      songId,
      version: RYTHM_CHART_VERSION,
      title: getRhythmSong()?.title || 'Sin título',
      artist: getRhythmSong()?.artist || 'Artista desconocido',
      mappingMode: rhythmMappingMode,
      mapping: [...rhythmMapping],
      notes: chart.map((n, index) => ({
        id: n.id || `n_${index}_${Math.round(n.time * 1000)}`,
        time: Math.max(0, Number(n.time) || 0),
        lane: Math.max(0, Math.min(rhythmMapping.length - 1, Number(n.lane) || 0))
      })).sort((a, b) => a.time - b.time || a.lane - b.lane)
    };
  }

  function ensureChartStore() {
    return !!(typeof db !== 'undefined' && db && db.objectStoreNames.contains('charts'));
  }

  function loadRhythmChart(songId) {
    chart = [];
    chartLoadedForSongId = songId ?? null;
    chartDirty = false;
    if (!songId || !ensureChartStore()) {
      refreshChartUI();
      return;
    }
    try {
      const tx = db.transaction(['charts'], 'readonly');
      const req = tx.objectStore('charts').get(songId);
      req.onsuccess = () => {
        const record = req.result;
        if (record && Array.isArray(record.notes)) {
          if (Array.isArray(record.mapping) && record.mapping.length >= 2) {
            rhythmMapping = record.mapping.map(String);
            rhythmMappingMode = ['2k','4k','custom'].includes(record.mappingMode) ? record.mappingMode : (rhythmMapping.length === 4 ? '4k' : 'custom');
            saveRhythmMapping();
          }
          chart = record.notes.map((n, i) => ({
            id: String(n.id || `n_${i}_${Math.round((Number(n.time) || 0) * 1000)}`),
            time: Math.max(0, Number(n.time) || 0),
            lane: Math.max(0, Math.min(rhythmMapping.length - 1, Number(n.lane) || 0))
          })).sort((a,b) => a.time - b.time || a.lane - b.lane);
        }
        chartLoadedForSongId = songId;
        chartDirty = false;
        refreshChartUI();
        if (rhythmActiveTab === 'game') loadGameChart();
      };
      req.onerror = () => { refreshChartUI(); };
    } catch (error) {
      console.warn('No se pudo leer el chart de Glasstrack:', error);
      refreshChartUI();
    }
  }

  function saveRhythmChart(showMessage = true) {
    const song = getRhythmSong();
    if (!song || song.id == null) {
      rhythmNotify('Selecciona una canción antes de guardar un chart.');
      return false;
    }
    if (!ensureChartStore()) {
      rhythmNotify('La base de datos actual no tiene el almacenamiento de charts disponible. Recarga Glasstrack.');
      return false;
    }
    try {
      const record = getChartRecordFromState(song.id);
      const tx = db.transaction(['charts'], 'readwrite');
      tx.objectStore('charts').put(record);
      tx.oncomplete = () => {
        chartDirty = false;
        chartLoadedForSongId = song.id;
        updateRhythmStatus();
        if (showMessage) rhythmNotify('Chart guardado en IndexedDB para esta canción.');
      };
      tx.onerror = () => rhythmNotify('No se pudo guardar el chart.');
      return true;
    } catch (error) {
      console.error('Error guardando chart:', error);
      rhythmNotify('No se pudo guardar el chart.');
      return false;
    }
  }

  function updateRhythmStatus() {
    if (!songStatus) return;
    if (!getRhythmSong()) {
      songStatus.textContent = 'SIN CANCIÓN';
      return;
    }
    songStatus.textContent = `${chart.length} NOTAS${chartDirty ? ' • EDITANDO' : ' • GUARDADO'}`;
  }

  function saveRhythmMapping() {
    try {
      localStorage.setItem(RYTHM_MAPPING_KEY, JSON.stringify({ mode: rhythmMappingMode, keys: rhythmMapping }));
    } catch (_) {}
  }

  function renderMappingEditorInto(container) {
    if (!container) return;
    container.innerHTML = '';
    rhythmMapping.forEach((code, index) => {
      const row = document.createElement('div');
      row.className = 'rhythm-key-row-editor';
      const label = document.createElement('div');
      label.className = 'rhythm-key-lane-label';
      label.textContent = String(index + 1);
      const input = document.createElement('input');
      input.className = 'rhythm-key-input';
      input.dataset.lane = String(index);
      input.value = code;
      input.placeholder = 'Haz clic y presiona una tecla';
      input.title = 'Haz clic aquí y presiona la tecla que quieres usar en este carril';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.readOnly = true;
      input.setAttribute('aria-label', `Tecla del carril ${index + 1}`);
      input.addEventListener('focus', () => {
        input.classList.add('is-listening');
        input.value = 'Presiona tecla...';
      });
      input.addEventListener('blur', () => {
        input.classList.remove('is-listening');
        if (!input.value || input.value === 'Presiona tecla...') input.value = rhythmMapping[index] || '';
      });
      input.addEventListener('keydown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.code === 'Escape') {
          input.blur();
          return;
        }
        if (event.code === 'Tab') {
          input.blur();
          return;
        }
        const duplicateLane = Array.from(container.querySelectorAll('.rhythm-key-input'))
          .find(other => other !== input && other.value === event.code);
        if (duplicateLane) {
          rhythmNotify('Esa tecla ya está asignada a otro carril.');
          return;
        }
        input.value = event.code;
        input.classList.remove('is-listening');
        input.blur();
      });
      row.appendChild(label);
      row.appendChild(input);
      container.appendChild(row);
    });
  }

  function renderMappingEditor() {
    if (rhythmKeyModeLabel) rhythmKeyModeLabel.textContent = rhythmMappingMode.toUpperCase();
    renderMappingEditorInto(rhythmKeyConfig);
    renderMappingEditorInto(rhythmSettingsKeyConfig);
  }

  function setMappingPreset(mode) {
    rhythmMappingMode = ['2k', '4k', 'custom'].includes(mode) ? mode : '2k';
    if (rhythmMappingMode === '2k') rhythmMapping = [...DEFAULT_MAPPINGS['2k']];
    else if (rhythmMappingMode === '4k') rhythmMapping = [...DEFAULT_MAPPINGS['4k']];
    else if (!Array.isArray(rhythmMapping) || rhythmMapping.length < 2) rhythmMapping = [...DEFAULT_MAPPINGS['2k']];
    clearPressedKeys();
    lastRecordedByLane.clear();
    document.querySelectorAll('.rhythm-map-preset').forEach(btn => btn.classList.toggle('active', btn.dataset.rhythmMapping === rhythmMappingMode));
    renderMappingEditor();
    saveRhythmMapping();
    refreshChartUI();
  }

  function applyMappingFromContainer(container) {
    const values = getMappingFromContainer(container);
    if (!values) {
      rhythmNotify('Asigna una tecla diferente a cada carril antes de aplicar el mapeo.');
      return false;
    }
    clearPressedKeys();
    rhythmMapping = values;
    rhythmMappingMode = values.length === 2 && JSON.stringify(values) === JSON.stringify(DEFAULT_MAPPINGS['2k'])
      ? '2k'
      : (values.length === 4 && JSON.stringify(values) === JSON.stringify(DEFAULT_MAPPINGS['4k']) ? '4k' : 'custom');
    saveRhythmMapping();
    lastRecordedByLane.clear();
    document.querySelectorAll('.rhythm-map-preset').forEach(btn => btn.classList.toggle('active', btn.dataset.rhythmMapping === rhythmMappingMode));
    chart = chart.map(note => ({ ...note, lane: Math.min(note.lane, rhythmMapping.length - 1) }));
    chartDirty = true;
    renderMappingEditor();
    refreshChartUI();
    loadGameChart();
    rhythmNotify(`Mapeo aplicado: ${rhythmMapping.length}K.`);
    return true;
  }

  function applyCustomMappingFromUI() {
    applyMappingFromContainer(rhythmKeyConfig);
  }

  function refreshChartUI() {
    if (!editorGrid) return;
    const lanes = Math.max(2, rhythmMapping.length);
    editorGrid.style.setProperty('--rhythm-lanes', lanes);
    gameHighway.style.setProperty('--rhythm-lanes', lanes);
    gameLanes.style.setProperty('--rhythm-lanes', lanes);
    gameKeyRow.style.setProperty('--rhythm-lanes', lanes);
    editorGrid.innerHTML = '';
    for (let i = 0; i < lanes; i++) {
      const lane = document.createElement('div');
      lane.className = 'rhythm-editor-lane';
      lane.dataset.lane = String(i);
      lane.addEventListener('dblclick', (e) => {
        const rect = lane.getBoundingClientRect();
        const y = e.clientY - rect.top + editorStage.scrollTop;
        const seconds = editorYToSeconds(y);
        addChartNote(seconds, i);
      });
      editorGrid.appendChild(lane);
    }

    const duration = getRhythmAudio()?.duration;
    const total = Number.isFinite(duration) && duration > 0 ? duration : Math.max(chart.length ? chart[chart.length - 1].time + 2 : 10, 10);
    const rowHeight = 80;
    editorGrid.style.minHeight = `${Math.max(320, total * rowHeight)}px`;

    chart.forEach(note => renderEditorNote(note, total, rowHeight));
    renderNoteList();
    renderGameKeys();
    gameChartName.textContent = getRhythmSong()?.title || 'Sin chart';
    gameChartCount.textContent = `${chart.length} ${chart.length === 1 ? 'nota' : 'notas'}`;
    if (rhythmNotesCount) rhythmNotesCount.textContent = String(chart.length);
    updateRhythmStatus();
  }

  function editorYToSeconds(y) {
    const rowHeight = 80;
    return Math.max(0, y / rowHeight);
  }

  function secondsToEditorY(time) {
    return (Math.max(0, Number(time) || 0)) * 80;
  }

  function renderEditorNote(note, total, rowHeight) {
    const lanes = editorGrid.children;
    const lane = lanes[note.lane] || lanes[0];
    if (!lane) return;
    const el = document.createElement('div');
    el.className = 'rhythm-editor-note';
    el.dataset.noteId = note.id;
    el.style.top = `${secondsToEditorY(note.time)}px`;
    el.title = `${formatRhythmMs(note.time)} • Carril ${note.lane + 1}`;
    el.tabIndex = 0;
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      document.querySelectorAll('.rhythm-editor-note.selected').forEach(n => n.classList.remove('selected'));
      el.classList.add('selected');
      editorSeekTo(note.time);
    });
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      removeChartNote(note.id);
    });
    const label = document.createElement('span');
    label.className = 'rhythm-editor-note-label';
    label.textContent = `${Math.round(note.time * 1000)}ms`;
    el.appendChild(label);
    lane.appendChild(el);
  }

  function renderGameKeys() {
    if (!gameKeyRow) return;
    gameKeyRow.innerHTML = '';
    rhythmMapping.forEach((code, index) => {
      const key = document.createElement('div');
      key.className = 'rhythm-key';
      key.dataset.lane = String(index);
      key.dataset.code = code;
      key.textContent = humanizeKey(code);
      gameKeyRow.appendChild(key);
    });
  }

  function humanizeKey(code) {
    const map = {
      Numpad0: 'Num 0', Numpad1: 'Num 1', Numpad2: 'Num 2', Numpad3: 'Num 3', Numpad4: 'Num 4', Numpad5: 'Num 5', Numpad6: 'Num 6', Numpad7: 'Num 7', Numpad8: 'Num 8', Numpad9: 'Num 9',
      Space: 'SPACE', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', ControlRight: 'CTRL'
    };
    return map[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
  }

  function renderNoteList() {
    if (!rhythmNoteList) return;
    rhythmNoteList.innerHTML = '';
    if (!chart.length) {
      rhythmNoteList.innerHTML = '<div class="rhythm-empty-notes">Aún no hay notas. Reproduce la canción y usa las teclas mapeadas.</div>';
      return;
    }
    chart.forEach(note => {
      const row = document.createElement('div');
      row.className = 'rhythm-note-row';
      row.dataset.noteId = note.id;
      const time = document.createElement('input');
      time.type = 'number'; time.step = '1'; time.min = '0'; time.value = Math.round(note.time * 1000); time.title = 'Tiempo en milisegundos';
      const lane = document.createElement('input');
      lane.type = 'number'; lane.step = '1'; lane.min = '1'; lane.max = String(rhythmMapping.length); lane.value = note.lane + 1; lane.title = 'Carril';
      const key = document.createElement('div'); key.style.cssText = 'font:700 .52rem/1 Fira Code,monospace;color:rgba(255,255,255,.45);text-align:center;overflow:hidden;text-overflow:ellipsis'; key.textContent = humanizeKey(rhythmMapping[note.lane] || '');
      const del = document.createElement('button'); del.className = 'rhythm-note-delete'; del.type = 'button'; del.title = 'Eliminar nota'; del.textContent = '×';
      time.addEventListener('change', () => { note.time = Math.max(0, Number(time.value) / 1000 || 0); chartDirty = true; normalizeChart(); refreshChartUI(); });
      lane.addEventListener('change', () => { note.lane = Math.max(0, Math.min(rhythmMapping.length - 1, (parseInt(lane.value, 10) || 1) - 1)); chartDirty = true; normalizeChart(); refreshChartUI(); });
      del.addEventListener('click', () => removeChartNote(note.id));
      row.appendChild(time); row.appendChild(lane); row.appendChild(key); row.appendChild(del);
      rhythmNoteList.appendChild(row);
    });
  }

  function normalizeChart() {
    chart = chart
      .map((n, i) => ({ ...n, id: String(n.id || `n_${i}`), time: Math.max(0, Number(n.time) || 0), lane: Math.max(0, Math.min(rhythmMapping.length - 1, Number(n.lane) || 0)) }))
      .sort((a,b) => a.time - b.time || a.lane - b.lane);
  }

  function addChartNote(time, lane, fromRecording = false) {
    const audio = getRhythmAudio();
    const duration = audio?.duration;
    const t = Math.max(0, Number(time) || 0);
    if (Number.isFinite(duration) && duration > 0 && t > duration) return false;
    if (fromRecording) {
      const last = lastRecordedByLane.get(lane);
      if (last != null && (t - last) * 1000 < 80) return false;
      lastRecordedByLane.set(lane, t);
    }
    const exists = chart.some(n => n.lane === lane && Math.abs(n.time - t) < 0.018);
    if (exists) return false;
    chart.push({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, time: t, lane });
    normalizeChart();
    chartDirty = true;
    refreshChartUI();
    return true;
  }

  function removeChartNote(id) {
    chart = chart.filter(n => n.id !== id);
    chartDirty = true;
    refreshChartUI();
    loadGameChart();
  }

  function clearChart() {
    if (!chart.length) return;
    if (!confirm('¿Vaciar todas las notas del chart?')) return;
    chart = [];
    chartDirty = true;
    refreshChartUI();
    loadGameChart();
  }

  function stopEditorClock() {
    if (editorRaf) cancelAnimationFrame(editorRaf);
    editorRaf = null;
  }

  function startEditorClock() {
    stopEditorClock();
    const tick = () => {
      const audio = getRhythmAudio();
      if (rhythmOverlay.classList.contains('hidden') || rhythmActiveTab !== 'study' || !audio || audio.paused || audio.ended) {
        editorRaf = null;
        return;
      }
      updateEditorTime();
      editorRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  function bindAudioToRhythm() {
    const audios = [typeof audio1 !== 'undefined' ? audio1 : null, typeof audio2 !== 'undefined' ? audio2 : null].filter(Boolean);
    audios.forEach(audio => {
      audio.addEventListener('timeupdate', rhythmAudioTick, { passive: true });
      audio.addEventListener('loadedmetadata', () => {
        syncRhythmSongIfChanged();
        refreshChartUI();
        updateEditorTime();
      });
      audio.addEventListener('durationchange', () => {
        refreshChartUI();
        updateEditorTime();
      });
      audio.addEventListener('play', () => {
        syncRhythmSongIfChanged();
        if (rhythmActiveTab === 'game' && !gameRunning) startGameplay();
        else if (gameRunning) updateGameplay();
        updateEditorTime();
        if (rhythmActiveTab === 'study') startEditorClock();
      });
      audio.addEventListener('pause', () => {
        updateEditorTime();
        stopEditorClock();
        if (gameRunning) updateGameplay();
      });
      audio.addEventListener('seeking', () => {
        // Al hacer seek, reconstruimos desde el chart original para que las notas
        // limpiadas por memoria puedan volver a aparecer si se retrocede.
        clearPressedKeys();
        lastRecordedByLane.clear();
        loadGameChart();
        updateEditorTime();
        if (rhythmActiveTab === 'study' && !audio.paused) startEditorClock();
        if (gameRunning) updateGameplay();
      });
      audio.addEventListener('ended', () => {
        if (gameRunning) finishGameplay();
        clearPressedKeys();
        stopEditorClock();
        updateEditorTime();
      });
    });
  }

  function rhythmAudioTick() {
    const audio = getRhythmAudio();
    if (!audio) return;
    syncRhythmSongIfChanged();
    updateEditorTime();
    if (gameRunning) updateGameplay();
  }

  function updateEditorTime() {
    const audio = getRhythmAudio();
    const current = audio?.currentTime || 0;
    const duration = Number.isFinite(audio?.duration) ? audio.duration : 0;
    if (editorTime) editorTime.textContent = `${formatRhythmMs(current)}`;
    if (editorReadheadLabel) editorReadheadLabel.textContent = formatRhythmMs(current);
    if (gameTimeReadout) gameTimeReadout.textContent = `${formatRhythmClock(current)} / ${formatRhythmClock(duration)}`;
    if (gameProgressFill) gameProgressFill.style.width = duration > 0 ? `${Math.max(0, Math.min(100, current / duration * 100))}%` : '0%';
    if (editorCursor && editorStage) {
      const y = secondsToEditorY(current);
      editorCursor.style.top = `${Math.max(0, Math.min(editorStage.scrollHeight - 2, y))}px`;
    }
  }

  function editorSeekTo(seconds) {
    const audio = getRhythmAudio();
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : seconds, seconds));
    updateEditorTime();
  }

  function loadGameChart() {
    gameNotes = chart.map(n => ({ ...n, hit: false, missed: false }));
    gameNotes.sort((a,b) => a.time - b.time || a.lane - b.lane);
    renderGameLanes();
  }

  function renderGameLanes() {
    if (!gameLanes) return;
    gameLanes.innerHTML = '';
    rhythmMapping.forEach((_, laneIndex) => {
      const lane = document.createElement('div');
      lane.className = 'rhythm-lane';
      lane.dataset.lane = String(laneIndex);
      gameLanes.appendChild(lane);
    });
    gameHighway.style.setProperty('--rhythm-lanes', rhythmMapping.length);
    renderGameKeys();
  }

  function resetGameStats() {
    gameScore = 0;
    gameCombo = 0;
    gameEnergy = 100;
    gameJudgedCount = 0;
    gameAccuracyTotal = 0;
    updateGameStatsUI();
    if (gameFeedback) gameFeedback.textContent = 'Listo.';
  }

  function updateGameStatsUI() {
    if (gameScoreEl) gameScoreEl.textContent = Math.round(gameScore).toLocaleString('es-PE');
    if (gameComboEl) gameComboEl.textContent = String(gameCombo);
    const acc = gameJudgedCount ? (gameAccuracyTotal / gameJudgedCount * 100) : 100;
    if (gameAccuracyEl) gameAccuracyEl.textContent = `${acc.toFixed(2)}%`;
    if (gameEnergyFill) gameEnergyFill.style.width = `${Math.max(0, Math.min(100, gameEnergy))}%`;
    if (gameEnergyText) gameEnergyText.textContent = `${Math.round(gameEnergy)}%`;
  }

  function startGameplay(restart = false) {
    if (!rhythmEnabled) return;
    const audio = getRhythmAudio();
    if (!audio) return;
    if (restart) {
      try { audio.currentTime = 0; } catch (_) {}
      resetGameStats();
      loadGameChart();
    }
    gameRoundId += 1;
    gameRunning = true;
    gameLastSongId = getRhythmSong()?.id ?? null;
    if (gameRaf) cancelAnimationFrame(gameRaf);
    updateGameplay();
  }

  function finishGameplay() {
    gameRunning = false;
    if (gameRaf) cancelAnimationFrame(gameRaf);
    gameRaf = null;
    if (gameFeedback) gameFeedback.textContent = `Fin del chart • ${gameScore.toLocaleString('es-PE')} pts`;
  }

  function updateGameplay() {
    if (!gameRunning) return;
    const audio = getRhythmAudio();
    if (!audio || !gameLanes || !gameHighway) return;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const round = gameRoundId;
    const lanes = Array.from(gameLanes.children || []);
    lanes.forEach(lane => lane.querySelectorAll('.rhythm-note').forEach(el => el.remove()));

    // La posición de cada nota depende únicamente de audio.currentTime.
    // Scroll Speed modifica cuánto tiempo tarda en recorrer el highway, nunca crea
    // un reloj paralelo, por lo que pausar/seekear el audio recalcula la posición al instante.
    const travelSec = Math.max(0.35, (SPAWN_WINDOW / 1000) / rhythmGameSettings.scrollSpeed);
    const cleanupBefore = current - (MISS_WINDOW / 1000);

    for (let i = 0; i < gameNotes.length; i++) {
      const note = gameNotes[i];
      const delta = note.time - current;
      if (!note.hit && !note.missed && delta < -(MISS_WINDOW / 1000)) {
        note.missed = true;
        gameCombo = 0;
        gameEnergy = Math.max(0, gameEnergy - 4);
        gameJudgedCount += 1;
        showJudgement('Miss', false);
      playRhythmSfx('Miss');
        continue;
      }
      if (note.hit || note.missed || delta > travelSec) continue;
      const lane = lanes[note.lane];
      if (!lane) continue;
      const progress = Math.max(0, Math.min(1, 1 - delta / travelSec));
      const top = 6 + progress * 82;
      const el = document.createElement('div');
      el.className = 'rhythm-note';
      el.style.top = `${top}%`;
      lane.appendChild(el);
    }

    // Elimina del array las notas que ya pasaron el límite inferior de impacto.
    // Esto mantiene gameNotes acotado durante canciones largas.
    if (gameNotes.length > 256) {
      gameNotes = gameNotes.filter(note => note.time >= cleanupBefore || (!note.hit && !note.missed));
    } else {
      gameNotes = gameNotes.filter(note => note.time >= cleanupBefore || (!note.hit && !note.missed));
    }

    if (duration > 0 && gameProgressFill) gameProgressFill.style.width = `${Math.max(0, Math.min(100, current / duration * 100))}%`;
    if (gameLastSongId !== (getRhythmSong()?.id ?? null)) {
      syncRhythmSongIfChanged();
      loadGameChart();
      resetGameStats();
      gameLastSongId = getRhythmSong()?.id ?? null;
    }
    if (audio.paused || audio.ended) {
      if (gameRaf) cancelAnimationFrame(gameRaf);
      gameRaf = null;
      return;
    }
    gameRaf = requestAnimationFrame(() => {
      if (round === gameRoundId) updateGameplay();
    });
  }

  function findBestHittableNote(lane) {
    const audio = getRhythmAudio();
    if (!audio) return null;
    const adjustedNowMs = audio.currentTime * 1000 + rhythmGameSettings.offsetMs;
    let best = null;
    let bestDiff = Infinity;
    for (const note of gameNotes) {
      if (note.hit || note.missed || note.lane !== lane) continue;
      const diff = Math.abs(note.time * 1000 - adjustedNowMs);
      if (diff <= MISS_WINDOW && diff < bestDiff) {
        best = note;
        bestDiff = diff;
      }
    }
    return best ? { note: best, diff: bestDiff } : null;
  }

  function judgeLane(lane) {
    if (!gameRunning) return;
    const found = findBestHittableNote(lane);
    if (!found) return;
    const judgement = JUDGEMENT_WINDOWS.find(item => found.diff <= item.max);
    found.note.hit = true;
    if (!judgement) {
      gameCombo = 0;
      gameEnergy = Math.max(0, gameEnergy - 3);
      gameJudgedCount += 1;
      showJudgement('Bad', false);
      playRhythmSfx('Bad');
    } else {
      gameCombo += 1;
      gameEnergy = Math.min(100, gameEnergy + (judgement.name === 'Sick' ? 1.7 : .8));
      const multiplier = 1 + Math.min(2, gameCombo / 40);
      gameScore += Math.round(judgement.points * multiplier);
      gameJudgedCount += 1;
      gameAccuracyTotal += judgement.accuracy;
      showJudgement(judgement.name, true, found.diff);
      playRhythmSfx(judgement.name);
    }
    updateGameStatsUI();
  }

  let judgementTimer = 0;
  function showJudgement(text, good = true, diff = null) {
    if (!gameJudgement) return;
    if (judgementTimer) clearTimeout(judgementTimer);
    gameJudgement.className = 'rhythm-judgement';
    gameJudgement.textContent = diff == null ? text : `${text}  ${Math.round(diff)}ms`;
    gameJudgement.style.color = good ? `rgb(${getDominantAccentVars()})` : '#ff7777';
    void gameJudgement.offsetWidth;
    gameJudgement.classList.add('show');
    judgementTimer = setTimeout(() => gameJudgement.classList.remove('show'), 420);
    if (gameFeedback) gameFeedback.textContent = diff == null ? text : `${text} • ±${Math.round(diff)} ms`;
  }

  function openRhythm(tab = 'game') {
    if (!rhythmEnabled) {
      rhythmNotify('El Modo Ritmo está desactivado en Ajustes.');
      return;
    }
    const currentAudio = getRhythmAudio();
    if (rhythmOriginalPlaybackRate === null && currentAudio) {
      rhythmOriginalPlaybackRate = Number.isFinite(currentAudio.playbackRate) ? currentAudio.playbackRate : 1;
    }
    if (rhythmOriginalVolume === null && currentAudio) {
      rhythmOriginalVolume = Number.isFinite(currentAudio.volume) ? currentAudio.volume : 1;
    }
    rhythmOverlay.classList.remove('hidden');
    rhythmOverlay.setAttribute('aria-hidden', 'false');
    setRhythmTab(tab, false);
    setSongMeta();
    const song = getRhythmSong();
    if (song?.id !== chartLoadedForSongId) loadRhythmChart(song?.id ?? null);
    else refreshChartUI();
    if (typeof syncMetadata === 'function') { try { syncMetadata(); } catch (_) {} }
    applyRhythmGameSettings();
    const rhythmAudio = getRhythmAudio();
    if (rhythmAudio) { try { rhythmAudio.volume = rhythmGameSettings.musicVolume; } catch (_) {} }
    try { localStorage.setItem(RYTHM_TAB_KEY, tab); } catch (_) {}
    document.body.classList.add('rhythm-open');
    if (tab === 'game') {
      loadGameChart();
      startGameplay(false);
    }
  }

  function closeRhythm() {
    if (gameRunning) finishGameplay();
    const currentAudio = getRhythmAudio();
    if (currentAudio && rhythmOriginalPlaybackRate !== null) {
      try { currentAudio.playbackRate = rhythmOriginalPlaybackRate; } catch (_) {}
    }
    if (currentAudio && rhythmOriginalVolume !== null) {
      try { currentAudio.volume = rhythmOriginalVolume; } catch (_) {}
    }
    rhythmOriginalPlaybackRate = null;
    rhythmOriginalVolume = null;
    stopEditorClock();
    clearPressedKeys();
    closeRhythmSettings();
    rhythmOverlay.classList.add('hidden');
    rhythmOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('rhythm-open');
  }

  function setRhythmTab(tab, save = true) {
    rhythmActiveTab = tab === 'study' ? 'study' : 'game';
    const isGame = rhythmActiveTab === 'game';
    rhythmGameView.classList.toggle('active', isGame);
    rhythmStudyView.classList.toggle('active', !isGame);
    rhythmTabGame.classList.toggle('active', isGame);
    rhythmTabStudy.classList.toggle('active', !isGame);
    rhythmTabGame.setAttribute('aria-selected', String(isGame));
    rhythmTabStudy.setAttribute('aria-selected', String(!isGame));
    if (save) { try { localStorage.setItem(RYTHM_TAB_KEY, rhythmActiveTab); } catch (_) {} }
    if (isGame) {
      stopEditorClock();
      if (gameRunning) updateGameplay();
      else loadGameChart();
    } else {
      if (gameRunning) finishGameplay();
      renderMappingEditor();
      refreshChartUI();
      updateEditorTime();
      const audio = getRhythmAudio();
      if (audio && !audio.paused) startEditorClock();
    }
  }

  function openSettingsToRhythm() {
    // Abre el panel de categoría usando el mecanismo de ajustes existente.
    const settingsCard = document.querySelector('.setting-card-item[data-target="sub-rhythm-mode"]');
    if (settingsCard) settingsCard.click();
  }

  // --- UI de ajustes ---
  if (toggleRhythm) {
    toggleRhythm.checked = rhythmEnabled;
    toggleRhythm.addEventListener('change', () => setRhythmEnabled(toggleRhythm.checked));
  }
  if (toggleRhythmDetail) {
    toggleRhythmDetail.checked = rhythmEnabled;
    toggleRhythmDetail.addEventListener('change', () => setRhythmEnabled(toggleRhythmDetail.checked));
  }
  if (btnOpenRhythmGame) btnOpenRhythmGame.addEventListener('click', () => { if (typeof playSFX === 'function') playSFX('click'); openRhythm('game'); });
  if (btnOpenRhythmStudy) btnOpenRhythmStudy.addEventListener('click', () => { if (typeof playSFX === 'function') playSFX('click'); openRhythm('study'); });
  if (rhythmClose) rhythmClose.addEventListener('click', closeRhythm);
  if (rhythmTabGame) rhythmTabGame.addEventListener('click', () => setRhythmTab('game'));
  if (rhythmTabStudy) rhythmTabStudy.addEventListener('click', () => setRhythmTab('study'));
  if (gameStudy) gameStudy.addEventListener('click', () => setRhythmTab('study'));
  if (gameRestart) gameRestart.addEventListener('click', () => {
    const audio = getRhythmAudio();
    if (!audio) return;
    resetGameStats();
    loadGameChart();
    try { audio.currentTime = 0; } catch (_) {}
    audio.play().then(() => startGameplay(true)).catch(() => startGameplay(true));
  });

  document.querySelectorAll('.rhythm-map-preset').forEach(btn => {
    btn.addEventListener('click', () => setMappingPreset(btn.dataset.rhythmMapping || '2k'));
  });
  if (rhythmApplyMapping) rhythmApplyMapping.addEventListener('click', applyCustomMappingFromUI);

  // --- Ajustes avanzados del Modo Ritmo ---
  if (rhythmSettingsOpen) rhythmSettingsOpen.addEventListener('click', () => {
    if (typeof playSFX === 'function') playSFX('click');
    openRhythmSettings();
  });
  if (rhythmSettingsClose) rhythmSettingsClose.addEventListener('click', closeRhythmSettings);
  if (rhythmSettingsModal) rhythmSettingsModal.querySelectorAll('[data-rhythm-settings-close="true"]').forEach(el => el.addEventListener('click', closeRhythmSettings));
  if (rhythmScrollSpeedInput) rhythmScrollSpeedInput.addEventListener('input', () => {
    rhythmGameSettings.scrollSpeed = Math.max(0.5, Math.min(2.5, Number(rhythmScrollSpeedInput.value) || 1));
    saveRhythmGameSettings();
    applyRhythmGameSettings();
  });
  if (rhythmOffsetInput) rhythmOffsetInput.addEventListener('input', () => {
    rhythmGameSettings.offsetMs = Math.max(-250, Math.min(250, Number(rhythmOffsetInput.value) || 0));
    saveRhythmGameSettings();
    applyRhythmGameSettings();
  });
  if (rhythmMusicVolumeInput) rhythmMusicVolumeInput.addEventListener('input', () => {
    rhythmGameSettings.musicVolume = Math.max(0, Math.min(1, Number(rhythmMusicVolumeInput.value) || 0));
    saveRhythmGameSettings();
    applyRhythmGameSettings();
  });
  if (rhythmSfxVolumeInput) rhythmSfxVolumeInput.addEventListener('input', () => {
    rhythmGameSettings.sfxVolume = Math.max(0, Math.min(1, Number(rhythmSfxVolumeInput.value) || 0));
    saveRhythmGameSettings();
    applyRhythmGameSettings();
  });
  if (rhythmAccentColorInput) rhythmAccentColorInput.addEventListener('input', () => {
    rhythmGameSettings.accentColor = rhythmAccentColorInput.value;
    saveRhythmGameSettings();
    applyRhythmGameSettings();
  });
  document.querySelectorAll('.rhythm-layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      rhythmGameSettings.layout = btn.dataset.rhythmLayout === 'centered' ? 'centered' : 'window';
      saveRhythmGameSettings();
      applyRhythmGameSettings();
    });
  });
  document.querySelectorAll('.rhythm-settings-map-preset').forEach(btn => {
    btn.addEventListener('click', () => setMappingPreset(btn.dataset.rhythmMapping || '2k'));
  });
  if (rhythmSettingsApplyMapping) rhythmSettingsApplyMapping.addEventListener('click', () => applyMappingFromContainer(rhythmSettingsKeyConfig));
  if (rhythmSettingsReset) rhythmSettingsReset.addEventListener('click', resetRhythmGameSettings);
  if (rhythmSettingsApply) rhythmSettingsApply.addEventListener('click', () => {
    saveRhythmGameSettings();
    applyRhythmGameSettings();
    closeRhythmSettings();
    rhythmNotify('Ajustes del Modo Ritmo guardados.');
  });

  // --- Editor playback ---
  if (editorPlay) editorPlay.addEventListener('click', () => {
    const audio = getRhythmAudio();
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  });
  if (editorBack) editorBack.addEventListener('click', () => editorSeekTo((getRhythmAudio()?.currentTime || 0) - 5));
  if (editorForward) editorForward.addEventListener('click', () => editorSeekTo((getRhythmAudio()?.currentTime || 0) + 5));
  document.querySelectorAll('.rhythm-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = Number(btn.dataset.rhythmSpeed) || 1;
      editorSpeed = speed;
      document.querySelectorAll('.rhythm-speed-btn').forEach(b => b.classList.toggle('active', b === btn));
      const audio = getRhythmAudio();
      if (audio) audio.playbackRate = speed;
    });
  });

  // --- Chart persistence / export / import ---
  if (rhythmSave) rhythmSave.addEventListener('click', () => saveRhythmChart(true));
  if (rhythmExport) rhythmExport.addEventListener('click', () => {
    const song = getRhythmSong();
    if (!song) return rhythmNotify('Selecciona una canción antes de exportar.');
    const payload = getChartRecordFromState(song.id);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = (song.title || 'glasstrack-chart').replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'glasstrack-chart';
    a.href = url; a.download = `${safe}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    rhythmNotify('Chart exportado en JSON.');
  });
  if (rhythmImport) rhythmImport.addEventListener('click', () => rhythmImportInput?.click());
  if (rhythmImportInput) rhythmImportInput.addEventListener('change', async () => {
    const file = rhythmImportInput.files?.[0];
    rhythmImportInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !Array.isArray(payload.notes)) throw new Error('Formato de chart inválido');
      const importedMapping = Array.isArray(payload.mapping) && payload.mapping.length >= 2 ? payload.mapping.map(String) : null;
      if (importedMapping) {
        rhythmMapping = importedMapping;
        rhythmMappingMode = ['2k','4k','custom'].includes(payload.mappingMode) ? payload.mappingMode : 'custom';
        saveRhythmMapping();
        renderMappingEditor();
      }
      chart = payload.notes.map((n, i) => ({ id: String(n.id || `import_${i}`), time: Math.max(0, Number(n.time) || 0), lane: Math.max(0, Math.min(rhythmMapping.length - 1, Number(n.lane) || 0)) }));
      normalizeChart();
      chartDirty = true;
      refreshChartUI();
      loadGameChart();
      rhythmNotify(`Importadas ${chart.length} notas.`);
    } catch (error) {
      console.error(error);
      rhythmNotify('No se pudo importar el JSON del chart.');
    }
  });
  if (rhythmClear) rhythmClear.addEventListener('click', clearChart);

  // --- Teclado gameplay + grabación ---
  window.addEventListener('keydown', (e) => {
    const tag = String(e.target?.tagName || '').toUpperCase();
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;

    if (e.code === 'KeyX' && !e.ctrlKey && !e.altKey && !e.metaKey && !typing && !e.repeat) {
      e.preventDefault();
      rhythmOverlay.classList.contains('hidden') ? openRhythm('game') : closeRhythm();
      return;
    }

    if (rhythmOverlay.classList.contains('hidden')) return;

    if (e.code === 'Escape' && !e.repeat) {
      e.preventDefault();
      if (rhythmSettingsModal && !rhythmSettingsModal.classList.contains('hidden')) closeRhythmSettings();
      else closeRhythm();
      return;
    }

    // Las pulsaciones repetidas del sistema operativo nunca generan juicios ni notas.
    if (e.repeat) return;
    if (typing) return;

    if (rhythmActiveTab === 'study') {
      if (e.code === 'KeyL') {
        e.preventDefault();
        saveRhythmChart(true);
        return;
      }
      const lane = rhythmMapping.indexOf(e.code);
      if (lane !== -1) {
        e.preventDefault();
        const audio = getRhythmAudio();
        if (audio && !audio.paused) {
          const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
          if (addChartNote(t, lane, true)) {
            rhythmNotify(`Nota grabada: carril ${lane + 1} • ${formatRhythmMs(t)}`);
          }
        }
      }
      return;
    }

    const lane = rhythmMapping.indexOf(e.code);
    if (lane !== -1) {
      e.preventDefault();
      pressedKeys.add(e.code);
      setGameplayKeyVisual(e.code, true);
      judgeLane(lane);
    }
  }, true);

  window.addEventListener('keyup', (e) => {
    if (pressedKeys.has(e.code)) pressedKeys.delete(e.code);
    setGameplayKeyVisual(e.code, false);
  }, true);

  window.addEventListener('blur', clearPressedKeys);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearPressedKeys();
  });

  // --- Atajo global L para el editor sin chocar con inputs ---
  window.addEventListener('beforeunload', () => {
    if (chartDirty && rhythmOverlay && !rhythmOverlay.classList.contains('hidden')) {
      try { saveRhythmChart(false); } catch (_) {}
    }
  });

  // --- Sincronización con cambios de canción (sin temporizadores) ---
  let lastObservedSongId = null;

  // Sincronización inicial.
  setRhythmEnabled(rhythmEnabled);
  setMappingPreset(rhythmMappingMode);
  applyRhythmGameSettings();
  bindAudioToRhythm();
  setSongMeta();
  const startupSong = getRhythmSong();
  lastObservedSongId = startupSong?.id ?? null;
  if (startupSong) loadRhythmChart(startupSong.id);

  // Exponer una API pequeña para otros módulos de Glasstrack.
  window.glasstrackRhythm = {
    open: openRhythm,
    close: closeRhythm,
    setTab: setRhythmTab,
    saveChart: saveRhythmChart,
    loadChart: loadRhythmChart,
    syncSong: syncRhythmSongIfChanged,
    getChart: () => chart.map(n => ({ ...n })),
    enableAndOpen: (tab = 'game') => {
      if (!rhythmEnabled) setRhythmEnabled(true);
      openRhythm(tab);
    }
  };
})();

/* =========================================================
   GLASSTRACK PRO — STAGE MANAGER
   BLOQUE 3: JS
   Pegar al FINAL de script.js

   Módulo completamente independiente.

   IMPORTANTE:
   - NO crea AudioContext.
   - NO crea MediaElementSource.
   - NO reconecta <audio>.
   - Utiliza concludorAnalyser existente del reproductor.
   - Utiliza activeAudio/audio1/audio2 existentes cuando están disponibles.
   ========================================================= */

(function (window, document) {
  'use strict';

  class StageManager {
    constructor() {
      this.name = 'StageManager';
      this.version = '1.0.1';
      this.locked = true;

      this.dbName = 'GlasstrackStageDB';
      this.dbVersion = 1;
      this.storeName = 'stageState';
      this.stateKey = 'main';

      this.db = null;
      this.dbReady = false;

      this.rafId = null;
      this.resizeTimer = null;
      this.destroyed = false;

      this.backgroundObjectUrl = null;
      this.characterObjectUrl = null;

      this.dragState = {
        active: false,
        pointerId: null,
        startClientX: 0,
        startClientY: 0,
        startX: 50,
        startY: 70
      };

      this.resizeState = {
        active: false,
        pointerId: null,
        startClientX: 0,
        startClientY: 0,
        startScale: 100
      };

      this.audioData = null;
      this.frequencyData = null;
      this.lastBass = 0;
      this.lastMid = 0;
      this.lastEnergy = 0;
      this.smoothedBass = 0;
      this.smoothedMid = 0;
      this.smoothedEnergy = 0;
      this.lastBeat = 0;
      this.beatPulse = 0;

      this.particles = [];

      this.lyrics = [];
      this.activeLyricIndex = -1;
      this.lyricElements = [];

      this.defaults = {
        enabled: false,

        layers: {
          background: true,
          effects: true,
          character: true,
          lyrics: true,
          hud: true
        },

        background: {
          type: '',
          source: '',
          blob: null
        },

        character: {
          source: '',
          blob: null,
          x: 50,
          y: 70,
          scale: 100,
          rotation: 0,
          bounce: true
        },

        effects: {
          type: 'particles',
          particleCount: 90,
          sensitivity: 1,
          intensity: 1,
          speed: 1
        },

        reaction: {
          bass: 1,
          mid: 1,
          brightness: 0.7
        },

        lyrics: {
          mode: 'simple',
          text: ''
        }
      };

      this.state = this.cloneDefaults();

      this.dom = {};
      this.ctx = null;

      this.bound = {
        render: this.render.bind(this),
        resize: this.resizeCanvas.bind(this),
        dragMove: this.onDragMove.bind(this),
        dragEnd: this.onDragEnd.bind(this),
        resizeMove: this.onResizeMove.bind(this),
        resizeEnd: this.onResizeEnd.bind(this)
      };
    }

    /* -----------------------------------------------------
       UTILIDADES
       ----------------------------------------------------- */

    cloneDefaults() {
      return {
        enabled: this.defaults.enabled,

        layers: {
          ...this.defaults.layers
        },

        background: {
          ...this.defaults.background
        },

        character: {
          ...this.defaults.character
        },

        effects: {
          ...this.defaults.effects
        },

        reaction: {
          ...this.defaults.reaction
        },

        lyrics: {
          ...this.defaults.lyrics
        }
      };
    }

    clamp(value, min, max) {
      const n = Number(value);

      if (!Number.isFinite(n)) {
        return min;
      }

      return Math.min(max, Math.max(min, n));
    }

    safeNumber(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    lerp(current, target, amount) {
      return current + (target - current) * amount;
    }

    getActiveAudio() {
      try {
        if (
          typeof activeAudio !== 'undefined' &&
          activeAudio &&
          typeof activeAudio.currentTime === 'number'
        ) {
          return activeAudio;
        }
      } catch (_) {}

      try {
        if (
          typeof audio1 !== 'undefined' &&
          audio1 &&
          typeof audio1.currentTime === 'number'
        ) {
          return audio1;
        }
      } catch (_) {}

      try {
        if (
          typeof audio2 !== 'undefined' &&
          audio2 &&
          typeof audio2.currentTime === 'number'
        ) {
          return audio2;
        }
      } catch (_) {}

      return null;
    }

    /*
     * Obtiene el AnalalyserNode YA EXISTENTE del reproductor.
     *
     * No se crea AudioContext.
     * No se crea MediaElementSource.
     * No se conecta nuevamente ningún <audio>.
     */
    getExistingAnalyser() {
      try {
        if (
          typeof concludorAnalyser !== 'undefined' &&
          concludorAnalyser &&
          typeof concludorAnalyser.getByteFrequencyData === 'function'
        ) {
          return concludorAnalyser;
        }
      } catch (_) {}

      return null;
    }

    /* -----------------------------------------------------
       INICIALIZACIÓN
       ----------------------------------------------------- */

    async init() {
      if (this.destroyed) {
        return this;
      }

      this.cacheDom();
      this.bindEvents();

      this.frequencyData = null;

      await this.openDatabase();
      await this.loadState();

      this.applyStateToUI();
      this.applyLayerVisibility();
      this.applyBackground();
      this.applyCharacter();
      this.applyLyrics();

      this.resizeCanvas();

      if (this.locked) {
        this.state.enabled = false;
        if (this.dom.toggleMaster) {
          this.dom.toggleMaster.checked = false;
        }
      }

      return this;
    }

    cacheDom() {
      this.dom.root = document.getElementById('stage-manager');

      this.dom.backgroundLayer =
        document.getElementById('stage-background-layer');

      this.dom.backgroundVideo =
        document.getElementById('stage-background-video');

      this.dom.backgroundImage =
        document.getElementById('stage-background-image');

      this.dom.backgroundOverlay =
        document.getElementById('stage-background-overlay');

      this.dom.effectsLayer =
        document.getElementById('stage-effects-layer');

      this.dom.canvas =
        document.getElementById('stage-effects-canvas');

      this.dom.glow =
        document.getElementById('stage-stage-glow');

      this.dom.pulseRing =
        document.getElementById('stage-pulse-ring');

      this.dom.characterLayer =
        document.getElementById('stage-character-layer');

      this.dom.character =
        document.getElementById('stage-character');

      this.dom.characterImage =
        document.getElementById('stage-character-image');

      this.dom.characterGlow =
        document.querySelector('.stage-character-glow');

      this.dom.characterResize =
        document.getElementById('stage-character-resize');

      this.dom.lyricsLayer =
        document.getElementById('stage-lyrics-layer');

      this.dom.lyricsPanel =
        document.getElementById('stage-lyrics-panel');

      this.dom.lyricsContainer =
        document.getElementById('stage-lyrics-word-container');

      this.dom.hudLayer =
        document.getElementById('stage-hud');

      this.dom.settings =
        document.getElementById('stage-settings');

      this.dom.close =
        document.getElementById('stage-close-button');

      this.dom.openSettings =
        document.getElementById('stage-open-settings');

      this.dom.settingsClose =
        document.getElementById('stage-settings-close');

      this.dom.toggleMaster =
        document.getElementById('stage-toggle-master');

      this.dom.toggleBackground =
        document.getElementById('stage-toggle-background');

      this.dom.toggleEffects =
        document.getElementById('stage-toggle-effects');

      this.dom.toggleCharacter =
        document.getElementById('stage-toggle-character');

      this.dom.toggleLyrics =
        document.getElementById('stage-toggle-lyrics');

      this.dom.toggleHud =
        document.getElementById('stage-toggle-hud');

      this.dom.backgroundFile =
        document.getElementById('stage-background-file');

      this.dom.backgroundUrl =
        document.getElementById('stage-background-url');

      this.dom.backgroundClear =
        document.getElementById('stage-background-clear');

      this.dom.characterFile =
        document.getElementById('stage-character-file');

      this.dom.characterUrl =
        document.getElementById('stage-character-url');

      this.dom.characterX =
        document.getElementById('stage-character-x');

      this.dom.characterY =
        document.getElementById('stage-character-y');

      this.dom.characterScale =
        document.getElementById('stage-character-scale');

      this.dom.characterRotation =
        document.getElementById('stage-character-rotation');

      this.dom.toggleBounce =
        document.getElementById('stage-toggle-bounce');

      this.dom.characterReset =
        document.getElementById('stage-character-reset');

      this.dom.effectType =
        document.getElementById('stage-effect-type');

      this.dom.particleCount =
        document.getElementById('stage-particle-count');

      this.dom.particleCountValue =
        document.getElementById('stage-particle-count-value');

      this.dom.sensitivity =
        document.getElementById('stage-sensitivity');

      this.dom.sensitivityValue =
        document.getElementById('stage-sensitivity-value');

      this.dom.intensity =
        document.getElementById('stage-intensity');

      this.dom.intensityValue =
        document.getElementById('stage-intensity-value');

      this.dom.speed =
        document.getElementById('stage-speed');

      this.dom.speedValue =
        document.getElementById('stage-speed-value');

      this.dom.bassReact =
        document.getElementById('stage-bass-react');

      this.dom.bassReactValue =
        document.getElementById('stage-bass-react-value');

      this.dom.midReact =
        document.getElementById('stage-mid-react');

      this.dom.midReactValue =
        document.getElementById('stage-mid-react-value');

      this.dom.brightness =
        document.getElementById('stage-brightness');

      this.dom.brightnessValue =
        document.getElementById('stage-brightness-value');

      this.dom.lyricsMode =
        document.getElementById('stage-lyrics-mode');

      this.dom.lyricsInput =
        document.getElementById('stage-lyrics-input');

      this.dom.lyricsApply =
        document.getElementById('stage-lyrics-apply');

      this.dom.saveNow =
        document.getElementById('stage-save-now');

      this.dom.resetAll =
        document.getElementById('stage-reset-all');
    }

    bindEvents() {
      if (!this.dom.root) {
        return;
      }

      if (this.dom.close) {
        this.dom.close.addEventListener(
          'click',
          () => this.hide()
        );
      }

      if (this.dom.openSettings) {
        this.dom.openSettings.addEventListener(
          'click',
          () => this.toggleSettings()
        );
      }

      if (this.dom.settingsClose) {
        this.dom.settingsClose.addEventListener(
          'click',
          () => this.closeSettings()
        );
      }

      if (this.dom.toggleMaster) {
        this.dom.toggleMaster.addEventListener(
          'change',
          () => {
            if (this.locked) {
              this.state.enabled = false;
              this.dom.toggleMaster.checked = false;
              this.hide();
              return;
            }

            this.state.enabled =
              this.dom.toggleMaster.checked;

            if (this.state.enabled) {
              this.show();
            } else {
              this.hide();
            }

            this.saveState();
          }
        );
      }

      this.bindLayerSwitch(
        this.dom.toggleBackground,
        'background'
      );

      this.bindLayerSwitch(
        this.dom.toggleEffects,
        'effects'
      );

      this.bindLayerSwitch(
        this.dom.toggleCharacter,
        'character'
      );

      this.bindLayerSwitch(
        this.dom.toggleLyrics,
        'lyrics'
      );

      this.bindLayerSwitch(
        this.dom.toggleHud,
        'hud'
      );

      if (this.dom.backgroundFile) {
        this.dom.backgroundFile.addEventListener(
          'change',
          event => {
            const file = event.target.files &&
              event.target.files[0];

            if (file) {
              this.setBackgroundFile(file);
            }
          }
        );
      }

      if (this.dom.backgroundUrl) {
        this.dom.backgroundUrl.addEventListener(
          'change',
          () => {
            this.setBackgroundUrl(
              this.dom.backgroundUrl.value.trim()
            );
          }
        );
      }

      if (this.dom.backgroundClear) {
        this.dom.backgroundClear.addEventListener(
          'click',
          () => this.clearBackground()
        );
      }

      if (this.dom.characterFile) {
        this.dom.characterFile.addEventListener(
          'change',
          event => {
            const file = event.target.files &&
              event.target.files[0];

            if (file) {
              this.setCharacterFile(file);
            }
          }
        );
      }

      if (this.dom.characterUrl) {
        this.dom.characterUrl.addEventListener(
          'change',
          () => {
            this.setCharacterUrl(
              this.dom.characterUrl.value.trim()
            );
          }
        );
      }

      this.bindNumericControl(
        this.dom.characterX,
        value => {
          this.state.character.x =
            this.clamp(value, 0, 100);

          this.applyCharacterTransform();
          this.saveState();
        }
      );

      this.bindNumericControl(
        this.dom.characterY,
        value => {
          this.state.character.y =
            this.clamp(value, 0, 100);

          this.applyCharacterTransform();
          this.saveState();
        }
      );

      this.bindNumericControl(
        this.dom.characterScale,
        value => {
          this.state.character.scale =
            this.clamp(value, 5, 300);

          this.applyCharacterTransform();
          this.saveState();
        }
      );

      this.bindNumericControl(
        this.dom.characterRotation,
        value => {
          this.state.character.rotation =
            this.clamp(value, -180, 180);

          this.applyCharacterTransform();
          this.saveState();
        }
      );

      if (this.dom.toggleBounce) {
        this.dom.toggleBounce.addEventListener(
          'change',
          () => {
            this.state.character.bounce =
              this.dom.toggleBounce.checked;

            this.saveState();
          }
        );
      }

      if (this.dom.characterReset) {
        this.dom.characterReset.addEventListener(
          'click',
          () => this.resetCharacter()
        );
      }

      this.bindRangeControl(
        this.dom.particleCount,
        this.dom.particleCountValue,
        value => {
          this.state.effects.particleCount =
            this.clamp(value, 10, 250);

          this.rebuildParticles();
          this.saveState();
        },
        value => String(Math.round(value))
      );

      this.bindRangeControl(
        this.dom.sensitivity,
        this.dom.sensitivityValue,
        value => {
          this.state.effects.sensitivity =
            this.clamp(value, 0.1, 3);

          this.saveState();
        },
        value => Number(value).toFixed(2)
      );

      this.bindRangeControl(
        this.dom.intensity,
        this.dom.intensityValue,
        value => {
          this.state.effects.intensity =
            this.clamp(value, 0, 2);

          this.saveState();
        },
        value => Number(value).toFixed(2)
      );

      this.bindRangeControl(
        this.dom.speed,
        this.dom.speedValue,
        value => {
          this.state.effects.speed =
            this.clamp(value, 0.1, 3);

          this.saveState();
        },
        value => Number(value).toFixed(2)
      );

      this.bindRangeControl(
        this.dom.bassReact,
        this.dom.bassReactValue,
        value => {
          this.state.reaction.bass =
            this.clamp(value, 0, 2);

          this.saveState();
        },
        value => Number(value).toFixed(2)
      );

      this.bindRangeControl(
        this.dom.midReact,
        this.dom.midReactValue,
        value => {
          this.state.reaction.mid =
            this.clamp(value, 0, 2);

          this.saveState();
        },
        value => Number(value).toFixed(2)
      );

      this.bindRangeControl(
        this.dom.brightness,
        this.dom.brightnessValue,
        value => {
          this.state.reaction.brightness =
            this.clamp(value, 0.2, 1.5);

          this.saveState();
        },
        value => Number(value).toFixed(2)
      );

      if (this.dom.effectType) {
        this.dom.effectType.addEventListener(
          'change',
          () => {
            this.state.effects.type =
              this.dom.effectType.value;

            this.rebuildParticles();
            this.saveState();
          }
        );
      }

      if (this.dom.lyricsMode) {
        this.dom.lyricsMode.addEventListener(
          'change',
          () => {
            this.state.lyrics.mode =
              this.dom.lyricsMode.value;

            this.applyLyricsMode();
            this.saveState();
          }
        );
      }

      if (this.dom.lyricsApply) {
        this.dom.lyricsApply.addEventListener(
          'click',
          () => {
            this.state.lyrics.text =
              this.dom.lyricsInput
                ? this.dom.lyricsInput.value
                : '';

            this.parseLyrics();
            this.applyLyrics();
            this.saveState();
          }
        );
      }

      if (this.dom.saveNow) {
        this.dom.saveNow.addEventListener(
          'click',
          () => this.saveState()
        );
      }

      if (this.dom.resetAll) {
        this.dom.resetAll.addEventListener(
          'click',
          () => this.resetAll()
        );
      }

      this.bindCharacterPointerEvents();

      window.addEventListener(
        'resize',
        this.bound.resize,
        { passive: true }
      );
    }

    bindLayerSwitch(input, layerName) {
      if (!input) {
        return;
      }

      input.addEventListener(
        'change',
        () => {
          this.state.layers[layerName] =
            input.checked;

          this.applyLayerVisibility();
          this.saveState();
        }
      );
    }

    bindNumericControl(input, callback) {
      if (!input) {
        return;
      }

      const update = () => {
        callback(
          this.safeNumber(
            input.value,
            Number(input.defaultValue || 0)
          )
        );
      };

      input.addEventListener('input', update);
      input.addEventListener('change', update);
    }

    bindRangeControl(
      input,
      output,
      callback,
      formatter
    ) {
      if (!input) {
        return;
      }

      const update = () => {
        const value =
          this.safeNumber(input.value, 0);

        if (output) {
          output.textContent =
            formatter(value);
        }

        callback(value);
      };

      input.addEventListener('input', update);
      input.addEventListener('change', update);
    }

    /* -----------------------------------------------------
       INDEXEDDB
       ----------------------------------------------------- */

    openDatabase() {
      return new Promise(resolve => {
        if (!window.indexedDB) {
          this.dbReady = false;
          resolve(false);
          return;
        }

        let request;

        try {
          request = window.indexedDB.open(
            this.dbName,
            this.dbVersion
          );
        } catch (_) {
          this.dbReady = false;
          resolve(false);
          return;
        }

        request.onupgradeneeded = event => {
          const database = event.target.result;

          if (!database.objectStoreNames.contains(
            this.storeName
          )) {
            database.createObjectStore(
              this.storeName,
              { keyPath: 'id' }
            );
          }
        };

        request.onsuccess = event => {
          this.db = event.target.result;
          this.dbReady = true;
          resolve(true);
        };

        request.onerror = () => {
          this.dbReady = false;
          resolve(false);
        };

        request.onblocked = () => {
          this.dbReady = false;
          resolve(false);
        };
      });
    }

    async saveState() {
      const serializableState = {
        id: this.stateKey,

        enabled: Boolean(this.state.enabled),

        layers: {
          ...this.state.layers
        },

        background: {
          type: this.state.background.type,
          source: this.state.background.source,
          blob: this.state.background.blob || null
        },

        character: {
          source: this.state.character.source,
          blob: this.state.character.blob || null,
          x: this.clamp(
            this.state.character.x,
            0,
            100
          ),
          y: this.clamp(
            this.state.character.y,
            0,
            100
          ),
          scale: this.clamp(
            this.state.character.scale,
            5,
            300
          ),
          rotation: this.clamp(
            this.state.character.rotation,
            -180,
            180
          ),
          bounce: Boolean(
            this.state.character.bounce
          )
        },

        effects: {
          ...this.state.effects
        },

        reaction: {
          ...this.state.reaction
        },

        lyrics: {
          ...this.state.lyrics
        },

        updatedAt: Date.now()
      };

      if (!this.dbReady || !this.db) {
        return false;
      }

      return new Promise(resolve => {
        try {
          const transaction =
            this.db.transaction(
              this.storeName,
              'readwrite'
            );

          const store =
            transaction.objectStore(
              this.storeName
            );

          store.put(serializableState);

          transaction.oncomplete = () => {
            resolve(true);
          };

          transaction.onerror = () => {
            resolve(false);
          };

          transaction.onabort = () => {
            resolve(false);
          };
        } catch (_) {
          resolve(false);
        }
      });
    }

    async loadState() {
      if (!this.dbReady || !this.db) {
        this.state = this.cloneDefaults();
        return false;
      }

      return new Promise(resolve => {
        try {
          const transaction =
            this.db.transaction(
              this.storeName,
              'readonly'
            );

          const store =
            transaction.objectStore(
              this.storeName
            );

          const request =
            store.get(this.stateKey);

          request.onsuccess = () => {
            const saved = request.result;

            if (!saved) {
              this.state = this.cloneDefaults();
              resolve(false);
              return;
            }

            this.state = this.mergeState(
              this.cloneDefaults(),
              saved
            );

            resolve(true);
          };

          request.onerror = () => {
            this.state = this.cloneDefaults();
            resolve(false);
          };
        } catch (_) {
          this.state = this.cloneDefaults();
          resolve(false);
        }
      });
    }

    mergeState(base, saved) {
      const result = {
        ...base,
        ...saved,

        layers: {
          ...base.layers,
          ...(saved.layers || {})
        },

        background: {
          ...base.background,
          ...(saved.background || {})
        },

        character: {
          ...base.character,
          ...(saved.character || {})
        },

        effects: {
          ...base.effects,
          ...(saved.effects || {})
        },

        reaction: {
          ...base.reaction,
          ...(saved.reaction || {})
        },

        lyrics: {
          ...base.lyrics,
          ...(saved.lyrics || {})
        }
      };

      result.character.x =
        this.clamp(
          result.character.x,
          0,
          100
        );

      result.character.y =
        this.clamp(
          result.character.y,
          0,
          100
        );

      result.character.scale =
        this.clamp(
          result.character.scale,
          5,
          300
        );

      result.character.rotation =
        this.clamp(
          result.character.rotation,
          -180,
          180
        );

      result.effects.particleCount =
        this.clamp(
          result.effects.particleCount,
          10,
          250
        );

      return result;
    }

    /* -----------------------------------------------------
       UI / ESTADO
       ----------------------------------------------------- */

    applyStateToUI() {
      const s = this.state;

      if (this.dom.toggleMaster) {
        this.dom.toggleMaster.checked =
          Boolean(s.enabled);
      }

      if (this.dom.toggleBackground) {
        this.dom.toggleBackground.checked =
          Boolean(s.layers.background);
      }

      if (this.dom.toggleEffects) {
        this.dom.toggleEffects.checked =
          Boolean(s.layers.effects);
      }

      if (this.dom.toggleCharacter) {
        this.dom.toggleCharacter.checked =
          Boolean(s.layers.character);
      }

      if (this.dom.toggleLyrics) {
        this.dom.toggleLyrics.checked =
          Boolean(s.layers.lyrics);
      }

      if (this.dom.toggleHud) {
        this.dom.toggleHud.checked =
          Boolean(s.layers.hud);
      }

      if (this.dom.backgroundUrl) {
        this.dom.backgroundUrl.value =
          s.background.source || '';
      }

      if (this.dom.characterUrl) {
        this.dom.characterUrl.value =
          s.character.source || '';
      }

      if (this.dom.characterX) {
        this.dom.characterX.value =
          String(s.character.x);
      }

      if (this.dom.characterY) {
        this.dom.characterY.value =
          String(s.character.y);
      }

      if (this.dom.characterScale) {
        this.dom.characterScale.value =
          String(s.character.scale);
      }

      if (this.dom.characterRotation) {
        this.dom.characterRotation.value =
          String(s.character.rotation);
      }

      if (this.dom.toggleBounce) {
        this.dom.toggleBounce.checked =
          Boolean(s.character.bounce);
      }

      if (this.dom.effectType) {
        this.dom.effectType.value =
          s.effects.type;
      }

      if (this.dom.particleCount) {
        this.dom.particleCount.value =
          String(s.effects.particleCount);
      }

      if (this.dom.sensitivity) {
        this.dom.sensitivity.value =
          String(s.effects.sensitivity);
      }

      if (this.dom.intensity) {
        this.dom.intensity.value =
          String(s.effects.intensity);
      }

      if (this.dom.speed) {
        this.dom.speed.value =
          String(s.effects.speed);
      }

      if (this.dom.bassReact) {
        this.dom.bassReact.value =
          String(s.reaction.bass);
      }

      if (this.dom.midReact) {
        this.dom.midReact.value =
          String(s.reaction.mid);
      }

      if (this.dom.brightness) {
        this.dom.brightness.value =
          String(s.reaction.brightness);
      }

      if (this.dom.lyricsMode) {
        this.dom.lyricsMode.value =
          s.lyrics.mode;
      }

      if (this.dom.lyricsInput) {
        this.dom.lyricsInput.value =
          s.lyrics.text || '';
      }

      this.updateRangeOutputs();
    }

    updateRangeOutputs() {
      if (this.dom.particleCountValue) {
        this.dom.particleCountValue.textContent =
          String(
            Math.round(
              this.state.effects.particleCount
            )
          );
      }

      if (this.dom.sensitivityValue) {
        this.dom.sensitivityValue.textContent =
          Number(
            this.state.effects.sensitivity
          ).toFixed(2);
      }

      if (this.dom.intensityValue) {
        this.dom.intensityValue.textContent =
          Number(
            this.state.effects.intensity
          ).toFixed(2);
      }

      if (this.dom.speedValue) {
        this.dom.speedValue.textContent =
          Number(
            this.state.effects.speed
          ).toFixed(2);
      }

      if (this.dom.bassReactValue) {
        this.dom.bassReactValue.textContent =
          Number(
            this.state.reaction.bass
          ).toFixed(2);
      }

      if (this.dom.midReactValue) {
        this.dom.midReactValue.textContent =
          Number(
            this.state.reaction.mid
          ).toFixed(2);
      }

      if (this.dom.brightnessValue) {
        this.dom.brightnessValue.textContent =
          Number(
            this.state.reaction.brightness
          ).toFixed(2);
      }
    }

    applyLayerVisibility() {
      if (!this.dom.root) {
        return;
      }

      this.dom.root.classList.toggle(
        'stage-background-disabled',
        !this.state.layers.background
      );

      this.dom.root.classList.toggle(
        'stage-effects-disabled',
        !this.state.layers.effects
      );

      this.dom.root.classList.toggle(
        'stage-character-disabled',
        !this.state.layers.character
      );

      this.dom.root.classList.toggle(
        'stage-lyrics-disabled',
        !this.state.layers.lyrics
      );

      this.dom.root.classList.toggle(
        'stage-hud-disabled',
        !this.state.layers.hud
      );
    }

    /* -----------------------------------------------------
       VISIBILIDAD / RAF
       ----------------------------------------------------- */

    show() {
      if (
        this.locked ||
        this.destroyed ||
        !this.dom.root
      ) {
        return false;
      }

      this.state.enabled = true;

      if (this.dom.toggleMaster) {
        this.dom.toggleMaster.checked = true;
      }

      this.dom.root.classList.add(
        'stage-active'
      );

      this.applyLayerVisibility();

      this.rebuildParticles();
      this.resizeCanvas();

      /*
       * Arranca un único requestAnimationFrame.
       */
      this.startAnimation();

      this.saveState();
      return true;
    }

    hide() {
      this.state.enabled = false;

      if (this.dom.toggleMaster) {
        this.dom.toggleMaster.checked = false;
      }

      if (this.dom.root) {
        this.dom.root.classList.remove(
          'stage-active'
        );
      }

      /*
       * Cancelación inmediata del RAF.
       * Esto evita mantener consumo de CPU/GPU
       * cuando el escenario está oculto.
       */
      this.stopAnimation();

      this.closeSettings();

      this.resetVisualEffects();
      this.saveState();
    }

    startAnimation() {
      if (this.rafId !== null) {
        return;
      }

      if (
        !this.state.enabled ||
        this.destroyed
      ) {
        return;
      }

      this.rafId =
        window.requestAnimationFrame(
          this.bound.render
        );
    }

    stopAnimation() {
      if (this.rafId !== null) {
        window.cancelAnimationFrame(
          this.rafId
        );

        this.rafId = null;
      }
    }

    render(timestamp) {
      /*
       * Primero anulamos la referencia actual.
       * Así el siguiente frame se registra de forma
       * explícita y nunca quedan dos bucles simultáneos.
       */
      this.rafId = null;

      if (
        this.destroyed ||
        !this.state.enabled ||
        !this.dom.root ||
        !this.dom.root.classList.contains(
          'stage-active'
        )
      ) {
        return;
      }

      this.updateAudioData();
      this.updateBackgroundReaction();
      this.updateParticles(timestamp);
      this.updateCharacterReaction();
      this.updateLyricsReaction();
      this.updatePulseEffects();

      this.rafId =
        window.requestAnimationFrame(
          this.bound.render
        );
    }

    /* -----------------------------------------------------
       AUDIO — SOLO ANALYSER EXISTENTE
       ----------------------------------------------------- */

    updateAudioData() {
      const analyser =
        this.getExistingAnalyser();

      if (!analyser) {
        this.smoothedBass =
          this.lerp(
            this.smoothedBass,
            0,
            0.08
          );

        this.smoothedMid =
          this.lerp(
            this.smoothedMid,
            0,
            0.08
          );

        this.smoothedEnergy =
          this.lerp(
            this.smoothedEnergy,
            0,
            0.08
          );

        return;
      }

      try {
        const requiredLength =
          analyser.frequencyBinCount;

        if (
          !this.frequencyData ||
          this.frequencyData.length !==
            requiredLength
        ) {
          this.frequencyData =
            new Uint8Array(
              requiredLength
            );
        }

        analyser.getByteFrequencyData(
          this.frequencyData
        );

        const bass =
          this.getFrequencyAverage(
            analyser,
            50,
            250
          );

        const mid =
          this.getFrequencyAverage(
            analyser,
            250,
            2000
          );

        const energy =
          this.getFrequencyAverage(
            analyser,
            50,
            8000
          );

        const bassNormalized =
          this.clamp(
            bass / 255,
            0,
            1
          );

        const midNormalized =
          this.clamp(
            mid / 255,
            0,
            1
          );

        const energyNormalized =
          this.clamp(
            energy / 255,
            0,
            1
          );

        this.smoothedBass =
          this.lerp(
            this.smoothedBass,
            bassNormalized,
            0.18
          );

        this.smoothedMid =
          this.lerp(
            this.smoothedMid,
            midNormalized,
            0.14
          );

        this.smoothedEnergy =
          this.lerp(
            this.smoothedEnergy,
            energyNormalized,
            0.12
          );

        /*
         * Detector sencillo de golpe.
         * No intenta reemplazar un beat detector profesional:
         * solo proporciona una reacción visual estable.
         */
        const beatThreshold =
          0.48 / Math.max(
            0.1,
            this.state.effects.sensitivity
          );

        if (
          this.smoothedBass > beatThreshold &&
          this.smoothedBass >
            this.lastBass + 0.045
        ) {
          this.beatPulse = 1;
          this.lastBeat =
            performance.now();
        }

        this.beatPulse =
          this.lerp(
            this.beatPulse,
            0,
            0.13
          );

        this.lastBass =
          this.smoothedBass;

        this.lastMid =
          this.smoothedMid;

        this.lastEnergy =
          this.smoothedEnergy;
      } catch (_) {}
    }

    getFrequencyAverage(
      analyser,
      minHz,
      maxHz
    ) {
      if (
        !this.frequencyData ||
        !analyser ||
        !analyser.context
      ) {
        return 0;
      }

      const sampleRate =
        analyser.context.sampleRate ||
        44100;

      const nyquist =
        sampleRate / 2;

      const binCount =
        analyser.frequencyBinCount;

      const minIndex =
        Math.max(
          0,
          Math.floor(
            minHz / nyquist * binCount
          )
        );

      const maxIndex =
        Math.min(
          binCount - 1,
          Math.ceil(
            maxHz / nyquist * binCount
          )
        );

      if (maxIndex < minIndex) {
        return 0;
      }

      let sum = 0;
      let count = 0;

      for (
        let i = minIndex;
        i <= maxIndex;
        i++
      ) {
        sum +=
          this.frequencyData[i] || 0;

        count++;
      }

      return count > 0
        ? sum / count
        : 0;
    }

    /* -----------------------------------------------------
       FONDO REACTIVO
       ----------------------------------------------------- */

    applyBackground() {
      const bg =
        this.state.background;

      this.releaseBackgroundObjectUrl();

      if (
        !bg ||
        (
          !bg.source &&
          !bg.blob
        )
      ) {
        this.clearBackgroundVisuals();
        return;
      }

      if (bg.blob) {
        try {
          this.backgroundObjectUrl =
            URL.createObjectURL(
              bg.blob
            );

          this.setBackgroundSource(
            this.backgroundObjectUrl,
            bg.type
          );

          return;
        } catch (_) {}
      }

      if (bg.source) {
        this.setBackgroundSource(
          bg.source,
          bg.type
        );
      }
    }

    setBackgroundSource(
      source,
      type
    ) {
      const normalizedType =
        type ||
        this.detectBackgroundType(
          source
        );

      const isVideo =
        normalizedType === 'video';

      const isImage =
        normalizedType === 'image' ||
        normalizedType === 'gif';

      if (isVideo) {
        if (this.dom.backgroundImage) {
          this.dom.backgroundImage.classList.remove(
            'stage-media-visible'
          );

          this.dom.backgroundImage.removeAttribute(
            'src'
          );
        }

        if (this.dom.backgroundVideo) {
          this.dom.backgroundVideo.src =
            source;

          this.dom.backgroundVideo.classList.add(
            'stage-media-visible'
          );

          this.dom.backgroundVideo.muted = true;
          this.dom.backgroundVideo.loop = true;
          this.dom.backgroundVideo.playsInline = true;

          const playPromise =
            this.dom.backgroundVideo.play();

          if (
            playPromise &&
            typeof playPromise.catch ===
              'function'
          ) {
            playPromise.catch(() => {});
          }
        }
      } else if (isImage) {
        if (this.dom.backgroundVideo) {
          this.dom.backgroundVideo.pause();

          this.dom.backgroundVideo.removeAttribute(
            'src'
          );

          this.dom.backgroundVideo.load();

          this.dom.backgroundVideo.classList.remove(
            'stage-media-visible'
          );
        }

        if (this.dom.backgroundImage) {
          this.dom.backgroundImage.src =
            source;

          this.dom.backgroundImage.classList.add(
            'stage-media-visible'
          );
        }
      }
    }

    detectBackgroundType(source) {
      const value =
        String(source || '')
          .toLowerCase()
          .split('?')[0]
          .split('#')[0];

      if (
        value.endsWith('.mp4') ||
        value.endsWith('.webm') ||
        value.startsWith('blob:')
      ) {
        return 'video';
      }

      if (value.endsWith('.gif')) {
        return 'gif';
      }

      return 'image';
    }

    async setBackgroundFile(file) {
      if (!file) {
        return;
      }

      const type =
        file.type.startsWith('video/')
          ? 'video'
          : file.type === 'image/gif'
            ? 'gif'
            : 'image';

      this.state.background = {
        type,
        source: '',
        blob: file
      };

      if (this.dom.backgroundUrl) {
        this.dom.backgroundUrl.value =
          '';
      }

      this.applyBackground();
      await this.saveState();
    }

    async setBackgroundUrl(url) {
      if (!url) {
        return;
      }

      const type =
        this.detectBackgroundType(url);

      this.state.background = {
        type,
        source: url,
        blob: null
      };

      this.applyBackground();
      await this.saveState();
    }

    async clearBackground() {
      this.releaseBackgroundObjectUrl();

      this.state.background = {
        type: '',
        source: '',
        blob: null
      };

      this.clearBackgroundVisuals();

      if (this.dom.backgroundUrl) {
        this.dom.backgroundUrl.value = '';
      }

      if (this.dom.backgroundFile) {
        this.dom.backgroundFile.value = '';
      }

      await this.saveState();
    }

    clearBackgroundVisuals() {
      if (this.dom.backgroundVideo) {
        this.dom.backgroundVideo.pause();

        this.dom.backgroundVideo.removeAttribute(
          'src'
        );

        this.dom.backgroundVideo.load();

        this.dom.backgroundVideo.classList.remove(
          'stage-media-visible'
        );
      }

      if (this.dom.backgroundImage) {
        this.dom.backgroundImage.removeAttribute(
          'src'
        );

        this.dom.backgroundImage.classList.remove(
          'stage-media-visible'
        );
      }
    }

    releaseBackgroundObjectUrl() {
      if (this.backgroundObjectUrl) {
        try {
          URL.revokeObjectURL(
            this.backgroundObjectUrl
          );
        } catch (_) {}

        this.backgroundObjectUrl = null;
      }
    }

    updateBackgroundReaction() {
      const video =
        this.dom.backgroundVideo;

      const image =
        this.dom.backgroundImage;

      const target =
        video &&
        video.classList.contains(
          'stage-media-visible'
        )
          ? video
          : image;

      if (!target) {
        return;
      }

      const sensitivity =
        this.state.effects.sensitivity;

      const bass =
        this.smoothedBass *
        this.state.reaction.bass *
        sensitivity;

      const mid =
        this.smoothedMid *
        this.state.reaction.mid *
        sensitivity;

      const energy =
        this.smoothedEnergy *
        sensitivity;

      const brightness =
        this.state.reaction.brightness +
        bass * 0.55 +
        mid * 0.15;

      const contrast =
        0.92 +
        energy * 0.38;

      const hue =
        (
          mid * 18 +
          bass * 8
        );

      const scale =
        1 +
        energy * 0.012;

      target.style.filter =
        [
          `brightness(${this.clamp(
            brightness,
            0.2,
            1.8
          )})`,
          `contrast(${this.clamp(
            contrast,
            0.7,
            1.6
          )})`,
          `hue-rotate(${hue.toFixed(2)}deg)`
        ].join(' ');

      target.style.transform =
        `translate3d(0,0,0) scale(${scale.toFixed(4)})`;
    }

    /* -----------------------------------------------------
       PERSONAJE
       ----------------------------------------------------- */

    applyCharacter() {
      this.applyCharacterTransform();

      this.releaseCharacterObjectUrl();

      const character =
        this.state.character;

      if (
        character.blob
      ) {
        try {
          this.characterObjectUrl =
            URL.createObjectURL(
              character.blob
            );

          this.setCharacterImageSource(
            this.characterObjectUrl
          );

          return;
        } catch (_) {}
      }

      if (character.source) {
        this.setCharacterImageSource(
          character.source
        );

        return;
      }

      if (this.dom.characterImage) {
        this.dom.characterImage.removeAttribute(
          'src'
        );
      }
    }

    setCharacterImageSource(source) {
      if (!this.dom.characterImage) {
        return;
      }

      this.dom.characterImage.src =
        source;
    }

    async setCharacterFile(file) {
      if (!file) {
        return;
      }

      if (
        !file.type.startsWith('image/')
      ) {
        return;
      }

      this.state.character.source = '';
      this.state.character.blob = file;

      if (this.dom.characterUrl) {
        this.dom.characterUrl.value = '';
      }

      this.applyCharacter();
      await this.saveState();
    }

    async setCharacterUrl(url) {
      if (!url) {
        return;
      }

      this.state.character.source =
        url;

      this.state.character.blob =
        null;

      this.applyCharacter();
      await this.saveState();
    }

    releaseCharacterObjectUrl() {
      if (this.characterObjectUrl) {
        try {
          URL.revokeObjectURL(
            this.characterObjectUrl
          );
        } catch (_) {}

        this.characterObjectUrl = null;
      }
    }

    applyCharacterTransform(
      beatScale = 1
    ) {
      if (!this.dom.character) {
        return;
      }

      const c =
        this.state.character;

      this.dom.character.style.setProperty(
        '--stage-character-x',
        String(c.x)
      );

      this.dom.character.style.setProperty(
        '--stage-character-y',
        String(c.y)
      );

      this.dom.character.style.setProperty(
        '--stage-character-scale',
        String(c.scale)
      );

      this.dom.character.style.setProperty(
        '--stage-character-rotation',
        String(c.rotation)
      );

      this.dom.character.style.setProperty(
        '--stage-character-beat-scale',
        String(beatScale)
      );
    }

    updateCharacterReaction() {
      if (
        !this.dom.character ||
        !this.state.layers.character
      ) {
        return;
      }

      if (!this.state.character.bounce) {
        this.applyCharacterTransform(1);
        return;
      }

      const beat =
        this.clamp(
          this.smoothedBass *
          this.state.effects.sensitivity *
          0.28,
          0,
          0.16
        );

      const bounce =
        1 + beat;

      this.applyCharacterTransform(
        bounce
      );

      if (this.dom.characterGlow) {
        const glowScale =
          0.9 +
          beat * 2.5;

        const glowOpacity =
          0.55 +
          beat * 2;

        this.dom.characterGlow.style.transform =
          `translate3d(0,0,0) scale(${glowScale.toFixed(3)})`;

        this.dom.characterGlow.style.opacity =
          String(
            this.clamp(
              glowOpacity,
              0.4,
              1
            )
          );
      }
    }

    resetCharacter() {
      const currentSource =
        this.state.character.source;

      const currentBlob =
        this.state.character.blob;

      this.state.character = {
        ...this.defaults.character,
        source: currentSource,
        blob: currentBlob
      };

      this.applyStateToUI();
      this.applyCharacter();

      this.saveState();
    }

    /* -----------------------------------------------------
       DRAG & DROP
       Coordenadas siempre en X/Y porcentuales.
       ----------------------------------------------------- */

    bindCharacterPointerEvents() {
      if (!this.dom.character) {
        return;
      }

      this.dom.character.addEventListener(
        'pointerdown',
        event => {
          if (
            event.button !== 0 &&
            event.pointerType !== 'touch'
          ) {
            return;
          }

          if (
            event.target ===
            this.dom.characterResize
          ) {
            return;
          }

          event.preventDefault();

          this.dragState.active = true;
          this.dragState.pointerId =
            event.pointerId;

          this.dragState.startClientX =
            event.clientX;

          this.dragState.startClientY =
            event.clientY;

          this.dragState.startX =
            this.state.character.x;

          this.dragState.startY =
            this.state.character.y;

          this.dom.character.classList.add(
            'stage-dragging'
          );

          try {
            this.dom.character.setPointerCapture(
              event.pointerId
            );
          } catch (_) {}
        }
      );

      this.dom.character.addEventListener(
        'pointermove',
        this.bound.dragMove
      );

      this.dom.character.addEventListener(
        'pointerup',
        this.bound.dragEnd
      );

      this.dom.character.addEventListener(
        'pointercancel',
        this.bound.dragEnd
      );

      if (this.dom.characterResize) {
        this.dom.characterResize.addEventListener(
          'pointerdown',
          event => {
            event.preventDefault();
            event.stopPropagation();

            this.resizeState.active =
              true;

            this.resizeState.pointerId =
              event.pointerId;

            this.resizeState.startClientX =
              event.clientX;

            this.resizeState.startClientY =
              event.clientY;

            this.resizeState.startScale =
              this.state.character.scale;

            try {
              this.dom.characterResize.setPointerCapture(
                event.pointerId
              );
            } catch (_) {}
          }
        );

        this.dom.characterResize.addEventListener(
          'pointermove',
          this.bound.resizeMove
        );

        this.dom.characterResize.addEventListener(
          'pointerup',
          this.bound.resizeEnd
        );

        this.dom.characterResize.addEventListener(
          'pointercancel',
          this.bound.resizeEnd
        );
      }
    }

    onDragMove(event) {
      if (
        !this.dragState.active ||
        event.pointerId !==
          this.dragState.pointerId
      ) {
        return;
      }

      const viewportWidth =
        window.innerWidth || 1;

      const viewportHeight =
        window.innerHeight || 1;

      const deltaX =
        (
          event.clientX -
          this.dragState.startClientX
        ) /
        viewportWidth *
        100;

      const deltaY =
        (
          event.clientY -
          this.dragState.startClientY
        ) /
        viewportHeight *
        100;

      /*
       * Guardamos porcentajes, no píxeles.
       */
      this.state.character.x =
        this.clamp(
          this.dragState.startX +
            deltaX,
          0,
          100
        );

      this.state.character.y =
        this.clamp(
          this.dragState.startY +
            deltaY,
          0,
          100
        );

      this.applyCharacterTransform();
      this.syncCharacterInputs();
    }

    onDragEnd(event) {
      if (
        event.pointerId !==
          this.dragState.pointerId
      ) {
        return;
      }

      this.dragState.active = false;
      this.dragState.pointerId = null;

      if (this.dom.character) {
        this.dom.character.classList.remove(
          'stage-dragging'
        );
      }

      this.syncCharacterInputs();
      this.saveState();
    }

    onResizeMove(event) {
      if (
        !this.resizeState.active ||
        event.pointerId !==
          this.resizeState.pointerId
      ) {
        return;
      }

      const viewportWidth =
        window.innerWidth || 1;

      const deltaX =
        event.clientX -
        this.resizeState.startClientX;

      const deltaScale =
        deltaX /
        viewportWidth *
        150;

      this.state.character.scale =
        this.clamp(
          this.resizeState.startScale +
            deltaScale,
          5,
          300
        );

      this.applyCharacterTransform();
      this.syncCharacterInputs();
    }

    onResizeEnd(event) {
      if (
        event.pointerId !==
          this.resizeState.pointerId
      ) {
        return;
      }

      this.resizeState.active = false;
      this.resizeState.pointerId = null;

      this.syncCharacterInputs();
      this.saveState();
    }

    syncCharacterInputs() {
      if (this.dom.characterX) {
        this.dom.characterX.value =
          String(
            Number(
              this.state.character.x
            ).toFixed(1)
          );
      }

      if (this.dom.characterY) {
        this.dom.characterY.value =
          String(
            Number(
              this.state.character.y
            ).toFixed(1)
          );
      }

      if (this.dom.characterScale) {
        this.dom.characterScale.value =
          String(
            Math.round(
              this.state.character.scale
            )
          );
      }

      if (this.dom.characterRotation) {
        this.dom.characterRotation.value =
          String(
            Math.round(
              this.state.character.rotation
            )
          );
      }
    }

    /* -----------------------------------------------------
       CANVAS
       ----------------------------------------------------- */

    resizeCanvas() {
      if (
        !this.dom.canvas
      ) {
        return;
      }

      const rect =
        this.dom.canvas.getBoundingClientRect();

      const dpr =
        Math.min(
          window.devicePixelRatio || 1,
          2
        );

      const width =
        Math.max(
          1,
          Math.floor(
            rect.width * dpr
          )
        );

      const height =
        Math.max(
          1,
          Math.floor(
            rect.height * dpr
          )
        );

      if (
        this.dom.canvas.width !== width ||
        this.dom.canvas.height !== height
      ) {
        this.dom.canvas.width =
          width;

        this.dom.canvas.height =
          height;
      }

      if (!this.ctx) {
        this.ctx =
          this.dom.canvas.getContext(
            '2d',
            {
              alpha: true,
              desynchronized: true
            }
          );
      }

      if (this.ctx) {
        this.ctx.setTransform(
          dpr,
          0,
          0,
          dpr,
          0,
          0
        );
      }

      this.rebuildParticles();
    }

    rebuildParticles() {
      const canvas =
        this.dom.canvas;

      if (!canvas) {
        return;
      }

      const rect =
        canvas.getBoundingClientRect();

      const width =
        Math.max(
          1,
          rect.width
        );

      const height =
        Math.max(
          1,
          rect.height
        );

      const desired =
        Math.round(
          this.state.effects.particleCount
        );

      const current =
        this.particles.length;

      if (current < desired) {
        for (
          let i = current;
          i < desired;
          i++
        ) {
          this.particles.push(
            this.createParticle(
              width,
              height
            )
          );
        }
      } else if (
        current > desired
      ) {
        this.particles.length =
          desired;
      }
    }

    createParticle(
      width,
      height
    ) {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx:
          (Math.random() - 0.5) *
          0.4,
        vy:
          (Math.random() - 0.5) *
          0.4,
        size:
          1 +
          Math.random() * 3,
        life:
          0.4 +
          Math.random() * 0.6,
        phase:
          Math.random() *
          Math.PI *
          2,
        alpha:
          0.2 +
          Math.random() * 0.7
      };
    }

    updateParticles(timestamp) {
      if (
        !this.state.layers.effects ||
        !this.dom.canvas ||
        !this.ctx
      ) {
        return;
      }

      const rect =
        this.dom.canvas.getBoundingClientRect();

      const width =
        rect.width;

      const height =
        rect.height;

      const dpr =
        Math.min(
          window.devicePixelRatio || 1,
          2
        );

      this.ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );

      this.ctx.clearRect(
        0,
        0,
        width,
        height
      );

      const type =
        this.state.effects.type;

      const intensity =
        this.state.effects.intensity;

      const speed =
        this.state.effects.speed;

      const sensitivity =
        this.state.effects.sensitivity;

      const energy =
        this.smoothedEnergy *
        sensitivity;

      const bass =
        this.smoothedBass *
        sensitivity;

      if (
        type === 'pulse' ||
        type === 'mixed'
      ) {
        this.drawPulseWave(
          width,
          height,
          energy,
          intensity
        );
      }

      if (
        type === 'sparkles' ||
        type === 'mixed'
      ) {
        this.drawSparkles(
          width,
          height,
          energy,
          intensity
        );
      }

      if (
        type === 'fire' ||
        type === 'particles' ||
        type === 'mixed'
      ) {
        this.drawParticles(
          width,
          height,
          energy,
          bass,
          speed,
          intensity,
          timestamp
        );
      }
    }

    drawParticles(
      width,
      height,
      energy,
      bass,
      speed,
      intensity,
      timestamp
    ) {
      const ctx =
        this.ctx;

      if (!ctx) {
        return;
      }

      const isFire =
        this.state.effects.type ===
        'fire';

      for (
        let i = 0;
        i < this.particles.length;
        i++
      ) {
        const p =
          this.particles[i];

        const motion =
          (
            0.25 +
            energy * 2
          ) *
          speed;

        if (isFire) {
          p.vy =
            -(
              0.3 +
              energy * 1.7
            ) *
            speed;

          p.vx +=
            Math.sin(
              timestamp * 0.002 +
              p.phase
            ) *
            0.01;

          p.y += p.vy;
          p.x += p.vx;

          p.size =
            1.5 +
            Math.random() *
              3.5 +
            bass * 4;
        } else {
          p.x +=
            p.vx * motion +
            Math.sin(
              timestamp * 0.001 +
              p.phase
            ) *
              energy *
              0.4;

          p.y +=
            p.vy * motion;
        }

        if (
          p.x < -20 ||
          p.x > width + 20 ||
          p.y < -30 ||
          p.y > height + 30
        ) {
          p.x =
            Math.random() *
            width;

          p.y =
            isFire
              ? height +
                Math.random() *
                  40
              : Math.random() *
                height;

          p.vx =
            (Math.random() - 0.5) *
            0.5;

          p.vy =
            isFire
              ? -(
                  0.4 +
                  Math.random() *
                    0.8
                )
              : (
                  Math.random() - 0.5
                ) *
                0.5;
        }

        const alpha =
          this.clamp(
            p.alpha *
              (
                0.55 +
                energy * 1.2
              ) *
              intensity,
            0.03,
            0.95
          );

        if (isFire) {
          ctx.fillStyle =
            `rgba(255, ${Math.round(
              80 +
              110 *
                (1 - p.life)
            )}, 50, ${alpha})`;
        } else {
          ctx.fillStyle =
            `rgba(255,255,255,${alpha})`;
        }

        ctx.beginPath();

        ctx.arc(
          p.x,
          p.y,
          p.size,
          0,
          Math.PI * 2
        );

        ctx.fill();
      }
    }

    drawSparkles(
      width,
      height,
      energy,
      intensity
    ) {
      const ctx =
        this.ctx;

      if (!ctx) {
        return;
      }

      const count =
        Math.min(
          24,
          Math.floor(
            5 +
            energy * 18
          )
        );

      for (
        let i = 0;
        i < count;
        i++
      ) {
        const x =
          Math.random() *
          width;

        const y =
          Math.random() *
          height;

        const size =
          1 +
          Math.random() *
            3 *
            intensity;

        const alpha =
          this.clamp(
            0.2 +
              energy *
                intensity,
            0,
            1
          );

        ctx.fillStyle =
          `rgba(255,255,255,${alpha})`;

        ctx.fillRect(
          x - size,
          y - size,
          size * 2,
          size * 2
        );
      }
    }

    drawPulseWave(
      width,
      height,
      energy,
      intensity
    ) {
      const ctx =
        this.ctx;

      if (!ctx) {
        return;
      }

      const centerX =
        width / 2;

      const centerY =
        height / 2;

      const maxRadius =
        Math.max(
          width,
          height
        ) *
        0.75;

      const radius =
        maxRadius *
        (
          0.1 +
          energy * 0.5
        );

      const alpha =
        this.clamp(
          energy *
            0.22 *
            intensity,
          0,
          0.35
        );

      ctx.beginPath();

      ctx.arc(
        centerX,
        centerY,
        radius,
        0,
        Math.PI * 2
      );

      ctx.strokeStyle =
        `rgba(139,92,246,${alpha})`;

      ctx.lineWidth =
        1 +
        energy * 4;

      ctx.stroke();
    }

    resetVisualEffects() {
      if (this.dom.canvas && this.ctx) {
        const rect =
          this.dom.canvas.getBoundingClientRect();

        this.ctx.clearRect(
          0,
          0,
          rect.width,
          rect.height
        );
      }

      if (this.dom.glow) {
        this.dom.glow.style.setProperty(
          '--stage-glow-scale',
          '1'
        );

        this.dom.glow.style.setProperty(
          '--stage-glow-alpha',
          '0.14'
        );
      }

      if (this.dom.pulseRing) {
        this.dom.pulseRing.style.setProperty(
          '--stage-pulse-scale',
          '0.85'
        );

        this.dom.pulseRing.style.setProperty(
          '--stage-pulse-alpha',
          '0'
        );
      }

      this.applyCharacterTransform(1);
    }

    /* -----------------------------------------------------
       PULSO VISUAL
       ----------------------------------------------------- */

    updatePulseEffects() {
      const energy =
        this.smoothedEnergy *
        this.state.effects.sensitivity;

      const bass =
        this.smoothedBass *
        this.state.effects.sensitivity;

      if (this.dom.glow) {
        const scale =
          0.9 +
          energy * 0.45;

        const alpha =
          this.clamp(
            0.08 +
              energy *
                0.32 *
                this.state.effects.intensity,
            0.05,
            0.5
          );

        this.dom.glow.style.setProperty(
          '--stage-glow-scale',
          scale.toFixed(3)
        );

        this.dom.glow.style.setProperty(
          '--stage-glow-alpha',
          alpha.toFixed(3)
        );
      }

      if (this.dom.pulseRing) {
        const scale =
          0.85 +
          this.beatPulse * 0.7;

        const alpha =
          this.clamp(
            this.beatPulse *
              this.state.effects.intensity,
            0,
            0.8
          );

        this.dom.pulseRing.style.setProperty(
          '--stage-pulse-scale',
          scale.toFixed(3)
        );

        this.dom.pulseRing.style.setProperty(
          '--stage-pulse-alpha',
          alpha.toFixed(3)
        );
      }
    }

    /* -----------------------------------------------------
       LETRAS SINCRONIZADAS
       ----------------------------------------------------- */

    parseLyrics() {
      const text =
        this.state.lyrics.text || '';

      const lines =
        text.split(/\r?\n/);

      const parsed = [];

      for (
        let i = 0;
        i < lines.length;
        i++
      ) {
        const line =
          lines[i].trim();

        if (!line) {
          continue;
        }

        const match =
          line.match(
            /^\s*\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.+?)\s*$/
          );

        if (!match) {
          continue;
        }

        const minutes =
          Number(match[1]);

        const seconds =
          Number(match[2]);

        const fraction =
          match[3]
            ? Number(
                `0.${match[3]}`
              )
            : 0;

        const time =
          minutes * 60 +
          seconds +
          fraction;

        parsed.push({
          time,
          text: match[4],
          index: parsed.length
        });
      }

      parsed.sort(
        (a, b) =>
          a.time - b.time
      );

      this.lyrics =
        parsed;

      this.activeLyricIndex =
        -1;
    }

    applyLyrics() {
      if (!this.dom.lyricsContainer) {
        return;
      }

      this.parseLyrics();

      this.dom.lyricsContainer.innerHTML =
        '';

      this.lyricElements = [];

      for (
        let i = 0;
        i < this.lyrics.length;
        i++
      ) {
        const lyric =
          this.lyrics[i];

        const span =
          document.createElement(
            'span'
          );

        span.className =
          'stage-lyric-word';

        span.textContent =
          lyric.text;

        span.dataset.index =
          String(i);

        this.dom.lyricsContainer.appendChild(
          span
        );

        this.lyricElements.push(
          span
        );
      }

      this.applyLyricsMode();
    }

    applyLyricsMode() {
      if (!this.dom.lyricsPanel) {
        return;
      }

      const decorated =
        this.state.lyrics.mode ===
        'decorated';

      this.dom.lyricsPanel.classList.toggle(
        'stage-lyrics-decorated',
        decorated
      );

      this.dom.lyricsPanel.classList.toggle(
        'stage-lyrics-simple',
        !decorated
      );
    }

    getCurrentLyricIndex(
      currentTime
    ) {
      let current = -1;

      for (
        let i = 0;
        i < this.lyrics.length;
        i++
      ) {
        if (
          this.lyrics[i].time <=
          currentTime
        ) {
          current = i;
        } else {
          break;
        }
      }

      return current;
    }

    updateLyricsReaction() {
      if (
        !this.state.layers.lyrics ||
        !this.lyricElements.length
      ) {
        return;
      }

      const audio =
        this.getActiveAudio();

      if (!audio) {
        return;
      }

      const currentTime =
        Number.isFinite(
          audio.currentTime
        )
          ? audio.currentTime
          : 0;

      const currentIndex =
        this.getCurrentLyricIndex(
          currentTime
        );

      if (
        currentIndex !==
        this.activeLyricIndex
      ) {
        this.activeLyricIndex =
          currentIndex;

        for (
          let i = 0;
          i < this.lyricElements.length;
          i++
        ) {
          this.lyricElements[i].classList.toggle(
            'stage-word-active',
            i === currentIndex
          );
        }
      }

      /*
       * El golpe de audio añade un pequeño impulso
       * sin modificar la sincronización temporal.
       */
      if (
        currentIndex >= 0 &&
        this.lyricElements[currentIndex]
      ) {
        const beat =
          this.beatPulse *
          this.state.effects.sensitivity;

        const scale =
          1.04 +
          this.clamp(
            beat * 0.08,
            0,
            0.1
          );

        this.lyricElements[
          currentIndex
        ].style.transform =
          `translate3d(0,-4px,0) scale(${scale.toFixed(3)})`;
      }
    }

    /* -----------------------------------------------------
       PANEL
       ----------------------------------------------------- */

    toggleSettings() {
      if (!this.dom.settings) {
        return;
      }

      const open =
        this.dom.settings.classList.contains(
          'stage-settings-open'
        );

      if (open) {
        this.closeSettings();
      } else {
        this.openSettings();
      }
    }

    openSettings() {
      if (!this.dom.settings) {
        return;
      }

      this.dom.settings.classList.add(
        'stage-settings-open'
      );

      this.dom.settings.setAttribute(
        'aria-hidden',
        'false'
      );
    }

    closeSettings() {
      if (!this.dom.settings) {
        return;
      }

      this.dom.settings.classList.remove(
        'stage-settings-open'
      );

      this.dom.settings.setAttribute(
        'aria-hidden',
        'true'
      );
    }

    /* -----------------------------------------------------
       RESET
       ----------------------------------------------------- */

    async resetAll() {
      this.stopAnimation();

      this.releaseBackgroundObjectUrl();
      this.releaseCharacterObjectUrl();

      this.state =
        this.cloneDefaults();

      this.applyStateToUI();
      this.applyLayerVisibility();
      this.applyBackground();
      this.applyCharacter();
      this.applyLyrics();

      this.rebuildParticles();

      await this.saveState();

      if (this.state.enabled) {
        this.startAnimation();
      }
    }

    /* -----------------------------------------------------
       DESTROY
       ----------------------------------------------------- */

    destroy() {
      if (this.destroyed) {
        return;
      }

      this.destroyed = true;

      /*
       * Cancelación inmediata del frame.
       */
      this.stopAnimation();

      if (this.resizeTimer) {
        window.clearTimeout(
          this.resizeTimer
        );

        this.resizeTimer = null;
      }

      window.removeEventListener(
        'resize',
        this.bound.resize
      );

      this.releaseBackgroundObjectUrl();
      this.releaseCharacterObjectUrl();

      if (this.dom.backgroundVideo) {
        this.dom.backgroundVideo.pause();
      }

      this.particles.length = 0;

      if (this.ctx && this.dom.canvas) {
        const rect =
          this.dom.canvas.getBoundingClientRect();

        this.ctx.clearRect(
          0,
          0,
          rect.width,
          rect.height
        );
      }

      if (this.db) {
        try {
          this.db.close();
        } catch (_) {}
      }

      this.db = null;
      this.dbReady = false;

      if (this.dom.root) {
        this.dom.root.classList.remove(
          'stage-active'
        );
      }
    }
  }

  /* =======================================================
     INSTANCIA GLOBAL ÚNICA
     ======================================================= */

  const stageManager =
    new StageManager();

  /*
   * Se expone para que Glasstrack Pro pueda abrir/cerrar
   * el escenario desde cualquier parte sin modificar
   * su lógica existente.
   *
   * Ejemplos externos:
   *
   * window.StageManager.show();
   * window.StageManager.hide();
   * window.StageManager.toggleSettings();
   * window.StageManager.destroy();
   */
  window.StageManager =
    stageManager;

  /*
   * Inicialización independiente después de que el DOM
   * existente haya terminado de cargarse.
   */
  const initializeStageManager =
    () => {
      stageManager
        .init()
        .catch(error => {
          console.warn(
            '[StageManager] Error de inicialización:',
            error
          );
        });
    };

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      initializeStageManager,
      { once: true }
    );
  } else {
    initializeStageManager();
  }

})(window, document);



/* =========================================================
   GLASSTRACK PRO — SPLASH SCREEN HUD / INTRO v2.5 PRO
   ========================================================= */
(() => {
  'use strict';

  const INTRO_KEY = 'glasstrack_intro_seen';
  const TARGET_COUNT = 1230;
  const TIPS_LIST = [
    "Atajo HUD: Presiona F7 para ocultar o mostrar instantáneamente todos los botones e íconos de la pantalla.",
    "Control de Reproducción: Usa la Barra Espaciadora para pausar o reanudar tu música en cualquier momento.",
    "Importación Rápida: Arrastra y suelta archivos .sim o .sims directamente a la ventana para añadirlos a tu biblioteca.",
    "Modo Enfoque: Presiona la tecla F para activar el Modo Enfoque y escuchar música sin distracciones.",
    "Menú de Experiencias: La tecla M abre directamente el menú flotante con los modos de visualización.",
    "Transparencia Glass: Ajusta el nivel de opacidad del efecto cristal desde el panel de Ajustes Generales.",
    "Cierre Rápido: Presiona Esc para cerrar de inmediato cualquier ventana o menú que tengas abierto.",
    "Letras Decoradas: En el Modo Karaoke, activa las letras decoradas para una animación tipo concierto.",
    "Balance de Audio: Usa el ajuste L/R en la configuración de sonido si usas audífonos con volumen descompensado.",
    "Graves Intensos: El ecualizador avanzado permite activar el realce de bajos en canciones de mucho ritmo.",
    "Estilo Karaoke: Cambia entre fondo difuminado o negro sólido para leer las letras cómodamente.",
    "Rendimiento: Si notas tirones de pantalla, desactiva las animaciones secundarias en Ajustes.",
    "Persistencia Local: Tu biblioteca y configuraciones se guardan automáticamente en IndexedDB.",
    "Barra de Tiempo: Haz clic sobre la barra de progreso para saltar al segundo exacto de la pista.",
    "Normalizador: Activa la normalización de volumen para evitar saltos bruscos entre distintas canciones.",
    "Velocidad de Canto: Puedes cambiar la velocidad de la pista sin alterar la afinación ni el tono de la voz.",
    "Botón Saltar: Si no quieres esperar la animación de entrada, haz clic en el botón flotante \"Saltar\".",
    "Temporizador: Programa un temporizador de apagado si te gusta dormir escuchando tu música.",
    "Formato Limpio: El contador de tiempo muestra formato exacto en horas, minutos y segundos.",
    "Listas Personalizadas: Crea carpetas de reproducción temáticas desde el gestor de archivos.",
    "Teclas Rápidas: Mantén la barra de atajos visible para memorizar los controles del reproductor.",
  ];

  const splash = document.getElementById('glasstrack-splash');
  if (!splash) return;

  let audio = null;
  let countTimer = null;
  let unlockTimer = null;
  let currentCount = 0;
  let lockedCount = 0;
  let isClosing = false;
  let hudHidden = false;

  const countEl = document.getElementById('splash-count');
  const tipEl = document.getElementById('splash-tip');
  const skipBtn = document.getElementById('btn-skip-splash');
  const logoEl = document.getElementById('splash-logo');
  const hud = document.getElementById('splash-hud');

  function hasSeenIntro() {
    try {
      return localStorage.getItem(INTRO_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  function markIntroSeen() {
    try {
      localStorage.setItem(INTRO_KEY, 'true');
    } catch (_) {}
    document.documentElement.classList.add('glasstrack-intro-seen');
  }

  function randomTip() {
    if (!tipEl || !TIPS_LIST.length) return;
    const index = Math.floor(Math.random() * TIPS_LIST.length);
    tipEl.textContent = TIPS_LIST[index];
  }

  function safePlaySfx() {
    try {
      if (typeof playSFX === 'function') playSFX('click');
    } catch (_) {}
  }

  function startIntroAudio() {
    try {
      audio = new Audio('assets/sounds/intro-effect.mp3');
      audio.preload = 'auto';
      audio.volume = 0.72;
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
    } catch (_) {
      audio = null;
    }
  }

  function updateCount(value) {
    currentCount = Math.max(0, Math.min(TARGET_COUNT, Math.floor(value)));
    if (countEl) countEl.textContent = String(currentCount);
  }

  function pickRandomLockPoint() {
    const min = 250;
    const max = TARGET_COUNT - 170;
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function pickLockDuration() {
    return Math.floor(1500 + Math.random() * 2200);
  }

  function showSkipButton() {
    if (!skipBtn) return;
    splash.classList.add('splash-stuck');
    skipBtn.classList.add('splash-skip-visible');
  }

  function hideSkipButton() {
    if (!skipBtn) return;
    skipBtn.classList.remove('splash-skip-visible');
  }

  function stopTimers() {
    if (countTimer !== null) {
      window.clearInterval(countTimer);
      countTimer = null;
    }
    if (unlockTimer !== null) {
      window.clearTimeout(unlockTimer);
      unlockTimer = null;
    }
  }

  function finishIntro() {
    if (isClosing) return;
    isClosing = true;
    stopTimers();
    updateCount(TARGET_COUNT);
    hideSkipButton();
    splash.classList.remove('splash-stuck');
    splash.classList.add('splash-exiting');

    window.setTimeout(() => {
      markIntroSeen();
      splash.classList.add('splash-hidden');
      splash.hidden = true;
      if (audio) {
        try { audio.pause(); } catch (_) {}
        audio = null;
      }
    }, 440);
  }

  function startCounter() {
    lockedCount = pickRandomLockPoint();
    const lockDuration = pickLockDuration();
    currentCount = 0;
    updateCount(0);

    const COUNT_DURATION_MS = 15000;
    const stepDelay = Math.max(16, Math.floor(COUNT_DURATION_MS / TARGET_COUNT));

    countTimer = window.setInterval(() => {
      if (isClosing) {
        stopTimers();
        return;
      }

      if (currentCount < lockedCount) {
        const jump = Math.random() < 0.18 ? 2 : 1;
        updateCount(Math.min(lockedCount, currentCount + jump));
        return;
      }

      if (!splash.classList.contains('splash-stuck')) {
        updateCount(lockedCount);
        showSkipButton();
        unlockTimer = window.setTimeout(() => {
          if (isClosing) return;
          splash.classList.remove('splash-stuck');
          hideSkipButton();
          unlockTimer = null;
          countTimer = window.setInterval(() => {
            if (currentCount >= TARGET_COUNT) {
              finishIntro();
              return;
            }
            const boost = currentCount < TARGET_COUNT - 20 ? Math.ceil(Math.random() * 4) : 1;
            updateCount(Math.min(TARGET_COUNT, currentCount + boost));
          }, stepDelay);
        }, lockDuration);

        window.clearInterval(countTimer);
        countTimer = null;
      }
    }, stepDelay);
  }

  function toggleHud(force) {
    hudHidden = typeof force === 'boolean' ? force : !hudHidden;
    splash.classList.toggle('splash-hud-hidden', hudHidden);
    if (hud) hud.setAttribute('aria-hidden', String(hudHidden));
  }

  function runShortcut(action) {
    const play = document.getElementById('play');
    const menu = document.getElementById('btn-main-menu');
    const focus = document.getElementById('btn-focus-mode');

    switch (action) {
      case 'play':
        safePlaySfx();
        if (play) play.click();
        break;
      case 'hud':
        toggleHud();
        break;
      case 'menu':
        finishIntro();
        window.setTimeout(() => menu?.click(), 40);
        break;
      case 'focus':
        finishIntro();
        window.setTimeout(() => focus?.click(), 40);
        break;
      case 'close':
        finishIntro();
        break;
      default:
        break;
    }
  }

  skipBtn?.addEventListener('click', () => {
    safePlaySfx();
    updateCount(TARGET_COUNT);
    finishIntro();
  });

  splash.querySelectorAll('[data-splash-action]').forEach(button => {
    button.addEventListener('click', () => {
      runShortcut(button.getAttribute('data-splash-action'));
    });
  });

  logoEl?.addEventListener('error', () => {
    logoEl.style.display = 'none';
  });

  document.addEventListener('keydown', event => {
    if (!splash || splash.classList.contains('splash-hidden') || splash.hidden) return;

    if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

    if (event.code === 'Space') {
      event.preventDefault();
      runShortcut('play');
    } else if (event.code === 'F7') {
      event.preventDefault();
      runShortcut('hud');
    } else if (event.code === 'KeyM') {
      event.preventDefault();
      runShortcut('menu');
    } else if (event.code === 'KeyF') {
      event.preventDefault();
      runShortcut('focus');
    } else if (event.code === 'Escape') {
      event.preventDefault();
      runShortcut('close');
    }
  });

  if (hasSeenIntro()) {
    document.documentElement.classList.add('glasstrack-intro-seen');
    splash.classList.add('splash-hidden');
    splash.hidden = true;
    return;
  }

  randomTip();
  startIntroAudio();
  startCounter();
})();


/* =========================================================
   GLASSTRACK PRO — MOBILE UI V3 / STATE SYNC
   ========================================================= */
(() => {
  'use strict';

  const player = document.getElementById('player-card');
  const nowPlaying = document.getElementById('mobile-nowplaying-bar');
  const bottomNav = document.getElementById('mobile-tab-bar');
  const closePlayer = document.getElementById('btn-close-mobile-player');

  if (!player) return;

  const syncExpandedMobilePlayer = () => {
    const expanded = document.body.classList.contains('mobile-player-expanded') &&
      player.classList.contains('mobile-expanded');

    if (expanded) {
      document.documentElement.classList.add('mobile-player-layer-open');
      if (nowPlaying) nowPlaying.setAttribute('aria-hidden', 'true');
      if (bottomNav) bottomNav.setAttribute('aria-hidden', 'true');
    } else {
      document.documentElement.classList.remove('mobile-player-layer-open');
      if (nowPlaying) nowPlaying.removeAttribute('aria-hidden');
      if (bottomNav) bottomNav.removeAttribute('aria-hidden');
    }
  };

  const expandPlayer = () => {
    if (!document.body.classList.contains('mobile-layout')) return;
    player.classList.add('mobile-expanded');
    document.body.classList.add('mobile-player-expanded');
    syncExpandedMobilePlayer();
  };

  const collapsePlayer = () => {
    player.classList.remove('mobile-expanded');
    document.body.classList.remove('mobile-player-expanded');
    syncExpandedMobilePlayer();
  };

  if (nowPlaying) {
    nowPlaying.addEventListener('click', event => {
      if (event.target.closest('#mobile-np-play')) return;
      expandPlayer();
    });
  }

  if (closePlayer) {
    closePlayer.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      playSFX('close');
      collapsePlayer();
    }, true);
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('mobile-player-expanded')) {
      event.preventDefault();
      collapsePlayer();
    }
  });

  const observer = new MutationObserver(syncExpandedMobilePlayer);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });

  syncExpandedMobilePlayer();
})();


/* =========================================================
   GLASSTRACK PRO — MOBILE UI V4 / INTEGRACIÓN REAL
   Todo el comportamiento añadido aquí se ejecuta solo cuando
   body.mobile-layout/mobile-mode está activo.
   ========================================================= */
(() => {
  'use strict';

  const isMobileMode = () =>
    document.body.classList.contains('mobile-layout') ||
    document.body.classList.contains('mobile-mode');

  const fileInputEl = document.getElementById('file-input');
  const addMusicBtn = document.getElementById('btn-mobile-add-music');
  const quickMenu = document.getElementById('mobile-quick-menu');
  const quickTrigger = document.getElementById('btn-mobile-secondary-menu');
  const player = document.getElementById('player-card');
  const nowPlaying = document.getElementById('mobile-nowplaying-bar');

  /* (+) reutiliza exactamente el selector de archivos existente. */
  if (addMusicBtn && fileInputEl) {
    addMusicBtn.addEventListener('click', event => {
      if (!isMobileMode()) return;
      event.preventDefault();
      event.stopPropagation();
      try { if (typeof playSFX === 'function') playSFX('click'); } catch (_) {}
      fileInputEl.click();
    });
  }

  /* Menú de tres puntos: opciones rápidas, sin Mini Player ni Enfoque duplicado. */
  if (quickTrigger && quickMenu) {
    quickTrigger.addEventListener('click', event => {
      if (!isMobileMode()) return;
      event.preventDefault();
      event.stopPropagation();
      quickMenu.classList.toggle('active');
      quickTrigger.setAttribute('aria-expanded', String(quickMenu.classList.contains('active')));
      const experiences = document.getElementById('top-experiences-menu');
      if (experiences) experiences.classList.add('hidden');
      try { if (typeof playSFX === 'function') playSFX('click'); } catch (_) {}
    }, true);

    quickMenu.addEventListener('click', event => {
      const button = event.target.closest('[data-mobile-quick]');
      if (!button || !isMobileMode()) return;
      event.preventDefault();
      event.stopPropagation();

      const action = button.dataset.mobileQuick;
      quickMenu.classList.remove('active');
      quickTrigger.setAttribute('aria-expanded', 'false');

      const target = {
        eq: document.getElementById('btn-eq-toggle'),
        lyrics: document.getElementById('btn-lyrics-toggle'),
        vm: document.getElementById('btn-vm-toggle'),
        cinema: document.getElementById('btn-cinema-mode'),
        shuffle: document.getElementById('shuffle'),
        loop: document.getElementById('loop')
      }[action];

      if (target) target.click();
    });
  }

  document.addEventListener('click', event => {
    if (!quickMenu || !quickMenu.classList.contains('active')) return;
    if (quickMenu.contains(event.target) || event.target === quickTrigger || quickTrigger?.contains(event.target)) return;
    quickMenu.classList.remove('active');
    quickTrigger?.setAttribute('aria-expanded', 'false');
  }, true);

  /* Accesos inferiores del reproductor expandido. */
  const mobilePlayerEq = document.getElementById('mobile-player-eq');
  const mobilePlayerLyrics = document.getElementById('mobile-player-lyrics');
  const mobilePlayerVm = document.getElementById('mobile-player-vm');

  const clickExisting = id => {
    const target = document.getElementById(id);
    if (target) target.click();
  };

  mobilePlayerEq?.addEventListener('click', () => {
    if (!isMobileMode()) return;
    clickExisting('btn-eq-toggle');
  });

  mobilePlayerLyrics?.addEventListener('click', () => {
    if (!isMobileMode()) return;
    clickExisting('btn-lyrics-toggle');
  });

  mobilePlayerVm?.addEventListener('click', () => {
    if (!isMobileMode()) return;
    clickExisting('btn-vm-toggle');
  });

  /* ---------------------------------------------------------
     OCULTAR / RESTAURAR UI EN MODO CINE Y ENFOQUE
     --------------------------------------------------------- */
  const cinema = document.getElementById('cinema-mode');
  const focusButton = document.getElementById('btn-focus-mode');

  const syncVisualHide = () => {
    const body = document.body;
    if (!isMobileMode()) {
      // No escribir la clase si ya está limpia. Esto evita generar una cadena
      // innecesaria de MutationObserver -> syncVisualHide -> MutationObserver.
      if (body.classList.contains('mobile-ui-hidden')) {
        body.classList.remove('mobile-ui-hidden');
      }
      return;
    }
    const hiddenByFocus = body.classList.contains('focus-mode');
    const hiddenByCinema = !!cinema?.classList.contains('active');
    const shouldHide = hiddenByFocus || hiddenByCinema;
    const isHidden = body.classList.contains('mobile-ui-hidden');

    // Solo mutar cuando el estado realmente cambió.
    if (shouldHide !== isHidden) {
      body.classList.toggle('mobile-ui-hidden', shouldHide);
    }
  };

  focusButton?.addEventListener('click', () => {
    window.setTimeout(syncVisualHide, 0);
  }, true);

  document.getElementById('btn-close-cinema')?.addEventListener('click', () => {
    window.setTimeout(syncVisualHide, 0);
  }, true);

  const visualObserver = new MutationObserver(syncVisualHide);
  visualObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (cinema) visualObserver.observe(cinema, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('click', event => {
    if (!isMobileMode() || !document.body.classList.contains('mobile-ui-hidden')) return;
    const clickedControl = event.target.closest('button, input, select, textarea, a, .cinema-controls, .lyrics-panel, .mobile-player-actions');
    if (!clickedControl) {
      document.body.classList.remove('mobile-ui-hidden');
    }
  }, true);

  /* ---------------------------------------------------------
     5 BANDAS EQ MÓVILES — conectadas a los filtros EXISTENTES.
     60->64Hz, 230->250Hz, 910->1kHz, 4k->4kHz, 14k->16kHz.
     --------------------------------------------------------- */
  const mobileEqMap = [
    ['mobile-eq-230', 3],
    ['mobile-eq-910', 5],
    ['mobile-eq-60', 1],
    ['mobile-eq-4k', 7],
    ['mobile-eq-14k', 9]
  ];

  const getDesktopEqSliders = () =>
    Array.from(document.querySelectorAll('.eq-band-range'));

  const updateMobileEqOutput = (id, value) => {
    const output = document.getElementById(id + '-value');
    if (output) output.textContent = `${Number(value).toFixed(1).replace('.0','')} dB`;
  };

  const syncMobileEqFromDesktop = () => {
    const desktop = getDesktopEqSliders();
    mobileEqMap.forEach(([id, index]) => {
      const input = document.getElementById(id);
      const source = desktop[index];
      if (input && source) {
        input.value = source.value;
        updateMobileEqOutput(id, source.value);
      }
    });
  };

  mobileEqMap.forEach(([id, desktopIndex]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', () => {
      if (!isMobileMode()) return;
      const value = Number(input.value);
      const desktop = getDesktopEqSliders();
      const source = desktop[desktopIndex];
      initAudioContext();
      if (source) source.value = String(value);
      if (typeof eqFilters !== 'undefined' && eqFilters[desktopIndex]) {
        eqFilters[desktopIndex].gain.value = value;
      }
      updateMobileEqOutput(id, value);
      document.querySelectorAll('.mobile-eq-preset').forEach(btn => btn.classList.toggle('active', btn.dataset.mobileEqPreset === 'custom'));
      saveAudioSettings();
    });
  });

  document.querySelectorAll('.eq-band-range').forEach(slider => {
    slider.addEventListener('input', () => {
      if (isMobileMode()) syncMobileEqFromDesktop();
    }, { passive: true });
  });

  syncMobileEqFromDesktop();

  /* Presets móviles: actualizan los filtros globales reales. */
  const mobileEqPresets = {
    normal:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    classic:  [0, -1, -1, 1, 1.5, 1, 0, -0.5, -1, -1],
    dance:    [5, 6, 3.5, 2, 0, 1, 2.5, 3.5, 4.5, 5]
  };

  document.querySelectorAll('.mobile-eq-preset').forEach(button => {
    button.addEventListener('click', () => {
      if (!isMobileMode()) return;
      const preset = button.dataset.mobileEqPreset;
      document.querySelectorAll('.mobile-eq-preset').forEach(btn => btn.classList.toggle('active', btn === button));
      if (preset === 'custom') return;

      initAudioContext();
      const values = mobileEqPresets[preset];
      if (!values) return;
      const desktop = getDesktopEqSliders();
      desktop.forEach((slider, index) => {
        const value = values[index] ?? 0;
        slider.value = String(value);
        if (typeof eqFilters !== 'undefined' && eqFilters[index]) eqFilters[index].gain.value = value;
      });
      syncMobileEqFromDesktop();
      saveAudioSettings();
    });
  });

  /* ---------------------------------------------------------
     BALANCE L/R — un solo estado compartido.
     --------------------------------------------------------- */
  const mobileBalance = document.getElementById('mobile-eq-balance');
  const mobileBalanceValue = document.getElementById('mobile-eq-balance-value');
  const desktopBalance = document.getElementById('input-audio-balance');
  let balanceSyncing = false;

  const setSharedBalance = value => {
    if (balanceSyncing) return;
    const safe = Math.max(-1, Math.min(1, Number(value) || 0));
    balanceSyncing = true;
    if (desktopBalance) desktopBalance.value = String(safe);
    if (mobileBalance) mobileBalance.value = String(safe);
    if (mobileBalanceValue) mobileBalanceValue.textContent = safe === 0 ? '0' : safe.toFixed(2);

    initAudioContext();
    try {
      if (typeof pannerNode !== 'undefined' && pannerNode) {
        if (pannerNode.context && pannerNode.context.state === 'suspended') pannerNode.context.resume().catch(() => {});
        pannerNode.pan.setValueAtTime(safe, pannerNode.context.currentTime);
      }
    } catch (_) {}

    saveAudioSettings();
    balanceSyncing = false;
  };

  desktopBalance?.addEventListener('input', () => {
    const value = Number(desktopBalance.value) || 0;
    if (mobileBalanceValue) mobileBalanceValue.textContent = value === 0 ? '0' : value.toFixed(2);
    if (mobileBalance && !balanceSyncing) mobileBalance.value = String(value);
    try {
      initAudioContext();
      if (typeof pannerNode !== 'undefined' && pannerNode && (!toggle8dAudio || !toggle8dAudio.checked)) {
        pannerNode.pan.setValueAtTime(value, pannerNode.context.currentTime);
      }
    } catch (_) {}
  });

  mobileBalance?.addEventListener('input', () => setSharedBalance(mobileBalance.value));
  syncMobileEqFromDesktop();
  if (desktopBalance) setSharedBalance(desktopBalance.value);

  /* ---------------------------------------------------------
     REVERB MÓVIL — añade un send/return ligero sin crear otra
     fuente de MediaElement. Solo se conecta al pipeline cuando
     el usuario selecciona una opción.
     --------------------------------------------------------- */
  let mobileReverbConvolver = null;
  let mobileReverbGain = null;
  let mobileReverbCurrent = 'none';

  const createImpulseResponse = (context, seconds, decay) => {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  };

  const ensureMobileReverb = () => {
    initAudioContext();
    if (!mobileReverbConvolver && typeof audioCtx !== 'undefined' && audioCtx && typeof limiterNode !== 'undefined' && limiterNode) {
      mobileReverbConvolver = audioCtx.createConvolver();
      mobileReverbGain = audioCtx.createGain();
      mobileReverbGain.gain.value = 0;
      mobileReverbConvolver.buffer = createImpulseResponse(audioCtx, 2.1, 2.8);
      limiterNode.connect(mobileReverbConvolver);
      mobileReverbConvolver.connect(mobileReverbGain);
      mobileReverbGain.connect(stereoBypassGain);
    }
    return !!mobileReverbConvolver;
  };

  const applyMobileReverb = value => {
    if (!isMobileMode()) return;
    mobileReverbCurrent = value;
    if (value === 'none') {
      if (mobileReverbGain) mobileReverbGain.gain.value = 0;
      saveAudioSettings();
      return;
    }

    if (!ensureMobileReverb()) return;
    const settings = {
      small: { gain: 0.12, seconds: 0.75, decay: 3.9 },
      room: { gain: 0.18, seconds: 1.25, decay: 3.0 },
      hall: { gain: 0.24, seconds: 1.9, decay: 2.2 }
    }[value] || { gain: 0, seconds: 1, decay: 3 };

    mobileReverbConvolver.buffer = createImpulseResponse(audioCtx, settings.seconds, settings.decay);
    mobileReverbGain.gain.setValueAtTime(settings.gain, audioCtx.currentTime);
    saveAudioSettings();
  };

  document.getElementById('mobile-eq-reverb')?.addEventListener('change', event => {
    applyMobileReverb(event.target.value);
  });

  /* ---------------------------------------------------------
     CIERRE LIMPIO DE AJUSTES EN MÓVIL
     --------------------------------------------------------- */
  const mobileSettingsButton = document.querySelector('#mobile-tab-bar [data-tab="ajustes"]');
  const settingsClose = document.getElementById('btn-close-settings');
  const modalSettingsEl = document.getElementById('modal-settings');

  const forceCloseSettings = () => {
    if (!modalSettingsEl) return;
    modalSettingsEl.classList.remove('active');
    modalSettingsEl.style.display = 'none';
    modalSettingsEl.setAttribute('aria-hidden', 'true');
  };

  settingsClose?.addEventListener('click', forceCloseSettings, true);

  modalSettingsEl?.addEventListener('click', event => {
    if (event.target === modalSettingsEl) forceCloseSettings();
  }, true);

  mobileSettingsButton?.addEventListener('click', () => {
    window.setTimeout(() => {
      if (modalSettingsEl) {
        modalSettingsEl.style.display = 'flex';
        modalSettingsEl.classList.add('active');
      }
    }, 0);
  }, true);

  /* ---------------------------------------------------------
     EXPANSIÓN DEL REPRODUCTOR: toque en la barra compacta.
     --------------------------------------------------------- */
  if (nowPlaying && player) {
    nowPlaying.addEventListener('click', event => {
      if (!isMobileMode()) return;
      if (event.target.closest('#mobile-np-play')) return;
      player.classList.add('mobile-expanded');
      document.body.classList.add('mobile-player-expanded');
    }, true);
  }

  /* La inicialización ya se realiza una sola vez junto al listener principal.
     No volver a ejecutar applyMobileLayoutState aquí: duplicarlo provoca dos
     ciclos de mutación/layout al cargar la interfaz. */
})();


/* =========================================================
   GLASSTRACK PRO V5 — FIXES PC SIN TOCAR LA UI MÓVIL
   ========================================================= */
(() => {
  'use strict';

  const pcTrigger = document.getElementById('btn-pc-secondary-menu');
  const experiencesMenu = document.getElementById('top-experiences-menu');
  const focusButton = document.getElementById('btn-focus-mode');
  const desktopPlayer = document.getElementById('player-card');
  const desktopVehicle = document.getElementById('vehicle-mode');
  const desktopCinema = document.getElementById('cinema-mode');
  const desktopSettings = document.getElementById('modal-settings');

  const isMobileUI = () =>
    document.body.classList.contains('mobile-layout') ||
    document.body.classList.contains('mobile-mode');

  /* ---------------------------------------------------------
     1. PC — NUEVO BOTÓN DE OPCIONES SECUNDARIAS
     Usa el mismo menú que antes pertenecía a Modo Vista.
     En móvil esta lógica no interviene.
     --------------------------------------------------------- */
  const positionDesktopExperiencesMenu = () => {
    if (isMobileUI() || !pcTrigger || !experiencesMenu || experiencesMenu.classList.contains('hidden')) return;

    const rect = pcTrigger.getBoundingClientRect();
    const width = Math.min(340, Math.max(280, experiencesMenu.offsetWidth || 320));
    const height = experiencesMenu.offsetHeight || 210;
    const gap = 8;
    const padding = 10;

    let left = rect.right - width;
    let top = rect.bottom + gap;

    left = Math.min(
      Math.max(left, padding),
      Math.max(padding, window.innerWidth - width - padding)
    );

    if (top + height > window.innerHeight - padding) {
      top = rect.top - height - gap;
    }

    top = Math.min(
      Math.max(top, padding),
      Math.max(padding, window.innerHeight - height - padding)
    );

    experiencesMenu.style.left = `${left}px`;
    experiencesMenu.style.top = `${top}px`;
  };

  const closeDesktopExperiencesMenu = () => {
    if (!experiencesMenu) return;
    experiencesMenu.classList.add('hidden');
    pcTrigger?.setAttribute('aria-expanded', 'false');
  };

  const openDesktopExperiencesMenu = event => {
    if (isMobileUI() || !pcTrigger || !experiencesMenu) return;
    event?.preventDefault();
    event?.stopPropagation();
    experiencesMenu.classList.remove('hidden');
    pcTrigger.setAttribute('aria-expanded', 'true');
    positionDesktopExperiencesMenu();
  };

  pcTrigger?.addEventListener('click', event => {
    if (isMobileUI()) return;
    try { if (typeof playSFX === 'function') playSFX('click'); } catch (_) {}
    if (experiencesMenu?.classList.contains('hidden')) {
      openDesktopExperiencesMenu(event);
    } else {
      closeDesktopExperiencesMenu();
    }
  });

  window.addEventListener('resize', positionDesktopExperiencesMenu, { passive: true });
  window.addEventListener('scroll', positionDesktopExperiencesMenu, { passive: true });

  /* ---------------------------------------------------------
     2. PC — MODO ENFOQUE
     El botón utiliza una única implementación global para evitar
     listeners duplicados y estados de foco contradictorios.
     --------------------------------------------------------- */
  /* Evita que el arrastre del foco de escritorio se quede vivo después de
     perder el foco de la ventana. */
  window.addEventListener('blur', () => {
    if (!isMobileUI()) window.__glasstrackFocusDragging = false;
  });

  /* ---------------------------------------------------------
     3. MODOS DE PANTALLA PC — CIERRE CONSISTENTE
     --------------------------------------------------------- */
  const closeVehicleSafe = () => {
    if (!desktopVehicle) return;
    desktopVehicle.classList.remove('active');
    desktopVehicle.setAttribute('aria-hidden', 'true');
  };

  const closeCinemaSafe = () => {
    if (!desktopCinema) return;
    desktopCinema.classList.remove('active');
    desktopCinema.classList.remove('karaoke-layout');
    desktopCinema.setAttribute('aria-hidden', 'true');
  };

  document.addEventListener('keydown', event => {
    if (isMobileUI() || event.key !== 'Escape') return;

    const vehicleActive = desktopVehicle?.classList.contains('active');
    const cinemaActive = desktopCinema?.classList.contains('active');
    const settingsActive = desktopSettings?.classList.contains('active');
    const menuActive = experiencesMenu && !experiencesMenu.classList.contains('hidden');

    if (vehicleActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeVehicleSafe();
      try { if (typeof playSFX === 'function') playSFX('close'); } catch (_) {}
      return;
    }

    if (cinemaActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCinemaSafe();
      try { if (typeof playSFX === 'function') playSFX('close'); } catch (_) {}
      return;
    }

    if (settingsActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof closeModalSettings === 'function') closeModalSettings();
      return;
    }

    if (menuActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDesktopExperiencesMenu();
      return;
    }
  }, true);

  /* Cerrar un modo de pantalla si el usuario vuelve a abrir el mismo modo.
     No modifica el comportamiento móvil. */
  document.getElementById('btn-vehicle-mode')?.addEventListener('click', () => {
    if (isMobileUI()) return;
    if (desktopVehicle) {
      desktopVehicle.setAttribute('aria-hidden', 'false');
    }
  }, true);

  document.getElementById('btn-cinema-mode')?.addEventListener('click', () => {
    if (isMobileUI()) return;
    if (desktopCinema) {
      desktopCinema.setAttribute('aria-hidden', 'false');
    }
  }, true);

})();


/* =========================================================
   B8 CLEAN MOBILE LYRICS — control independiente
   No intercepta #mobile-player-lyrics ni #btn-lyrics-toggle.
   ========================================================= */
(() => {
  const toggle = document.getElementById('mobile-inline-lyrics-toggle');
  const panel = document.getElementById('mobile-inline-lyrics');
  if (!toggle || !panel) return;

  const isMobileUi = () => document.body.classList.contains('mobile-layout') || document.body.classList.contains('mobile-mode');

  function syncMobileInlineLyrics() {
    if (!isMobileUi() || !panel.classList.contains('is-visible')) return;
    const source = document.getElementById('lyrics-body');
    const active = source?.querySelector('.lyrics-line.active');
    if (active) {
      panel.innerHTML = active.outerHTML;
      panel.setAttribute('aria-hidden', 'false');
      return;
    }
    panel.textContent = 'Sin letra disponible.';
  }

  const sourceLyrics = document.getElementById('lyrics-body');
  let lyricsSyncRaf = 0;
  const queueLyricsSync = () => {
    if (!isMobileUi() || !panel.classList.contains('is-visible')) return;
    if (lyricsSyncRaf) return;
    lyricsSyncRaf = window.requestAnimationFrame(() => {
      lyricsSyncRaf = 0;
      syncMobileInlineLyrics();
    });
  };

  // El reproductor puede cambiar la línea activa después de timeupdate.
  // Observamos esos cambios para que la letra pequeña siga automáticamente
  // la canción, sin obligar al usuario a cerrar y volver a abrir el botón.
  const lyricsObserver = sourceLyrics ? new MutationObserver(queueLyricsSync) : null;
  lyricsObserver?.observe(sourceLyrics, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'data-active']
  });

  toggle.addEventListener('click', (event) => {
    if (!isMobileUi()) return;
    event.preventDefault();
    event.stopPropagation();
    const visible = panel.classList.toggle('is-visible');
    toggle.setAttribute('aria-expanded', String(visible));
    panel.setAttribute('aria-hidden', String(!visible));
    if (visible) syncMobileInlineLyrics();
  });

  // Reutiliza el mismo reloj de audio de la aplicación; no crea intervalos nuevos.
  const audioNodes = [document.getElementById('audio1'), document.getElementById('audio2')].filter(Boolean);
  audioNodes.forEach(audio => {
    audio.addEventListener('timeupdate', queueLyricsSync, { passive: true });
  });

  window.addEventListener('resize', queueLyricsSync, { passive: true });
})();
