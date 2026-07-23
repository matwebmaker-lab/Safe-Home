// =====================================================================
// 3D bilspill: Highway Times Tables-stil for Skjermtid
// Fire filer, matte hver 2. bølge (1–12-gangen), fire svarporter på veien.
// Feil svar / miss / krasj avslutter runden. Trafikk mellom oppgavene.
// Kart-temaer, lakk, oppgraderinger (turbo/magnet/skjold).
// 100 % prosedyrelt — ingen eksterne modeller, ingen lyd.
// =====================================================================
import * as THREE from "../vendor/three.module.min.js";

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

// Palett: ZeBeyond-tema
const COLOR_BG = 0x030504;
const COLOR_MINT = 0x38e6ac;
const COLOR_CYAN = 0x6efdff;
const COLOR_COIN = 0xffc94a;

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

function makeStripeTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e8e4dc";
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "#e2483d";
  for (let x = -64; x < 160; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 24, 0);
    ctx.lineTo(x + 44, 0);
    ctx.lineTo(x + 20, 64);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
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

// Svar-sirkel på veien (som Highway Times Tables): hvit ring + tall.
function makeSignTexture(value) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  // Ytre hvit ring
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();
  // Tall
  ctx.fillStyle = "#111111";
  const text = String(value);
  ctx.font = text.length >= 3
    ? "bold 78px Arial Black, Impact, sans-serif"
    : "bold 100px Arial Black, Impact, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.premultiplyAlpha = false;
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
    secondsPerCoin: 20,
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
    onGameOver: () => {},
    ...options,
  };

  const theme = { ...DEFAULT_THEME, ...(opts.theme || {}) };
  const upgrades = { turbo: 0, magnet: 0, skjold: 0, ...(opts.upgrades || {}) };
  const paintColor = opts.paint ?? COLOR_MINT;

  // Oppgraderingseffekter
  const turboLevel = Math.max(0, Math.min(3, upgrades.turbo | 0));
  const speedScale = 1 + turboLevel * 0.1; // +10 % toppfart og aks per nivå
  const baseSpeed = BASE_SPEED * speedScale;
  const maxSpeed = MAX_SPEED * speedScale;
  const magnetLevel = Math.max(0, Math.min(2, upgrades.magnet | 0));
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

  const trunkGeo = track(new THREE.CylinderGeometry(0.09, 0.14, 1.1, 6));
  const trunkMat = track(new THREE.MeshStandardMaterial({ color: theme.trunkColor, roughness: 1 }));
  const foliageGeo = track(new THREE.ConeGeometry(0.85, 2.2, 7));
  const foliageMat = track(new THREE.MeshStandardMaterial({ color: theme.foliageColor, roughness: 0.95 }));
  const cactusGeo = track(new THREE.CylinderGeometry(0.2, 0.26, 1.9, 8));
  const cactusArmGeo = track(new THREE.SphereGeometry(0.3, 8, 6));
  const palmTrunkGeo = track(new THREE.CylinderGeometry(0.07, 0.13, 2.6, 6));
  const palmLeafGeo = track(new THREE.SphereGeometry(0.7, 8, 5));

  const poleGeo = track(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8));
  const armGeo = track(new THREE.BoxGeometry(0.07, 0.07, 1.1));
  const poleMat = track(new THREE.MeshStandardMaterial({ color: 0x3a4440, metalness: 0.7, roughness: 0.4 }));
  const lampGeo = track(new THREE.SphereGeometry(0.13, 10, 8));
  const lampMat = track(new THREE.MeshStandardMaterial({ color: theme.lampColor, emissive: theme.lampEmissive, emissiveIntensity: 2.4 }));

  // Veidekor per kart-tema: tre/snøtre (kjegle), kaktus (sylinder+kuler)
  // eller palme (stamme med flate bladkuler). Farger kommer fra temaet.
  function makeScenery(x, z, scale) {
    const g = new THREE.Group();
    if (theme.scenery === "kaktus") {
      const body = new THREE.Mesh(cactusGeo, foliageMat);
      body.position.y = 0.95;
      body.castShadow = true;
      const armL = new THREE.Mesh(cactusArmGeo, foliageMat);
      armL.position.set(-0.34, 1.15, 0);
      armL.scale.set(1, 1.5, 1);
      const armR = new THREE.Mesh(cactusArmGeo, foliageMat);
      armR.position.set(0.36, 0.85, 0);
      armR.scale.set(1, 1.3, 1);
      g.add(body, armL, armR);
    } else if (theme.scenery === "palme") {
      const trunk = new THREE.Mesh(palmTrunkGeo, trunkMat);
      trunk.position.y = 1.3;
      trunk.rotation.z = 0.12;
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 4; i++) {
        const leaf = new THREE.Mesh(palmLeafGeo, foliageMat);
        leaf.scale.set(1.5, 0.28, 0.55);
        leaf.position.set(Math.cos(i * Math.PI / 2) * 0.55, 2.6, Math.sin(i * Math.PI / 2) * 0.55);
        leaf.rotation.y = i * Math.PI / 2;
        g.add(leaf);
      }
    } else {
      // "tre" og "snøtre": samme form, fargen (grønn/hvit) styres av temaet
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.55;
      const top = new THREE.Mesh(foliageGeo, foliageMat);
      top.position.y = 1.9;
      top.castShadow = true;
      g.add(trunk, top);
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    return g;
  }

  function makeStreetLight(side, z) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 1.8;
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0, 3.55, side * -0.5);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(0, 3.5, side * -0.95);
    g.add(pole, arm, lamp);
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
      scenery.add(makeStreetLight(i % 4 === 0 ? -1 : 1, 0));
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

  // ---------- Bil: ekte silhuett via ExtrudeGeometry ----------
  const car = new THREE.Group();

  // Sideprofil i (x = lengderetning, y = høyde). Front peker mot -x her,
  // roteres så front peker mot -z i verden.
  const profile = new THREE.Shape();
  profile.moveTo(-1.15, 0.16);        // bak, nederst
  profile.lineTo(1.05, 0.16);         // front, nederst
  profile.lineTo(1.18, 0.34);         // støtfanger
  profile.lineTo(1.05, 0.52);         // over grillen
  profile.lineTo(0.38, 0.6);          // panser
  profile.lineTo(0.05, 0.95);         // frontrute
  profile.lineTo(-0.52, 0.97);        // tak
  profile.lineTo(-0.88, 0.62);        // bakrute
  profile.lineTo(-1.18, 0.55);        // bagasjelokk
  profile.lineTo(-1.15, 0.16);
  const bodyGeo = track(new THREE.ExtrudeGeometry(profile, { depth: 1.15, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }));
  bodyGeo.translate(0, 0, -0.575);
  const bodyMat = track(new THREE.MeshPhysicalMaterial({
    color: paintColor, // lakken velges i garasjen (opts.paint)
    metalness: 0.65,
    roughness: 0.28,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
    emissive: paintColor,
    emissiveIntensity: 0.04,
  }));
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.y = -Math.PI / 2; // profilens +x (front) -> verdens -z
  body.castShadow = true;
  car.add(body);

  // Vinduer: mørkt glass, litt innfelt
  const glassMat = track(new THREE.MeshPhysicalMaterial({ color: 0x0a1418, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.2 }));
  const windshield = new THREE.Mesh(track(new THREE.BoxGeometry(1.02, 0.34, 0.06)), glassMat);
  windshield.position.set(0, 0.78, -0.22);
  windshield.rotation.x = -0.72;
  car.add(windshield);
  const rearWindow = new THREE.Mesh(track(new THREE.BoxGeometry(1.0, 0.3, 0.05)), glassMat);
  rearWindow.position.set(0, 0.78, 0.68);
  rearWindow.rotation.x = 0.8;
  car.add(rearWindow);
  const sideGlassGeo = track(new THREE.BoxGeometry(0.04, 0.24, 0.85));
  for (const sx of [-0.57, 0.57]) {
    const side = new THREE.Mesh(sideGlassGeo, glassMat);
    side.position.set(sx, 0.75, 0.2);
    car.add(side);
  }

  // Frontlykter (hvit-cyan) og baklykter (røde)
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0xf4ffff, emissive: 0xd8fbff, emissiveIntensity: 3.2 }));
  const headGeo = track(new THREE.SphereGeometry(0.085, 10, 8));
  for (const sx of [-0.38, 0.38]) {
    const lamp = new THREE.Mesh(headGeo, headMat);
    lamp.position.set(sx, 0.42, -1.16);
    car.add(lamp);
  }
  const tailMat = track(new THREE.MeshStandardMaterial({ color: 0xff5348, emissive: 0xff2a20, emissiveIntensity: 2.6 }));
  const tailGeo = track(new THREE.BoxGeometry(0.26, 0.08, 0.05));
  for (const sx of [-0.36, 0.36]) {
    const lamp = new THREE.Mesh(tailGeo, tailMat);
    lamp.position.set(sx, 0.52, 1.17);
    car.add(lamp);
  }

  // Frontlys som faktisk lyser opp veien (hoppes over i lavgrafikk)
  let headlight = null;
  if (!lowGraphics) {
    headlight = new THREE.SpotLight(0xdffff6, 22, 26, 0.5, 0.55, 1.6);
    headlight.position.set(0, 0.55, -1.0);
    headlight.target.position.set(0, 0, -12);
    car.add(headlight);
    car.add(headlight.target);
  }

  // Hjul: dekk (torus) + felg (sylinder)
  const tireGeo = track(new THREE.TorusGeometry(0.21, 0.09, 10, 18));
  const tireMat = track(new THREE.MeshStandardMaterial({ color: 0x0b0d0c, roughness: 0.95 }));
  const rimGeo = track(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 12));
  const rimMat = track(new THREE.MeshStandardMaterial({ color: 0xbfd8cf, metalness: 0.9, roughness: 0.25 }));
  const wheels = [];
  for (const [wx, wz] of [[-0.62, 0.72], [0.62, 0.72], [-0.62, -0.72], [0.62, -0.72]]) {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.y = Math.PI / 2;
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.rotation.z = Math.PI / 2;
    wheel.add(tire, rimMesh);
    wheel.position.set(wx, 0.3, wz);
    wheel.castShadow = true;
    car.add(wheel);
    wheels.push(wheel);
  }
  scene.add(car);

  // ---------- Synlige oppgraderinger på bilen ----------
  // Turbo: spoiler (synlig oppgradering) + eksosflammer
  const turboFlames = [];
  if (turboLevel > 0) {
    const spoilerMat = track(new THREE.MeshStandardMaterial({
      color: 0x1a1e1c, metalness: 0.5, roughness: 0.4,
    }));
    const spoiler = new THREE.Mesh(track(new THREE.BoxGeometry(1.05, 0.08, 0.28)), spoilerMat);
    spoiler.position.set(0, 0.98, 0.95);
    car.add(spoiler);
    const spoilerStemL = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.22, 0.06)), spoilerMat);
    spoilerStemL.position.set(-0.35, 0.86, 0.95);
    const spoilerStemR = spoilerStemL.clone();
    spoilerStemR.position.x = 0.35;
    car.add(spoilerStemL, spoilerStemR);

    const pipeMat = track(new THREE.MeshStandardMaterial({
      color: 0x2a2e2c, metalness: 0.85, roughness: 0.3,
    }));
    const pipeGeo = track(new THREE.CylinderGeometry(0.07, 0.09, 0.35, 8));
    for (const sx of [-0.28, 0.28]) {
      const pipe = new THREE.Mesh(pipeGeo, pipeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx, 0.28, 1.28);
      car.add(pipe);
    }
    const flameMat = track(new THREE.MeshBasicMaterial({
      color: 0xff6a20,
      transparent: true,
      opacity: 0.85,
    }));
    for (let i = 0; i < turboLevel; i++) {
      for (const sx of [-0.28, 0.28]) {
        const flame = new THREE.Mesh(
          track(new THREE.ConeGeometry(0.08 + i * 0.02, 0.35 + i * 0.12, 6)),
          flameMat
        );
        flame.rotation.x = -Math.PI / 2;
        flame.position.set(sx, 0.28, 1.45 + i * 0.12);
        car.add(flame);
        turboFlames.push(flame);
      }
    }
  }

  // Magnet: synlige magnetskiver på sidene
  if (magnetLevel > 0) {
    const magMat = track(new THREE.MeshStandardMaterial({
      color: 0x2a6dff,
      emissive: 0x3d7be2,
      emissiveIntensity: 1.4 + magnetLevel * 0.6,
      metalness: 0.7,
      roughness: 0.25,
    }));
    const magGeo = track(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16));
    const coreMat = track(new THREE.MeshStandardMaterial({
      color: 0xe2483d,
      emissive: 0xff3344,
      emissiveIntensity: 1.2,
    }));
    for (const sx of [-0.72, 0.72]) {
      const mag = new THREE.Mesh(magGeo, magMat);
      mag.rotation.z = Math.PI / 2;
      mag.position.set(sx, 0.55, 0.05);
      car.add(mag);
      const core = new THREE.Mesh(track(new THREE.SphereGeometry(0.06, 8, 8)), coreMat);
      core.position.set(sx * 1.02, 0.55, 0.05);
      car.add(core);
    }
    if (magnetLevel >= 2) {
      const halo = new THREE.Mesh(
        track(new THREE.TorusGeometry(0.95, 0.035, 8, 28)),
        track(new THREE.MeshBasicMaterial({
          color: 0x6efdff,
          transparent: true,
          opacity: 0.55,
        }))
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.35;
      car.add(halo);
    }
  }

  // Skjold: tydelig cyan ring + kuppel rundt bilen
  let shieldActive = upgrades.skjold > 0;
  const shieldRing = new THREE.Mesh(
    track(new THREE.TorusGeometry(1.35, 0.07, 10, 40)),
    track(new THREE.MeshBasicMaterial({ color: COLOR_CYAN, transparent: true, opacity: 0.85 }))
  );
  shieldRing.position.y = 0.55;
  shieldRing.rotation.x = 0.15;
  shieldRing.visible = shieldActive;
  car.add(shieldRing);
  const shieldDome = new THREE.Mesh(
    track(new THREE.SphereGeometry(1.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)),
    track(new THREE.MeshBasicMaterial({
      color: COLOR_CYAN,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }))
  );
  shieldDome.position.y = 0.35;
  shieldDome.visible = shieldActive;
  car.add(shieldDome);

  // ---------- Mynter og hindringer ----------
  // Mynt: gullsylinder som en ekte mynt, står på høykant og spinner
  const coinGeo = track(new THREE.CylinderGeometry(0.44, 0.44, 0.09, 24));
  const coinMat = track(new THREE.MeshPhysicalMaterial({
    color: COLOR_COIN,
    metalness: 0.95,
    roughness: 0.22,
    emissive: 0x9a6a10,
    emissiveIntensity: 0.5,
  }));
  const coinRingGeo = track(new THREE.TorusGeometry(0.44, 0.045, 8, 26));

  // Hindring: stripet trafikksperring på bein
  const stripeTex = track(makeStripeTexture());
  const barrierMat = track(new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 }));
  const barrierPlainMat = track(new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.6 }));
  const barrierGeo = track(new THREE.BoxGeometry(1.5, 0.42, 0.22));
  const legGeo = track(new THREE.BoxGeometry(0.1, 0.5, 0.34));
  const legMat = track(new THREE.MeshStandardMaterial({ color: 0x494f4c, metalness: 0.5, roughness: 0.5 }));
  const barrierLightGeo = track(new THREE.SphereGeometry(0.06, 8, 6));
  const barrierLightMat = track(new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xff9500, emissiveIntensity: 3 }));

  // Svar-porter: hvite sirkler som svever over hver fil (Highway Times Tables-stil).
  // Du kjører GJENNOM sirkelen med riktig tall.
  const signDiscGeo = track(new THREE.CircleGeometry(0.95, 32));
  const signFaceMats = new Map();

  function getSignFaceMat(value) {
    let mat = signFaceMats.get(value);
    if (!mat) {
      mat = track(new THREE.MeshBasicMaterial({
        map: track(makeSignTexture(value)),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }));
      signFaceMats.set(value, mat);
    }
    return mat;
  }

  function makeSign(value) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(signDiscGeo, getSignFaceMat(value));
    // Stå nesten opp-ned mot kamera (litt tippet bakover som i videoen)
    disc.rotation.x = -0.35;
    disc.position.y = 1.15;
    disc.name = "signFace";
    g.add(disc);
    // Myk skygge/glød på asfalten under
    const glow = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.7, 20)),
      track(new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }))
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    g.add(glow);
    return g;
  }

  function makeCoin() {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(coinGeo, coinMat);
    disc.rotation.x = Math.PI / 2; // stå på høykant, flate mot spilleren
    const ring = new THREE.Mesh(coinRingGeo, coinMat);
    g.add(disc, ring);
    g.castShadow = true;
    disc.castShadow = true;
    return g;
  }

  function makeBarrier() {
    const g = new THREE.Group();
    const board = new THREE.Mesh(barrierGeo, [
      barrierPlainMat, barrierPlainMat, // sider
      barrierPlainMat, barrierPlainMat, // topp/bunn
      barrierMat, barrierMat,           // front/bak: striper
    ]);
    board.position.y = 0.62;
    board.castShadow = true;
    for (const lx of [-0.58, 0.58]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, 0.25, 0);
      g.add(leg);
    }
    const warnLight = new THREE.Mesh(barrierLightGeo, barrierLightMat);
    warnLight.position.set(0, 0.9, 0);
    g.add(board, warnLight);
    return g;
  }

  // Trafikk: bil / varebil / buss (som i Highway Times Tables)
  const trafficColors = [0xe2483d, 0x3d7be2, 0xffc94a, 0x9b5de5, 0xf2f4f3, 0x2ecc71, 0x555555, 0x1a7a4a];
  function makeTrafficCar() {
    const g = new THREE.Group();
    const color = trafficColors[Math.floor(Math.random() * trafficColors.length)];
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.45,
      roughness: 0.35,
    });
    const roll = Math.random();
    let body;
    let cabin;
    if (roll < 0.25) {
      // Buss
      body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 3.4), bodyMat);
      body.position.y = 0.7;
      cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 0.35, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x1a2220, metalness: 0.2, roughness: 0.5 })
      );
      cabin.position.set(0, 1.05, -1.2);
    } else if (roll < 0.5) {
      // Lastebil / varebil
      body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 2.6), bodyMat);
      body.position.y = 0.7;
      cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 0.45, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x2a3030, metalness: 0.3, roughness: 0.45 })
      );
      cabin.position.set(0, 0.95, -0.95);
    } else {
      // Vanlig bil
      body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 2.0), bodyMat);
      body.position.y = 0.45;
      cabin = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.32, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x1a2220, metalness: 0.2, roughness: 0.5 })
      );
      cabin.position.set(0, 0.78, -0.1);
    }
    body.castShadow = true;
    cabin.castShadow = true;
    g.add(body, cabin);
    return g;
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
  let waveCount = 0; // teller bølger — hver 7. blir en oppgaverunde
  let questionRoundId = 0;
  let questionActive = false;
  let combo = 0;
  let coinsCollected = 0;
  let worldObjects = [];
  let secondsPerCoin = opts.secondsPerCoin;
  let flashUntil = 0; // grønn/rød lakkglimt ved riktig/feil svar
  let throttle = 1; // 1 = cruise, >1 gass, <1 brems
  const driveKeys = { gas: false, brake: false };

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
    if (!running) return;
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
    if (!running || touchStartX === null) return;
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

  // Oppgaverunde: fire skilt-porter (ett svar per fil) — Highway-stil
  function spawnQuestionWave() {
    const a = 1 + Math.floor(Math.random() * TABLE_MAX);
    const b = 1 + Math.floor(Math.random() * TABLE_MAX);
    const answers = makeAnswers(a, b);
    const roundId = ++questionRoundId;
    answers.forEach((value, lane) => {
      const mesh = makeSign(value);
      mesh.position.set(LANES[lane], 0, SPAWN_Z);
      scene.add(mesh);
      worldObjects.push({ mesh, lane, kind: "sign", value, correct: value === a * b, roundId });
    });
    opts.onQuestion({ text: `${a} × ${b}`, answers });
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
      scene.remove(obj.mesh);
    }
    worldObjects = [];
    questionActive = false;
    opts.onQuestion(null); // skjul en eventuell aktiv oppgave i HUD-en
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
      if (o.kind === "sign" && o.roundId === roundId) {
        o.resolved = true;
        scene.remove(o.mesh);
      }
    }
    opts.onQuestion(null);
  }

  // Bilen passerte et svarskilt: vurder svaret (feil = runden over, Highway-stil)
  function resolveQuestion(hit) {
    endQuestionRound(hit.roundId);
    if (hit.correct) {
      combo += 1;
      coinsCollected += QUESTION_BONUS_COINS;
      opts.onEarn(secondsPerCoin * QUESTION_BONUS_COINS);
      for (let i = 0; i < QUESTION_BONUS_COINS; i++) opts.onCoinCollect();
      flashCar(COLOR_MINT);
      opts.onStatsUpdate({ combo, coinsCollected });
    } else {
      combo = 0;
      flashCar(0xe2483d);
      opts.onComboBreak();
      opts.onStatsUpdate({ combo, coinsCollected });
      endRun("wrong");
    }
  }

  function endRun(reason) {
    if (!running) return;
    running = false;
    paused = false;
    opts.onQuestion(null);
    opts.onGameOver({ reason, coinsCollected, earnedHint: coinsCollected });
  }

  function collectCoin(obj) {
    scene.remove(obj.mesh);
    combo += 1;
    coinsCollected += 1;
    const earned = secondsPerCoin + streakBonus(combo, secondsPerCoin);
    opts.onEarn(earned);
    opts.onCoinCollect();
    opts.onStatsUpdate({ combo, coinsCollected });
  }

  function hitObstacle(obj) {
    scene.remove(obj.mesh);
    if (shieldActive) {
      shieldActive = false;
      shieldRing.visible = false;
      shieldDome.visible = false;
      flashCar(COLOR_CYAN);
      opts.onShieldUsed();
      opts.onStatsUpdate({ combo, coinsCollected });
      return;
    }
    combo = 0;
    flashCar(0xe2483d);
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
    waveTimer += dt;

    // Auto-tune: hvis maskinen ligger under ~24 fps de første sekundene,
    // skru ned grafikken én gang i stedet for å la spillet hakke.
    if (!autoTuned && rawDt > 0) {
      fpsAccum += rawDt;
      fpsSamples += 1;
      if (fpsSamples >= 40) {
        autoTuned = true;
        const avgFps = fpsSamples / fpsAccum;
        if (avgFps < 24) degradeGraphics();
      }
    }

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
    distance += speed * dt;

    if (waveTimer >= WAVE_INTERVAL) {
      if (questionActive) {
        // Hold igjen til skiltene er passert
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

    const next = [];
    for (const obj of worldObjects) {
      if (obj.resolved) continue; // skilt fra en avsluttet oppgaverunde

      // Trafikk: egen fart + filbytte. Resten scroller med veien.
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
        // Lett sving-lean
        obj.mesh.rotation.y = (tx - obj.mesh.position.x) * -0.08;
      } else {
        obj.mesh.position.z += speed * dt;
      }

      if (obj.kind === "coin") {
        obj.mesh.rotation.y += dt * 3.4;
        obj.mesh.position.y = 0.85 + Math.sin(elapsed * 3 + obj.bobPhase) * 0.12;
        // Myntmagnet: mynter i nabofilen dras mot bilen innen rekkevidde
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

      const inRange = Math.abs(obj.mesh.position.z) < COLLIDE_Z;
      if (obj.kind === "sign") {
        if (inRange && obj.lane === laneIndex) {
          resolveQuestion(obj);
          continue;
        }
      } else if (obj.kind === "coin") {
        // Magnetiserte mynter treffes på avstand, ikke fil
        const hit = obj.magnetized
          ? Math.abs(obj.mesh.position.x - car.position.x) < 1.0
          : obj.lane === laneIndex;
        if (inRange && hit) {
          collectCoin(obj);
          continue;
        }
      } else if (inRange && obj.lane === laneIndex) {
        hitObstacle(obj);
        continue;
      }

      if (obj.mesh.position.z > DESPAWN_Z) {
        if (obj.kind === "sign") {
          // Kjørte forbi uten å velge svar = ute (Highway-stil)
          endQuestionRound(obj.roundId);
          scene.remove(obj.mesh);
          endRun("miss");
          continue;
        }
        scene.remove(obj.mesh);
        continue;
      }
      // Trafikk som kjører forbi langt foran (høy rel) — fjern langt bak kamera
      if (obj.isTraffic && obj.mesh.position.z < SPAWN_Z - 20) {
        scene.remove(obj.mesh);
        continue;
      }
      next.push(obj);
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

    // Skjoldringen roterer rolig mens den er aktiv
    if (shieldActive) {
      shieldRing.rotation.y += dt * 0.8;
      shieldDome.rotation.y -= dt * 0.35;
    }
    // Turbo-flammer: pulser litt mens du kjører
    for (let i = 0; i < turboFlames.length; i++) {
      const f = turboFlames[i];
      const pulse = 0.85 + Math.sin(elapsed * 18 + i) * 0.15;
      f.scale.set(pulse, 0.7 + Math.random() * 0.6, pulse);
    }

    // Tilbakestill lakken etter grønn/rød tilbakemelding på svar
    if (flashUntil > 0 && elapsed >= flashUntil) {
      flashUntil = 0;
      bodyMat.emissive.setHex(paintColor);
      bodyMat.emissiveIntensity = 0.04;
    }

    // Skyggekamera og himmel følger bilen
    moon.target.position.set(car.position.x, 0, -12);
    sky.position.x = camera.position.x;

    // Kamera: chase med lerp + fartsfølelse via FOV
    const camTargetX = car.position.x * 0.4;
    camera.position.x += (camTargetX - camera.position.x) * Math.min(1, dt * 3.5);
    camera.position.y = 9.5;
    camera.position.z = 11.5;
    camera.lookAt(car.position.x * 0.25, 0.2, -18);
    const speedT = (speed - baseSpeed) / (maxSpeed - baseSpeed);
    const targetFov = 60 + Math.max(0, speedT) * 7;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);
  }

  // ---------- Offentlig API (uendret) ----------
  function resetState() {
    clearWorldObjects();
    laneIndex = 1; // nest ytterst til venstre — 4 filer
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
    coinsCollected = 0;
    flashUntil = 0;
    bodyMat.emissive.setHex(paintColor);
    bodyMat.emissiveIntensity = 0.04;
    opts.onStatsUpdate({ combo, coinsCollected });
  }

  const api = {
    start() {
      if (disposed) return;
      resetState();
      resize();
      addListeners();
      running = true;
      lastTime = performance.now();
      spawnWave();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      removeListeners();
      clearWorldObjects();
      renderer.render(scene, camera);
    },
    pause() {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    resume() {
      if (disposed || running) return;
      running = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    dispose() {
      api.stop();
      disposed = true;
      resizeObserver.disconnect();
      for (const item of disposables) {
        if (item && typeof item.dispose === "function") item.dispose();
      }
      renderer.dispose();
    },
    setSecondsPerCoin(n) {
      secondsPerCoin = Math.max(1, n | 0);
    },
  };

  resize();
  renderer.render(scene, camera);
  opts.onReady();

  return api;
}
