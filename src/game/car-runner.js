// =====================================================================
// 3D bilspill: Highway Times Tables-stil for Safe Home
// Fire filer, matte hver 2. bølge (1–12-gangen), fire svarporter på veien.
// Feil svar / miss / krasj avslutter runden. Trafikk mellom oppgavene.
// Kart-temaer, lakk, oppgraderinger (turbo/magnet/skjold).
// 100 % prosedyrelt — modellene kommer fra src/3dassets/models.js.
// =====================================================================
import * as THREE from "../vendor/three.module.min.js";
import {
  createPlayerCar, createShieldKit,
  createTrafficCar, createTrafficVan, createTrafficBus, createTrafficTruck,
  createCoin, createBarrier, createAnswerSign, createFinishLine, createQuestionPlate,
  createTree, createCactus, createPalm, createStreetLight,
  disposeModel,
} from "../3dassets/models.js";
import { createEffects } from "./effects.js";

// ---------- Konstanter — Highway Times Tables-stil ----------
// Fire filer (fire svaralternativer), matte hver annen bølge,
// trafikk mellom oppgavene. Feil svar / krasj avslutter runden.
const LANES = [-3.0, -1.0, 1.0, 3.0];
const SEGMENT_LENGTH = 10;
const SEGMENT_COUNT = 12;
const ROAD_WIDTH = 11;
const SPAWN_Z = -80;
const DESPAWN_Z = 8;
const BASE_SPEED = 14;
const MAX_SPEED = 24;
const WAVE_INTERVAL = 1.15;
const COLLIDE_Z = 1.1;
const SLOWDOWN_DURATION = 1.0;
const SLOWDOWN_FACTOR = 0.45;
const MAX_DT = 0.1;
const QUESTION_EVERY = 2; // hver 2. bølge = matte (som Highway)
const QUESTION_BONUS_COINS = 4; // bonus for riktig svar
const TABLE_MAX = 12; // 1–12-gangen som Highway Times Tables
const QUESTION_APPROACH_SLOW = 0.72; // litt saktere når oppgave er aktiv
const HOVER_Z = -22; // skilt svever her til mållinjen låser dem
const BASE_SECONDS_PER_COIN = 10; // fast base; skaleres med rewardScale
const SURVIVAL_END_DELAY = 0.75; // VFX før resulteskjerm
const BOMB_REGEN = 0.12;
const BOMB_DRAIN_SLOW = 0.25;
const BOMB_DRAIN_MID = 0.06;

// Palett: ZeBeyond-tema
const COLOR_BG = 0x030504;
const COLOR_MINT = 0x38e6ac;
const COLOR_CYAN = 0x6efdff;

// Standardtema = Nattbyen (dagens utseende). Må samsvare med "nattby"
// i shop-data.js — brukes når opts.theme ikke er sendt inn.
const DEFAULT_THEME = {
  skyStops: [[0.0, "#02040a"], [0.55, "#03110d"], [0.78, "#0a3527"], [0.88, "#0d503a"], [1.0, "#020403"]],
  fogColor: 0x030807, fogNear: 26, fogFar: 95,
  groundColor: 0x06110c,
  trunkColor: 0x2b241c,
  foliageColor: 0x0d3325,
  railColor: 0x9aa8a2,
  lampColor: 0xfff2cf,
  lampEmissive: 0xffe9b0,
  ambientColor: 0x8fd8c0, ambientIntensity: 0.32,
  hemiSky: 0x2a6d55, hemiGround: 0x050807, hemiIntensity: 0.5,
  sunColor: 0xcfeee2, sunIntensity: 1.5,
  starOpacity: 0.8,
  glowColor: COLOR_MINT, glowOpacity: 0.055,
  scenery: "tre",
};

function streakBonus(streak, secondsPerCoin) {
  if (streak >= 10) return Math.floor(secondsPerCoin * 0.5);
  if (streak >= 5) return Math.floor(secondsPerCoin * 0.25);
  return 0;
}

// ---------- Prosedyrelle teksturer (offline, ingen filer) ----------
function makeAsphaltTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#101413";
  ctx.fillRect(0, 0, 256, 256);
  // kornete asfalt-støy
  for (let i = 0; i < 5200; i++) {
    const shade = 12 + Math.random() * 26;
    ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 1})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  // noen lysere slitasjeflekker
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = "rgba(66,74,70,0.05)";
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 22, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  tex.anisotropy = 4;
  return tex;
}

function makeSkyTexture(stops) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  for (const [pos, color] of stops) g.addColorStop(pos, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// Stabil shuffle (Fisher–Yates) — Math.random()-sort er ustabil.
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// Riktig svar + tre unike feilsvar (fire alternativer / fire filer).
function makeAnswers(a, b) {
  const correct = a * b;
  const candidates = [
    a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b,
    correct + a, correct - b, correct + 1, correct - 1,
    correct + 2, correct - 2, correct + 10, correct - 10,
    a * (b + 2), (a + 2) * b,
  ];
  shuffleInPlace(candidates);
  const picks = [];
  for (const c of candidates) {
    if (picks.length >= 3) break;
    if (c > 0 && c !== correct && !picks.includes(c)) picks.push(c);
  }
  while (picks.length < 3) {
    const c = correct + 3 + picks.length * 7;
    if (c > 0 && c !== correct && !picks.includes(c)) picks.push(c);
  }
  return shuffleInPlace([correct, ...picks]);
}

export function createCarRunner(canvas, options = {}) {
  const opts = {
    rewardScale: 1,
    secondsPerCoin: null, // legacy; brukes bare hvis rewardScale mangler
    mode: "normal", // "normal" | "bomb"
    paint: COLOR_MINT,
    upgrades: null,
    theme: null,
    onEarn: () => {},
    onComboBreak: () => {},
    onStatsUpdate: () => {},
    onReady: () => {},
    onQuestion: () => {},
    onCoinCollect: () => {},
    onShieldUsed: () => {},
    onBombHealth: () => {},
    onGameOver: () => {},
    ...options,
  };

  let rewardScale = Math.min(2, Math.max(0.5, Number(opts.rewardScale) || 1));
  // Bakoverkompatibilitet hvis noen fortsatt sender secondsPerCoin
  if (opts.secondsPerCoin != null && options.rewardScale == null) {
    rewardScale = Math.min(2, Math.max(0.5, (opts.secondsPerCoin | 0) / 20));
  }
  function secondsPerCoin() {
    return BASE_SECONDS_PER_COIN * rewardScale;
  }

  const gameMode = opts.mode === "bomb" ? "bomb" : "normal";
  const bombMode = gameMode === "bomb";

  const theme = { ...DEFAULT_THEME, ...(opts.theme || {}) };
  const upgrades = { turbo: 0, magnet: 0, skjold: 0, ...(opts.upgrades || {}) };
  const paintColor = opts.paint ?? COLOR_MINT;

  // Bil-fordeler fra garasjen (opts.car = getCar(profile.selectedCar)):
  // turboBonus/magnetBonus legges oppå kjøpte nivåer, freeShield gir
  // gratis skjold hver runde, style styrer karosseriet.
  const carStyle = opts.car?.style || "sport";
  const carPerk = opts.car?.perk || {};

  // Oppgraderingseffekter
  const turboLevel = Math.max(0, Math.min(3, (upgrades.turbo | 0) + (carPerk.turboBonus || 0)));
  const speedScale = 1 + turboLevel * 0.1; // +10 % toppfart og aks per nivå
  const baseSpeed = BASE_SPEED * speedScale;
  const maxSpeed = MAX_SPEED * speedScale;
  const magnetLevel = Math.max(0, Math.min(2, Math.max(upgrades.magnet | 0, carPerk.magnetBonus || 0)));
  const magnetRange = magnetLevel >= 2 ? 42 : 24; // z-avstand der magneten fanger
  const magnetPull = magnetLevel >= 2 ? 11 : 6.5; // sideveis hastighet (enheter/s)

  // Lav grafikk: eksplisitt via ?lowgfx i URL, eller automatisk
  // nedgradering hvis maskinen ikke holder følge (se auto-tune i loopen).
  let lowGraphics =
    opts.lowGraphics === true ||
    new URLSearchParams(window.location.search).has("lowgfx");

  // ---------- Renderer ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGraphics });
  } catch (err) {
    throw new Error("WebGL er ikke tilgjengelig på denne enheten.");
  }
  renderer.setPixelRatio(lowGraphics ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = !lowGraphics;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const disposables = []; // geometrier/materialer/teksturer å rydde opp

  function track(...items) {
    disposables.push(...items);
    return items[0];
  }

  // ---------- Scene ----------
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear, theme.fogFar);

  // Himmel: gradient-kuppel + stjerner (farger fra kart-temaet)
  const skyTex = track(makeSkyTexture(theme.skyStops));
  const skyMat = track(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  const skyGeo = track(new THREE.SphereGeometry(140, 24, 16));
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  const starCount = 260;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // spre stjerner på øvre halvkule
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.42;
    const r = 132;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi) * 0.9 + 8;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = track(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = track(new THREE.PointsMaterial({ color: 0xbfe8dc, size: 0.55, sizeAttenuation: true, fog: false, transparent: true, opacity: theme.starOpacity }));
  scene.add(new THREE.Points(starGeo, starMat));

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
  // Høyere «chase»-kamera som i Highway Times Tables (ser nedover veien)
  camera.position.set(0, 9.5, 11.5);
  camera.lookAt(0, 0, -18);

  const fxOverlay = typeof document !== "undefined"
    ? document.getElementById("car-fx-overlay")
    : null;
  const effects = createEffects({
    scene,
    camera,
    overlayEl: fxOverlay,
    lowGraphics,
  });
  disposables.push({ dispose: () => effects.dispose() });

  // ---------- Lys (farger og styrke fra kart-temaet) ----------
  scene.add(new THREE.AmbientLight(theme.ambientColor, theme.ambientIntensity));
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  moon.position.set(7, 14, -6);
  moon.castShadow = !lowGraphics;
  moon.shadow.mapSize.set(512, 512);
  moon.shadow.camera.left = -10;
  moon.shadow.camera.right = 10;
  moon.shadow.camera.top = 8;
  moon.shadow.camera.bottom = -46;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 40;
  moon.shadow.bias = -0.002;
  scene.add(moon);
  scene.add(moon.target);

  const rim = new THREE.DirectionalLight(COLOR_CYAN, 0.3);
  rim.position.set(-6, 4, -8);
  scene.add(rim);

  // Horisont-glød (ekko av låseskjermen — farge fra kart-temaet)
  const glowMat = track(new THREE.MeshBasicMaterial({ color: theme.glowColor, transparent: true, opacity: theme.glowOpacity, depthWrite: false, fog: false }));
  const glow = new THREE.Mesh(track(new THREE.CircleGeometry(34, 40)), glowMat);
  glow.position.set(0, 3, -92);
  scene.add(glow);

  // ---------- Vei + landskap: resyklerende segmenter ----------
  const roadSegments = [];
  const asphaltTex = track(makeAsphaltTexture());
  const roadMat = track(new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.94, metalness: 0.02 }));
  const roadGeo = track(new THREE.PlaneGeometry(ROAD_WIDTH, SEGMENT_LENGTH));

  const groundMat = track(new THREE.MeshStandardMaterial({ color: theme.groundColor, roughness: 1 }));
  const groundGeo = track(new THREE.PlaneGeometry(90, SEGMENT_LENGTH));

  const dashMat = track(new THREE.MeshStandardMaterial({ color: 0xd8e6df, roughness: 0.6, emissive: 0x223330, emissiveIntensity: 0.25 }));
  const dashGeo = track(new THREE.PlaneGeometry(0.12, 1.7));

  const edgeLineMat = track(new THREE.MeshStandardMaterial({ color: COLOR_MINT, emissive: COLOR_MINT, emissiveIntensity: 0.85, roughness: 0.4 }));
  const edgeLineGeo = track(new THREE.PlaneGeometry(0.11, SEGMENT_LENGTH));

  const railPostGeo = track(new THREE.BoxGeometry(0.09, 0.5, 0.09));
  const railBarGeo = track(new THREE.BoxGeometry(0.07, 0.16, SEGMENT_LENGTH));
  const railMat = track(new THREE.MeshStandardMaterial({ color: theme.railColor, metalness: 0.85, roughness: 0.35 }));

  // Veidekor per kart-tema: tre/snøtre, kaktus eller palme — modeller
  // fra 3dassets, fargene kommer fra temaet.
  function makeScenery(x, z, scale) {
    let g;
    if (theme.scenery === "kaktus") {
      g = createCactus({ foliageColor: theme.foliageColor });
    } else if (theme.scenery === "palme") {
      g = createPalm({ trunkColor: theme.trunkColor, foliageColor: theme.foliageColor });
    } else {
      // "tre" og "snøtre": samme form, snø på de øvre lagene ved "snøtre"
      g = createTree({
        trunkColor: theme.trunkColor,
        foliageColor: theme.foliageColor,
        snow: theme.scenery === "snøtre",
      });
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    return g;
  }

  // Gatelys: modell fra 3dassets. Armen peker innover veien, og bare
  // noen av stolpene har ekte spotlight slått på (ytelse).
  function makeStreetLight(side, z, withLight) {
    const g = createStreetLight({
      lampColor: theme.lampColor,
      lampEmissive: theme.lampEmissive,
      withLight,
    });
    // Modellens arm peker mot -z — roter slik at den peker mot veisenter
    g.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.position.set(side * (ROAD_WIDTH / 2 + 0.9), 0, z);
    return g;
  }

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const seg = new THREE.Group();

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    seg.add(ground);

    const plane = new THREE.Mesh(roadGeo, roadMat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    seg.add(plane);

    // Stiplede fillinjer mellom de fire filene (Highway-stil)
    for (const x of [-2, 0, 2]) {
      for (let d = 0; d < 3; d++) {
        const dash = new THREE.Mesh(dashGeo, dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x, 0.012, -SEGMENT_LENGTH / 2 + 1.6 + d * 3.4);
        seg.add(dash);
      }
    }
    // Mint kantlinjer
    for (const x of [-ROAD_WIDTH / 2 + 0.22, ROAD_WIDTH / 2 - 0.22]) {
      const edge = new THREE.Mesh(edgeLineGeo, edgeLineMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(x, 0.012, 0);
      seg.add(edge);
    }
    // Autovern, gatelys og veidekor samles i en egen gruppe per segment,
    // slik at de kan skjules i lavgrafikk-modus
    const scenery = new THREE.Group();
    scenery.name = "scenery";

    for (const side of [-1, 1]) {
      const bx = side * (ROAD_WIDTH / 2 + 0.45);
      const bar = new THREE.Mesh(railBarGeo, railMat);
      bar.position.set(bx, 0.42, 0);
      scenery.add(bar);
      for (let pz = -SEGMENT_LENGTH / 2 + 1.4; pz <= SEGMENT_LENGTH / 2 - 1.4; pz += 4.4) {
        const post = new THREE.Mesh(railPostGeo, railMat);
        post.position.set(bx, 0.2, pz);
        scenery.add(post);
      }
    }
    if (i % 2 === 0) {
      // Ekte spotlight bare på annethvert gatelys (og aldri i lavgrafikk)
      scenery.add(makeStreetLight(i % 4 === 0 ? -1 : 1, 0, !lowGraphics && i % 4 === 0));
    }
    const treeCount = 1 + (i % 2);
    for (let t = 0; t < treeCount; t++) {
      const side = t % 2 === 0 ? -1 : 1;
      const dist = 6.2 + ((i * 7 + t * 13) % 10);
      const tz = -SEGMENT_LENGTH / 2 + ((i * 5 + t * 17) % SEGMENT_LENGTH);
      const scale = 0.8 + ((i + t * 3) % 5) * 0.18;
      scenery.add(makeScenery(side * dist, tz, scale));
    }
    scenery.visible = !lowGraphics;
    seg.add(scenery);

    seg.position.z = -i * SEGMENT_LENGTH + SEGMENT_LENGTH;
    scene.add(seg);
    roadSegments.push(seg);
  }

  // ---------- Bil: modell fra 3dassets ----------
  const car = createPlayerCar({ paint: paintColor, turbo: turboLevel, magnet: magnetLevel, style: carStyle });
  const bodyMat = car.userData.paintMaterial; // lakken blinker grønn/rød ved svar
  const wheels = car.userData.wheels;         // spinnes i loopen
  scene.add(car);

  // Frontlys som faktisk lyser opp veien (hoppes over i lavgrafikk)
  let headlight = null;
  if (!lowGraphics) {
    headlight = new THREE.SpotLight(0xdffff6, 22, 26, 0.5, 0.55, 1.6);
    headlight.position.set(0, 0.55, -1.0);
    headlight.target.position.set(0, 0, -12);
    car.add(headlight);
    car.add(headlight.target);
  }

  // ---------- Synlige oppgraderinger på bilen ----------
  // Turbo-flammene sitter på modellen og pulseres i loopen (som før)
  const turboFlames = car.userData.flames || [];

  // Skjold: tydelig cyan ring + kuppel rundt bilen. Bygges alltid,
  // styres med visible slik at den kan brukes opp midt i en runde.
  // Skjold kommer enten fra kjøpt oppgradering eller bilens freeShield-fordel.
  const shieldKit = createShieldKit();
  let shieldActive = upgrades.skjold > 0 || carPerk.freeShield === true;
  const shieldRing = shieldKit.userData.ring;
  const shieldDome = shieldKit.userData.dome;
  shieldRing.visible = shieldActive;
  shieldDome.visible = shieldActive;
  car.add(shieldKit);

  // ---------- Mynter, hindringer og skilt: modeller fra 3dassets ----------
  // Fjerning av spawnede modeller må også frigjøre geometri/materialer.
  function removeWorldObject(obj) {
    scene.remove(obj.mesh);
    disposeModel(obj.mesh);
  }

  function makeSign(value) {
    return createAnswerSign(value);
  }

  function makeCoin() {
    return createCoin();
  }

  function makeBarrier() {
    return createBarrier();
  }

  // Trafikk: bil / varebil / buss / lastebil (modeller fra 3dassets)
  const trafficColors = [0xe2483d, 0x3d7be2, 0xffc94a, 0x9b5de5, 0xf2f4f3, 0x2ecc71, 0x555555, 0x1a7a4a];
  // Personbil vektet høyere — den er vanligst ute i trafikken
  const trafficBuilders = [createTrafficCar, createTrafficCar, createTrafficVan, createTrafficBus, createTrafficTruck];
  function makeTrafficCar() {
    const color = trafficColors[Math.floor(Math.random() * trafficColors.length)];
    const build = trafficBuilders[Math.floor(Math.random() * trafficBuilders.length)];
    return build(color);
  }

  // ---------- Kjøretilstand (uendret logikk) ----------
  let running = false;
  let disposed = false;
  let rafId = null;
  let lastTime = 0;
  let laneIndex = 1;
  let distance = 0;
  let slowdownUntil = 0;
  let elapsed = 0;
  let waveTimer = 0;
  let waveCount = 0;
  let questionRoundId = 0;
  let questionActive = false;
  let combo = 0;
  let comboBest = 0;
  let coinsCollected = 0;
  let worldObjects = [];
  let flashUntil = 0;
  let throttle = 1;
  const driveKeys = { gas: false, brake: false };
  let gamePhase = "stopped"; // "playing" | "dying" | "stopped"
  let endReason = null;
  let endAt = 0;
  let bombHealth = 1;
  let currentSpeed = baseSpeed;
  let questionPlate = null; // aktiv 3D-oppgaveplate

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 400;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement || canvas);

  function steer(direction) {
    laneIndex = Math.min(LANES.length - 1, Math.max(0, laneIndex + direction));
  }

  function onKeyDown(e) {
    if (gamePhase !== "playing") return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      if (!e.repeat) steer(-1);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      if (!e.repeat) steer(1);
      e.preventDefault();
    } else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      driveKeys.gas = true;
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      driveKeys.brake = true;
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      driveKeys.gas = false;
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      driveKeys.brake = false;
    }
  }

  let touchStartX = null;
  function onTouchStart(e) {
    if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
  }
  function onTouchEnd(e) {
    if (gamePhase !== "playing" || touchStartX === null) return;
    const endX = e.changedTouches[0].clientX;
    const delta = endX - touchStartX;
    touchStartX = null;
    if (Math.abs(delta) >= 24) {
      steer(delta > 0 ? 1 : -1);
    } else {
      const rect = canvas.getBoundingClientRect();
      steer(endX < rect.left + rect.width / 2 ? -1 : 1);
    }
  }

  function addListeners() {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
  }
  function removeListeners() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchend", onTouchEnd);
    driveKeys.gas = false;
    driveKeys.brake = false;
  }

  // ---------- Spawning ----------
  function spawnWave() {
    // Trafikk mellom matteoppgavene — alltid minst én ledig fil
    const laneIdxs = LANES.map((_, i) => i);
    const blockedCount = Math.random() < 0.55 ? 2 : 1;
    const shuffled = laneIdxs.slice().sort(() => Math.random() - 0.5);
    const blocked = shuffled.slice(0, Math.min(blockedCount, LANES.length - 1));
    const free = laneIdxs.filter((l) => !blocked.includes(l));

    for (const lane of blocked) {
      // Nesten alltid trafikk-biler (sjeldent sperring)
      if (Math.random() < 0.9) {
        const mesh = makeTrafficCar();
        mesh.position.set(LANES[lane], 0, SPAWN_Z);
        scene.add(mesh);
        worldObjects.push({
          mesh,
          lane,
          targetLane: lane,
          kind: "obstacle",
          isTraffic: true,
          // 0 = står stille (du tar dem igjen fort), ~0.85 = nesten din fart
          rel: 0.2 + Math.random() * 0.65,
          laneChangeTimer: 1.5 + Math.random() * 4,
          bobPhase: 0,
        });
      } else {
        const mesh = makeBarrier();
        mesh.position.set(LANES[lane], 0, SPAWN_Z);
        scene.add(mesh);
        worldObjects.push({ mesh, lane, kind: "obstacle", isTraffic: false, bobPhase: 0 });
      }
    }

    const coinCount = Math.random() < 0.5 ? 2 : 1;
    const freeShuffled = free.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(coinCount, freeShuffled.length); i++) {
      const lane = freeShuffled[i];
      const mesh = makeCoin();
      mesh.position.set(LANES[lane], 0.85, SPAWN_Z - i * 3);
      scene.add(mesh);
      worldObjects.push({ mesh, lane, kind: "coin", bobPhase: Math.random() * Math.PI * 2 });
    }
  }

  // Oppgaverunde: mållinje + fire skilt som svever til linjen låser dem
  function spawnQuestionWave() {
    const a = 1 + Math.floor(Math.random() * TABLE_MAX);
    const b = 1 + Math.floor(Math.random() * TABLE_MAX);
    const answers = makeAnswers(a, b);
    const roundId = ++questionRoundId;
    const text = `${a} × ${b}`;

    const line = createFinishLine(ROAD_WIDTH);
    line.position.set(0, 0, SPAWN_Z);
    scene.add(line);
    worldObjects.push({
      mesh: line,
      lane: -1,
      kind: "finishLine",
      roundId,
      locked: false,
    });

    if (questionPlate) {
      scene.remove(questionPlate);
      disposeModel(questionPlate);
    }
    questionPlate = createQuestionPlate(text);
    questionPlate.position.set(0, 0, HOVER_Z);
    scene.add(questionPlate);
    worldObjects.push({
      mesh: questionPlate,
      lane: -1,
      kind: "questionPlate",
      roundId,
      sticky: true,
      locked: false,
    });

    answers.forEach((value, lane) => {
      const mesh = makeSign(value);
      mesh.position.set(LANES[lane], 0, HOVER_Z);
      scene.add(mesh);
      worldObjects.push({
        mesh,
        lane,
        kind: "sign",
        value,
        correct: value === a * b,
        roundId,
        sticky: true,
        locked: false,
      });
    });
    opts.onQuestion({ text, answers });
    questionActive = true;
  }

  function spawnNextWave() {
    // Aldri ny bølge mens en oppgave er aktiv — ellers bytter svarene
    // (HUD + nye skilt) mens de gamle fortsatt står på veien.
    if (questionActive) return;
    waveCount += 1;
    if (waveCount % QUESTION_EVERY === 0) spawnQuestionWave();
    else spawnWave();
  }

  function clearWorldObjects() {
    for (const obj of worldObjects) {
      removeWorldObject(obj);
    }
    worldObjects = [];
    questionActive = false;
    questionPlate = null;
    opts.onQuestion(null);
  }

  // Kort glimt i lakken: grønt ved riktig svar, rødt ved feil
  function flashCar(color) {
    bodyMat.emissive.setHex(color);
    bodyMat.emissiveIntensity = 0.85;
    flashUntil = elapsed + 0.45;
  }

  // Fjerner alle skiltene i runden og skjuler oppgaven i HUD-en
  function endQuestionRound(roundId) {
    questionActive = false;
    for (const o of worldObjects) {
      if (
        (o.kind === "sign" || o.kind === "finishLine" || o.kind === "questionPlate") &&
        o.roundId === roundId
      ) {
        o.resolved = true;
        removeWorldObject(o);
      }
    }
    questionPlate = null;
    opts.onQuestion(null);
  }

  function bumpCombo() {
    combo += 1;
    if (combo > comboBest) comboBest = combo;
  }

  // Bilen passerte et svarskilt: vurder svaret (feil = runden over)
  function resolveQuestion(hit) {
    const pos = hit.mesh.position.clone();
    endQuestionRound(hit.roundId);
    if (hit.correct) {
      bumpCombo();
      coinsCollected += QUESTION_BONUS_COINS;
      opts.onEarn(secondsPerCoin() * QUESTION_BONUS_COINS);
      for (let i = 0; i < QUESTION_BONUS_COINS; i++) opts.onCoinCollect();
      flashCar(COLOR_MINT);
      effects.glory(pos);
      opts.onStatsUpdate({ combo, coinsCollected });
    } else {
      combo = 0;
      flashCar(0xe2483d);
      effects.failBurst(pos, false);
      opts.onComboBreak();
      opts.onStatsUpdate({ combo, coinsCollected });
      endRun("wrong");
    }
  }

  function finalizeGameOver() {
    gamePhase = "stopped";
    running = false;
    opts.onQuestion(null);
    opts.onGameOver({
      reason: endReason,
      coinsCollected,
      survivalSeconds: elapsed,
      distance,
      comboBest,
      mode: gameMode,
    });
  }

  function endRun(reason) {
    if (gamePhase !== "playing") return;
    gamePhase = "dying";
    endReason = reason;
    endAt = elapsed + SURVIVAL_END_DELAY;
    opts.onQuestion(null);

    const boomPos = new THREE.Vector3(car.position.x, 0.8, car.position.z);
    if (reason === "bomb") {
      effects.explode(boomPos, 1.6);
    } else if (reason === "crash") {
      effects.failBurst(boomPos, true);
    } else if (reason === "wrong" || reason === "miss") {
      effects.failBurst(boomPos, reason === "wrong");
    }
  }

  function collectCoin(obj) {
    removeWorldObject(obj);
    bumpCombo();
    coinsCollected += 1;
    const base = secondsPerCoin();
    const earned = base + streakBonus(combo, base);
    opts.onEarn(earned);
    opts.onCoinCollect();
    opts.onStatsUpdate({ combo, coinsCollected });
  }

  function hitObstacle(obj) {
    const pos = obj.mesh.position.clone();
    removeWorldObject(obj);
    if (shieldActive) {
      shieldActive = false;
      shieldRing.visible = false;
      shieldDome.visible = false;
      flashCar(COLOR_CYAN);
      effects.flash("rgba(110,253,255,0.4)", 0.25, 0.35);
      // Bare et KJØPT skjold forbrukes — bilens gratis skjold-generator
      // (freeShield) er klar igjen til neste runde.
      if (upgrades.skjold > 0) opts.onShieldUsed();
      opts.onStatsUpdate({ combo, coinsCollected });
      return;
    }
    combo = 0;
    flashCar(0xe2483d);
    effects.failBurst(pos, true);
    opts.onComboBreak();
    opts.onStatsUpdate({ combo, coinsCollected });
    endRun("crash");
  }

  // ---------- Game loop ----------
  let fpsSamples = 0;
  let fpsAccum = 0;
  let autoTuned = false;

  function degradeGraphics() {
    if (lowGraphics) return;
    lowGraphics = true;
    renderer.shadowMap.enabled = false;
    moon.castShadow = false;
    renderer.setPixelRatio(1);
    if (headlight) {
      car.remove(headlight);
      car.remove(headlight.target);
      headlight = null;
    }
    for (const seg of roadSegments) {
      const sc = seg.getObjectByName("scenery");
      if (sc) sc.visible = false;
    }
    resize();
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    const rawDt = (now - lastTime) / 1000 || 0;
    const dt = Math.min(MAX_DT, rawDt);
    lastTime = now;
    elapsed += dt;

    // Auto-tune: hvis maskinen ligger under ~24 fps de første sekundene,
    // skru ned grafikken én gang i stedet for å la spillet hakke.
    if (!autoTuned && rawDt > 0) {
      fpsAccum += rawDt;
      fpsSamples += 1;
      if (fpsSamples >= 40) {
        autoTuned = true;
        const avgFps = fpsSamples / fpsAccum;
        if (avgFps < 24) {
          degradeGraphics();
          effects.setLowGraphics(true);
        }
      }
    }

    // Døende: bare VFX + render til resulteskjermen vises
    if (gamePhase === "dying") {
      const camBase = {
        x: car.position.x * 0.4,
        y: 9.5,
        z: 11.5,
      };
      effects.update(dt, camBase);
      camera.lookAt(car.position.x * 0.25, 0.2, -18);
      renderer.render(scene, camera);
      if (elapsed >= endAt) {
        running = false;
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        finalizeGameOver();
      }
      return;
    }

    if (gamePhase !== "playing") return;

    waveTimer += dt;

    let speed = Math.min(maxSpeed, baseSpeed + distance * 0.004 * speedScale);
    // Gass / brems
    if (driveKeys.gas && !driveKeys.brake) {
      throttle = Math.min(1.6, throttle + dt * 1.4);
    } else if (driveKeys.brake) {
      throttle = Math.max(0.22, throttle - dt * 2.4);
    } else {
      throttle += (1 - throttle) * Math.min(1, dt * 1.6);
    }
    speed *= throttle;
    if (elapsed < slowdownUntil) speed *= SLOWDOWN_FACTOR;
    if (questionActive) speed *= QUESTION_APPROACH_SLOW;
    currentSpeed = speed;
    distance += speed * dt;

    // Fartsbombe: helse følger fart
    if (bombMode) {
      const speedRatio = currentSpeed / maxSpeed;
      if (speedRatio >= 0.75) bombHealth += BOMB_REGEN * dt;
      else if (speedRatio <= 0.45) bombHealth -= BOMB_DRAIN_SLOW * dt;
      else bombHealth -= BOMB_DRAIN_MID * dt;
      bombHealth = Math.min(1, Math.max(0, bombHealth));
      opts.onBombHealth(bombHealth);
      if (bombHealth <= 0) {
        endRun("bomb");
      }
    }

    if (gamePhase !== "playing") {
      const camBaseEarly = { x: car.position.x * 0.4, y: 9.5, z: 11.5 };
      effects.update(dt, camBaseEarly);
      camera.lookAt(car.position.x * 0.25, 0.2, -18);
      renderer.render(scene, camera);
      return;
    }

    if (waveTimer >= WAVE_INTERVAL) {
      if (questionActive) {
        waveTimer = WAVE_INTERVAL;
      } else {
        waveTimer -= WAVE_INTERVAL;
        spawnNextWave();
      }
    }

    let minZ = Infinity;
    for (const seg of roadSegments) {
      if (seg.position.z < minZ) minZ = seg.position.z;
    }
    for (const seg of roadSegments) {
      seg.position.z += speed * dt;
      if (seg.position.z > SEGMENT_LENGTH) {
        seg.position.z = minZ - SEGMENT_LENGTH + speed * dt;
        minZ = seg.position.z;
      }
    }

    // Finn aktiv mållinje for sticky-lås
    let activeLine = null;
    for (const o of worldObjects) {
      if (o.kind === "finishLine" && !o.resolved) {
        activeLine = o;
        break;
      }
    }
    if (activeLine && !activeLine.locked && activeLine.mesh.position.z >= HOVER_Z) {
      activeLine.locked = true;
      for (const o of worldObjects) {
        if (o.sticky && o.roundId === activeLine.roundId) o.locked = true;
      }
    }
    const lockZ = activeLine && activeLine.locked ? activeLine.mesh.position.z : HOVER_Z;

    const next = [];
    let stopCollisions = false;
    for (const obj of worldObjects) {
      if (obj.resolved) continue;

      if (obj.kind === "obstacle" && obj.isTraffic) {
        obj.mesh.position.z += speed * (1 - obj.rel) * dt;
        obj.laneChangeTimer -= dt;
        if (obj.laneChangeTimer <= 0) {
          obj.laneChangeTimer = 2 + Math.random() * 5;
          if (Math.random() < 0.5) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            obj.targetLane = Math.min(LANES.length - 1, Math.max(0, obj.lane + dir));
          }
        }
        const tx = LANES[obj.targetLane];
        obj.mesh.position.x += (tx - obj.mesh.position.x) * Math.min(1, dt * 2.8);
        if (Math.abs(obj.mesh.position.x - tx) < 0.12) {
          obj.lane = obj.targetLane;
        }
        obj.mesh.rotation.y = (tx - obj.mesh.position.x) * -0.08;
        if (obj.mesh.userData.wheels) {
          for (const w of obj.mesh.userData.wheels) w.rotation.x += speed * obj.rel * dt * 1.6;
        }
      } else if (obj.kind === "finishLine") {
        obj.mesh.position.z += speed * dt;
      } else if (obj.sticky) {
        // Hover: fast Z. Locked: følg mållinjen.
        obj.mesh.position.z = obj.locked ? lockZ : HOVER_Z;
        if (obj.kind === "sign") {
          obj.mesh.position.x = LANES[obj.lane];
        } else if (obj.kind === "questionPlate") {
          obj.mesh.position.x = 0;
        }
      } else {
        obj.mesh.position.z += speed * dt;
      }

      if (obj.kind === "coin") {
        obj.mesh.rotation.y += dt * 3.4;
        obj.mesh.position.y = 0.85 + Math.sin(elapsed * 3 + obj.bobPhase) * 0.12;
        if (magnetLevel > 0 && !obj.magnetized &&
            Math.abs(obj.lane - laneIndex) === 1 &&
            obj.mesh.position.z > -magnetRange && obj.mesh.position.z < 2) {
          obj.magnetized = true;
        }
        if (obj.magnetized) {
          const dx = car.position.x - obj.mesh.position.x;
          obj.mesh.position.x += Math.sign(dx) * Math.min(Math.abs(dx), magnetPull * dt);
        }
      }

      if (!stopCollisions && gamePhase === "playing") {
        const inRange = Math.abs(obj.mesh.position.z) < COLLIDE_Z;
        if (obj.kind === "sign") {
          if (obj.locked && inRange && obj.lane === laneIndex) {
            resolveQuestion(obj);
            if (gamePhase !== "playing") stopCollisions = true;
            continue;
          }
        } else if (obj.kind === "coin") {
          const hit = obj.magnetized
            ? Math.abs(obj.mesh.position.x - car.position.x) < 1.0
            : obj.lane === laneIndex;
          if (inRange && hit) {
            collectCoin(obj);
            continue;
          }
        } else if (obj.kind === "obstacle" && inRange && obj.lane === laneIndex) {
          hitObstacle(obj);
          if (gamePhase !== "playing") stopCollisions = true;
          continue;
        }

        if (obj.mesh.position.z > DESPAWN_Z) {
          if (obj.kind === "sign" || obj.kind === "finishLine") {
            endQuestionRound(obj.roundId);
            endRun("miss");
            stopCollisions = true;
            continue;
          }
          if (obj.kind === "questionPlate") {
            continue;
          }
          removeWorldObject(obj);
          continue;
        }
      } else if (obj.mesh.position.z > DESPAWN_Z && obj.kind !== "sign" && obj.kind !== "finishLine" && obj.kind !== "questionPlate") {
        removeWorldObject(obj);
        continue;
      }

      if (obj.isTraffic && obj.mesh.position.z < SPAWN_Z - 20) {
        removeWorldObject(obj);
        continue;
      }
      if (!obj.resolved) next.push(obj);
    }
    worldObjects = next;

    // Bil: glid mot mål-fil + bobbing + lene seg inn i svingen
    const targetX = LANES[laneIndex];
    car.position.x += (targetX - car.position.x) * Math.min(1, dt * 10);
    car.position.y = Math.sin(elapsed * 9) * 0.022;
    car.rotation.z = (car.position.x - targetX) * 0.14;
    car.rotation.y = (targetX - car.position.x) * -0.06;
    car.rotation.x = Math.sin(elapsed * 9) * 0.006;
    for (const wheel of wheels) wheel.rotation.x += speed * dt * 1.6;

    if (shieldActive) {
      shieldRing.rotation.y += dt * 0.8;
      shieldDome.rotation.y -= dt * 0.35;
    }
    for (let i = 0; i < turboFlames.length; i++) {
      const f = turboFlames[i];
      const pulse = 0.85 + Math.sin(elapsed * 18 + i) * 0.15;
      f.scale.set(pulse, 0.7 + Math.random() * 0.6, pulse);
    }

    if (flashUntil > 0 && elapsed >= flashUntil) {
      flashUntil = 0;
      bodyMat.emissive.setHex(paintColor);
      bodyMat.emissiveIntensity = 0.04;
    }

    moon.target.position.set(car.position.x, 0, -12);
    sky.position.x = camera.position.x;

    const camBase = {
      x: car.position.x * 0.4,
      y: 9.5,
      z: 11.5,
    };
    camera.position.x += (camBase.x - camera.position.x) * Math.min(1, dt * 3.5);
    camera.position.y = camBase.y;
    camera.position.z = camBase.z;
    camera.lookAt(car.position.x * 0.25, 0.2, -18);
    const speedT = (speed - baseSpeed) / (maxSpeed - baseSpeed);
    const targetFov = 60 + Math.max(0, speedT) * 7;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }

    effects.update(dt, {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    });

    renderer.render(scene, camera);
  }

  // ---------- Offentlig API ----------
  function resetState() {
    clearWorldObjects();
    effects.clear();
    laneIndex = 1;
    car.position.set(LANES[laneIndex], 0, 0);
    distance = 0;
    elapsed = 0;
    waveTimer = 0;
    waveCount = 0;
    slowdownUntil = 0;
    questionActive = false;
    throttle = 1;
    driveKeys.gas = false;
    driveKeys.brake = false;
    combo = 0;
    comboBest = 0;
    coinsCollected = 0;
    flashUntil = 0;
    bombHealth = 1;
    currentSpeed = baseSpeed;
    endReason = null;
    endAt = 0;
    gamePhase = "stopped";
    bodyMat.emissive.setHex(paintColor);
    bodyMat.emissiveIntensity = 0.04;
    opts.onStatsUpdate({ combo, coinsCollected });
    if (bombMode) opts.onBombHealth(1);
    else opts.onBombHealth(null);
  }

  const api = {
    start() {
      if (disposed) return;
      resetState();
      resize();
      addListeners();
      gamePhase = "playing";
      running = true;
      lastTime = performance.now();
      spawnWave();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      gamePhase = "stopped";
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      removeListeners();
      clearWorldObjects();
      effects.clear();
      renderer.render(scene, camera);
    },
    pause() {
      if (gamePhase === "dying") return;
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    resume() {
      if (disposed || running) return;
      if (gamePhase === "dying") {
        running = true;
        lastTime = performance.now();
        rafId = requestAnimationFrame(frame);
        return;
      }
      if (gamePhase !== "playing") gamePhase = "playing";
      running = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    dispose() {
      api.stop();
      disposed = true;
      resizeObserver.disconnect();
      disposeModel(car);
      for (const item of disposables) {
        if (item && typeof item.dispose === "function") item.dispose();
      }
      renderer.dispose();
    },
    setRewardScale(n) {
      rewardScale = Math.min(2, Math.max(0.5, Number(n) || 1));
    },
    /** @deprecated bruk setRewardScale */
    setSecondsPerCoin(n) {
      rewardScale = Math.min(2, Math.max(0.5, (Math.max(1, n | 0)) / 20));
    },
    setMode(mode) {
      // Modus settes ved create; recreate runner for bytte.
      opts.mode = mode === "bomb" ? "bomb" : "normal";
    },
  };

  resize();
  renderer.render(scene, camera);
  opts.onReady();

  return api;
}
