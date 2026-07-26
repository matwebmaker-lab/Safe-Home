// =====================================================================
// 3D-assets for bilspillet (Safe Home)
// ---------------------------------------------------------------------
// Prosedyrele modeller bygd med three.js-primitiver — samme oppskrift
// som car-runner.js bruker i dag, slik at modellene kan byttes rett inn
// uten noen modell-lastere eller binærfiler (fungerer offline i Tauri).
//
// Konvensjoner (matcher car-runner.js):
//  - Alle fabrikker returnerer en THREE.Group med origo i bakken (y=0)
//    midt under modellen.
//  - Fronten på kjøretøy peker mot -z (kjøreretningen i spillet).
//  - Skala: 1 enhet som i spillet (veibredde 11, filer på x = ±1 og ±3).
//  - Animasjonshåndter ligger i group.userData:
//      wheels  — hjulgrupper (spinn med rotation.x, som spillet gjør)
//      flames  — turboflammer (pulseres med scale, som spillet gjør)
//      ring/dome — skjolddeler
//      setPaint(hex) — bytt lakk på spillerbilen
//      paintMaterial — lakkmaterialet (spillet blinker emissive ved svar)
//  - disposeModel(group) rydder opp geometrier/materialer (unntatt
//    delte materialer) når en modell ikke skal brukes lenger.
// =====================================================================
import * as THREE from "../vendor/three.module.min.js";

// ---------- Delte materialer (lages én gang, deles av alle modeller) ----------
const SHARED_MATS = new Set();
function shared(mat) {
  SHARED_MATS.add(mat);
  return mat;
}

export const MATS = {
  glass: shared(new THREE.MeshPhysicalMaterial({
    color: 0x0a1418, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.2,
  })),
  tire: shared(new THREE.MeshStandardMaterial({ color: 0x0b0d0c, roughness: 0.95 })),
  rim: shared(new THREE.MeshStandardMaterial({ color: 0xd8e8e2, metalness: 0.95, roughness: 0.18 })),
  rimDark: shared(new THREE.MeshStandardMaterial({ color: 0x2a3230, metalness: 0.8, roughness: 0.35 })),
  trim: shared(new THREE.MeshStandardMaterial({ color: 0x141816, metalness: 0.3, roughness: 0.6 })),
  chrome: shared(new THREE.MeshStandardMaterial({ color: 0xc8d4d0, metalness: 0.9, roughness: 0.25 })),
  headlight: shared(new THREE.MeshStandardMaterial({
    color: 0xf4ffff, emissive: 0xd8fbff, emissiveIntensity: 3.2,
  })),
  taillight: shared(new THREE.MeshStandardMaterial({
    color: 0xff5348, emissive: 0xff2a20, emissiveIntensity: 2.6,
  })),
  amberLight: shared(new THREE.MeshStandardMaterial({
    color: 0xffb02e, emissive: 0xff9500, emissiveIntensity: 3,
  })),
};

// ---------- Små hjelpere ----------
function mesh(geo, mat, x = 0, y = 0, z = 0, castShadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  return m;
}

// Myk radial glød (til underglød og bakke-glød) — canvas, ingen filer.
function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.5, "rgba(255,255,255,0.28)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
let glowTex = null;
function getGlowTexture() {
  if (!glowTex) glowTex = makeGlowTexture();
  return glowTex;
}

// Stjerneform (til mynten)
function starShape(points, outer, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

// ---------- Hjul: dekk (torus) + felg med eiker ----------
// Returnerer en gruppe der rotation.x spinner hjulet (som i spillet).
export function createWheel(radius = 0.3, width = 0.24) {
  const wheel = new THREE.Group();

  // Dekk som torus — da står felgen fritt i hullet og synes
  const tube = width / 2;
  const tire = mesh(new THREE.TorusGeometry(radius - tube, tube, 12, 26), MATS.tire);
  tire.rotation.y = Math.PI / 2; // aksel langs x

  const rimRadius = (radius - tube) * 0.92;
  // Bremseskive (mørk) bak eikene
  const disc = mesh(new THREE.CylinderGeometry(rimRadius, rimRadius, width * 0.35, 20), MATS.rimDark);
  disc.rotation.z = Math.PI / 2;
  // Lys felg-kant så hjulet leses på avstand
  const lip = mesh(new THREE.TorusGeometry(rimRadius, radius * 0.045, 8, 22), MATS.rim);
  lip.rotation.y = Math.PI / 2;

  // Fem eiker
  for (let i = 0; i < 5; i++) {
    const spokeGeo = new THREE.BoxGeometry(width * 0.55, rimRadius * 1.0, radius * 0.2);
    spokeGeo.translate(0, rimRadius * 0.48, 0);
    const spoke = mesh(spokeGeo, MATS.rim);
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    wheel.add(spoke);
  }
  const hub = mesh(new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, width * 0.7, 10), MATS.rim);
  hub.rotation.z = Math.PI / 2;

  wheel.add(tire, disc, lip, hub);
  return wheel;
}

// Skjermbue (halv torus) over et hjul
function createFender(radius) {
  const f = mesh(new THREE.TorusGeometry(radius + 0.045, 0.045, 8, 18, Math.PI), MATS.trim);
  f.rotation.y = Math.PI / 2; // buen i y-z-planet, over hjulet
  return f;
}

// =====================================================================
// SPILLERBIL — flere karosseri-stiler
// =====================================================================
// Samme mål og festepunkter som den gamle bilen i car-runner.js:
// lengde ~2.6, bredde ~1.3, front mot -z, hjulene rører bakken på y=0.
//
// Hver stil definerer sideprofil (x = lengderetning, front +x), kupe,
// tak, hjul og eventuelle ekstra detaljer (vinge, scoop ...).
export const BODY_STYLES = {
  sport: {
    nose: 1.3, tail: 1.3, fasciaY: 0.42, tailY: 0.56,
    width: 1.24, cabinWidth: 1.0, bevel: 0.05,
    wheelRadius: 0.3, wheelWidth: 0.24, wheelX: 0.66, wheelZ: 0.8,
    mirrorZ: -0.24, mirrorY: 0.78,
    profile: [
      [-1.28, 0.16], [1.16, 0.16], [1.30, 0.30], [1.26, 0.44],
      [0.72, 0.56], [0.30, 0.64], [-0.80, 0.72], [-1.22, 0.68], [-1.30, 0.50],
    ],
    cabin: [
      [0.32, 0.60], [0.02, 0.94], [-0.52, 1.00], [-0.86, 0.90], [-1.02, 0.64],
    ],
    roof: { w: 0.86, len: 0.5, y: 0.99, z: 0.28 },
  },
  racer: {
    nose: 1.36, tail: 1.34, fasciaY: 0.32, tailY: 0.48,
    width: 1.2, cabinWidth: 0.95, bevel: 0.04,
    wheelRadius: 0.28, wheelWidth: 0.22, wheelX: 0.64, wheelZ: 0.84,
    mirrorZ: -0.2, mirrorY: 0.66,
    profile: [
      [-1.30, 0.12], [1.22, 0.12], [1.36, 0.24], [1.30, 0.36],
      [0.70, 0.46], [0.28, 0.52], [-0.85, 0.60], [-1.26, 0.56], [-1.34, 0.40],
    ],
    cabin: [
      [0.30, 0.50], [0.04, 0.82], [-0.42, 0.86], [-0.80, 0.78], [-0.98, 0.52],
    ],
    roof: { w: 0.8, len: 0.42, y: 0.85, z: 0.26 },
    // Lav, innebygd ducktail-vinge
    extras(car, paintMat, carbonMat) {
      for (const sx of [-0.36, 0.36]) {
        car.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), carbonMat, sx, 0.62, 1.18));
      }
      const wing = mesh(new THREE.BoxGeometry(1.08, 0.04, 0.24), carbonMat, 0, 0.71, 1.2);
      wing.rotation.x = -0.08;
      car.add(wing);
    },
  },
  muskel: {
    nose: 1.24, tail: 1.24, fasciaY: 0.48, tailY: 0.60,
    width: 1.3, cabinWidth: 1.05, bevel: 0.05,
    wheelRadius: 0.32, wheelWidth: 0.26, wheelX: 0.68, wheelZ: 0.78,
    mirrorZ: -0.22, mirrorY: 0.84,
    profile: [
      [-1.22, 0.18], [1.14, 0.18], [1.24, 0.34], [1.18, 0.52],
      [0.62, 0.62], [0.30, 0.68], [-0.90, 0.74], [-1.18, 0.70], [-1.24, 0.52],
    ],
    cabin: [
      [0.34, 0.66], [0.06, 0.98], [-0.50, 1.02], [-0.88, 0.94], [-1.00, 0.68],
    ],
    roof: { w: 0.92, len: 0.55, y: 1.01, z: 0.26 },
    // Hettescoop
    extras(car, paintMat, carbonMat) {
      car.add(mesh(new THREE.BoxGeometry(0.44, 0.12, 0.5), carbonMat, 0, 0.72, -0.45));
      car.add(mesh(new THREE.BoxGeometry(0.36, 0.07, 0.06), MATS.trim, 0, 0.72, -0.71));
    },
  },
  comet: {
    nose: 1.26, tail: 1.26, fasciaY: 0.40, tailY: 0.52,
    width: 1.24, cabinWidth: 1.05, bevel: 0.07,
    wheelRadius: 0.27, wheelWidth: 0.22, wheelX: 0.62, wheelZ: 0.75,
    mirrorZ: -0.35, mirrorY: 0.74,
    profile: [
      [-1.20, 0.14], [1.10, 0.14], [1.26, 0.30], [1.22, 0.50],
      [0.60, 0.60], [0.20, 0.66], [-0.70, 0.70], [-1.10, 0.64], [-1.26, 0.46],
    ],
    // Stort glass-kanope i stedet for kupe + tak
    cabin: [
      [0.55, 0.56], [0.20, 0.92], [-0.30, 0.98], [-0.80, 0.86], [-1.05, 0.60],
    ],
    roof: null,
  },
  mini: {
    nose: 1.0, tail: 1.0, fasciaY: 0.38, tailY: 0.5,
    width: 1.1, cabinWidth: 0.95, bevel: 0.06,
    wheelRadius: 0.26, wheelWidth: 0.2, wheelX: 0.58, wheelZ: 0.62,
    mirrorZ: -0.18, mirrorY: 0.72,
    profile: [
      [-0.95, 0.18], [0.90, 0.18], [1.00, 0.34], [0.92, 0.50],
      [0.35, 0.58], [-0.60, 0.62], [-0.92, 0.56], [-0.98, 0.45],
    ],
    cabin: [
      [0.30, 0.58], [0.05, 0.90], [-0.40, 0.92], [-0.75, 0.60],
    ],
    roof: { w: 0.85, len: 0.5, y: 0.91, z: 0.20 },
  },
  pickup: {
    nose: 1.25, tail: 1.35, fasciaY: 0.48, tailY: 0.58,
    width: 1.3, cabinWidth: 1.05, bevel: 0.05,
    wheelRadius: 0.34, wheelWidth: 0.26, wheelX: 0.66, wheelZ: 0.82,
    mirrorZ: -0.28, mirrorY: 0.86,
    // Høy førerhus-seksjon foran, lav åpen kasse bak
    profile: [
      [-1.30, 0.18], [1.15, 0.18], [1.25, 0.34], [1.18, 0.52],
      [0.55, 0.60], [0.30, 0.66], [-0.30, 0.70], [-0.35, 0.55],
      [-1.25, 0.55], [-1.32, 0.50],
    ],
    cabin: [
      [0.32, 0.64], [0.05, 0.98], [-0.35, 1.00], [-0.32, 0.66],
    ],
    roof: { w: 0.9, len: 0.4, y: 1.0, z: 0.05 },
    // Kassesider, bakluke og bergingsbøyle
    extras(car, paintMat, carbonMat) {
      for (const sx of [-1, 1]) {
        car.add(mesh(new THREE.BoxGeometry(0.06, 0.22, 0.85), paintMat, sx * 0.62, 0.64, 0.85));
      }
      car.add(mesh(new THREE.BoxGeometry(1.2, 0.22, 0.06), paintMat, 0, 0.64, 1.30));
      // Bøyle bak førerhuset
      for (const sx of [-0.45, 0.45]) {
        car.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), carbonMat, sx, 0.75, 0.42));
      }
      const bar = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8), carbonMat, 0, 0.95, 0.42);
      bar.rotation.z = Math.PI / 2;
      car.add(bar);
    },
  },
  buggy: {
    nose: 1.1, tail: 1.1, fasciaY: 0.4, tailY: 0.5,
    width: 1.15, cabinWidth: 0.9, bevel: 0.04,
    wheelRadius: 0.36, wheelWidth: 0.3, wheelX: 0.68, wheelZ: 0.72,
    mirrorZ: -0.15, mirrorY: 0.72,
    profile: [
      [-1.05, 0.20], [1.00, 0.20], [1.10, 0.35], [1.00, 0.50],
      [0.40, 0.55], [-0.60, 0.60], [-1.00, 0.55], [-1.08, 0.45],
    ],
    cabin: [
      [0.20, 0.55], [-0.10, 0.80], [-0.50, 0.80], [-0.70, 0.55],
    ],
    roof: null,
    // Bergingsbur + reservehjul bak
    extras(car, paintMat, carbonMat) {
      for (const sx of [-0.4, 0.4]) {
        const front = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), carbonMat, sx, 0.72, -0.15);
        front.rotation.x = 0.35;
        car.add(front);
        const rear = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), carbonMat, sx, 0.72, 0.55);
        rear.rotation.x = -0.4;
        car.add(rear);
      }
      const cross = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6), carbonMat, 0, 0.88, 0.18);
      cross.rotation.z = Math.PI / 2;
      car.add(cross);
      // Reservehjul liggende bak
      const spare = createWheel(0.28, 0.2);
      spare.rotation.z = Math.PI / 2;
      spare.position.set(0, 0.62, 0.85);
      car.add(spare);
    },
  },
  formel: {
    nose: 1.4, tail: 1.3, fasciaY: 0.26, tailY: 0.38,
    width: 1.0, cabinWidth: 0.7, bevel: 0.04,
    wheelRadius: 0.3, wheelWidth: 0.3, wheelX: 0.7, wheelZ: 0.88,
    mirrorZ: -0.05, mirrorY: 0.5,
    fenders: false, // åpne hjul
    profile: [
      [-1.30, 0.12], [1.30, 0.12], [1.40, 0.20], [1.30, 0.30],
      [0.30, 0.35], [-0.80, 0.40], [-1.25, 0.35],
    ],
    cabin: [
      [0.10, 0.38], [-0.20, 0.60], [-0.50, 0.60], [-0.70, 0.38],
    ],
    roof: null,
    // Front- og bakvinge
    extras(car, paintMat, carbonMat) {
      const frontWing = mesh(new THREE.BoxGeometry(1.3, 0.03, 0.3), carbonMat, 0, 0.14, -1.35);
      frontWing.rotation.x = 0.06;
      car.add(frontWing);
      for (const sx of [-0.5, 0.5]) {
        car.add(mesh(new THREE.BoxGeometry(0.04, 0.3, 0.1), carbonMat, sx, 0.42, 1.15));
      }
      const rearWing = mesh(new THREE.BoxGeometry(1.15, 0.04, 0.3), carbonMat, 0, 0.58, 1.18);
      rearWing.rotation.x = -0.12;
      car.add(rearWing);
      for (const sx of [-0.58, 0.58]) {
        car.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.3), carbonMat, sx, 0.6, 1.18));
      }
      // Halo over føreren
      const halo = mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 14, Math.PI), carbonMat, 0, 0.58, 0.25);
      halo.rotation.y = Math.PI / 2;
      car.add(halo);
    },
  },
};

export function createPlayerCar({ paint = 0x38e6ac, turbo = 0, magnet = 0, skjold = 0, style = "sport" } = {}) {
  const st = BODY_STYLES[style] || BODY_STYLES.sport;
  const car = new THREE.Group();
  car.name = "playerCar";

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paint,
    metalness: 0.65,
    roughness: 0.28,
    clearcoat: 0.8,
    clearcoatRoughness: 0.3,
    emissive: paint,
    emissiveIntensity: 0.04,
  });

  // ---- Karosseri: ekstrudert sideprofil ----
  const profile = new THREE.Shape();
  st.profile.forEach(([x, y], i) => (i === 0 ? profile.moveTo(x, y) : profile.lineTo(x, y)));
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: st.width, bevelEnabled: true,
    bevelThickness: st.bevel, bevelSize: st.bevel, bevelSegments: 3,
  });
  bodyGeo.translate(0, 0, -st.width / 2);
  const body = mesh(bodyGeo, paintMat);
  body.rotation.y = -Math.PI / 2; // profil-front (+x) -> verdens -z
  car.add(body);

  // ---- Kupe (glasshus) ----
  const cabinProfile = new THREE.Shape();
  st.cabin.forEach(([x, y], i) => (i === 0 ? cabinProfile.moveTo(x, y) : cabinProfile.lineTo(x, y)));
  cabinProfile.closePath();
  const cabinGeo = new THREE.ExtrudeGeometry(cabinProfile, {
    depth: st.cabinWidth, bevelEnabled: true,
    bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2,
  });
  cabinGeo.translate(0, 0, -st.cabinWidth / 2);
  const cabin = mesh(cabinGeo, MATS.glass);
  cabin.rotation.y = -Math.PI / 2;
  car.add(cabin);

  // Takpanel i lakk («svevende tak»-look) — unntatt helglass-stiler
  if (st.roof) {
    car.add(mesh(new THREE.BoxGeometry(st.roof.w, 0.05, st.roof.len), paintMat, 0, st.roof.y, st.roof.z));
  }

  // ---- Front: grill, splitter, LED-lyktelinje og hovedlys ----
  car.add(mesh(new THREE.BoxGeometry(0.72, 0.18, 0.06), MATS.trim, 0, st.fasciaY - 0.1, -(st.nose - 0.03)));
  car.add(mesh(new THREE.BoxGeometry(1.16, 0.1, 0.16), MATS.trim, 0, 0.16, -(st.nose - 0.06))); // splitter
  car.add(mesh(new THREE.BoxGeometry(1.02, 0.035, 0.03), MATS.headlight, 0, st.fasciaY + 0.05, -(st.nose - 0.02), false));
  for (const sx of [-0.42, 0.42]) {
    const lamp = mesh(new THREE.BoxGeometry(0.3, 0.09, 0.08), MATS.headlight, sx, st.fasciaY, -(st.nose - 0.06), false);
    lamp.rotation.x = -0.15;
    car.add(lamp);
  }

  // ---- Bak: heldekkende baklys-linje + diffusor ----
  car.add(mesh(new THREE.BoxGeometry(1.06, 0.06, 0.04), MATS.taillight, 0, st.tailY, st.tail - 0.01, false));
  car.add(mesh(new THREE.BoxGeometry(1.2, 0.18, 0.14), MATS.trim, 0, 0.24, st.tail - 0.04));

  // ---- Sideskjørt, speil og skjermbuer ----
  const skirtLen = st.nose + st.tail - 0.9;
  for (const sx of [-1, 1]) {
    car.add(mesh(new THREE.BoxGeometry(0.08, 0.1, skirtLen), MATS.trim, sx * (st.width / 2 + 0.03), 0.16, 0));
    // Sidespeil: stilk + hode
    car.add(mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), paintMat, sx * (st.width / 2 + 0.04), st.mirrorY, st.mirrorZ));
    car.add(mesh(new THREE.BoxGeometry(0.08, 0.09, 0.12), paintMat, sx * (st.width / 2 + 0.08), st.mirrorY + 0.02, st.mirrorZ));
  }

  // ---- Hjul + skjermbuer (åpne hjul på formelbiler) ----
  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const wheel = createWheel(st.wheelRadius, st.wheelWidth);
    wheel.position.set(sx * st.wheelX, st.wheelRadius, sz * st.wheelZ);
    car.add(wheel);
    wheels.push(wheel);
    if (st.fenders !== false) {
      const fender = createFender(st.wheelRadius);
      fender.position.set(sx * st.wheelX, st.wheelRadius + 0.02, sz * st.wheelZ);
      car.add(fender);
    }
  }

  // ---- Neon-underglød i lakkfargen (myk radial tekstur) ----
  const glowMat = new THREE.MeshBasicMaterial({
    map: getGlowTexture(), color: paint, transparent: true,
    opacity: 0.4, depthWrite: false,
  });
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(st.width + 0.8, st.nose + st.tail + 0.6), glowMat);
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.05;
  car.add(underglow);

  // ---- Stil-spesifikke detaljer (vinge, scoop ...) ----
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x161a18, metalness: 0.6, roughness: 0.35 });
  if (st.extras) st.extras(car, paintMat, carbonMat);

  // ---- Animasjonshåndter + lakkbytte (samme mønster som spillet) ----
  car.userData.wheels = wheels;
  car.userData.paintMaterial = paintMat;
  car.userData.style = style;
  car.userData.setPaint = (hex) => {
    paintMat.color.setHex(hex);
    paintMat.emissive.setHex(hex);
    glowMat.color.setHex(hex);
  };

  // ---- Monter synlige oppgraderinger ----
  if (turbo > 0) {
    const kit = createTurboKit(turbo);
    // Juster høyden på vinge/eksos etter karosseriet
    kit.position.y = st.tailY - 0.56;
    car.add(kit);
    car.userData.flames = kit.userData.flames;
  }
  if (magnet > 0) {
    car.add(createMagnetKit(magnet, st.width / 2));
  }
  if (skjold > 0) {
    const shield = createShieldKit();
    car.add(shield);
    car.userData.shieldRing = shield.userData.ring;
    car.userData.shieldDome = shield.userData.dome;
  }

  return car;
}

// =====================================================================
// OPPGRADERINGER (synlige på bilen)
// =====================================================================

// Turbo: vinge + hettescoop + eksos med flammer. Nivå 1–3.
export function createTurboKit(level = 1) {
  const kit = new THREE.Group();
  kit.name = "turboKit";
  const lvl = Math.max(1, Math.min(3, level | 0));

  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x161a18, metalness: 0.6, roughness: 0.35 });

  // Bakvinge på to finner
  for (const sx of [-0.42, 0.42]) {
    kit.add(mesh(new THREE.BoxGeometry(0.06, 0.24, 0.08), carbonMat, sx, 0.92, 1.12));
  }
  const wing = mesh(new THREE.BoxGeometry(1.24, 0.05, 0.32), carbonMat, 0, 1.06, 1.16);
  wing.rotation.x = -0.1;
  kit.add(wing);

  // Eksosrør med flammer (én flamme per nivå per side, som i spillet)
  const pipeGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.34, 10);
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.85 });
  for (const sx of [-0.3, 0.3]) {
    const pipe = mesh(pipeGeo, MATS.chrome, sx, 0.26, 1.3);
    pipe.rotation.x = Math.PI / 2;
    kit.add(pipe);
    for (let i = 0; i < lvl; i++) {
      const flame = mesh(new THREE.ConeGeometry(0.08 + i * 0.02, 0.35 + i * 0.12, 6), flameMat, sx, 0.26, 1.5 + i * 0.12, false);
      flame.rotation.x = -Math.PI / 2;
      kit.add(flame);
      flames.push(flame);
    }
  }

  // Nivå 2+: hettescoop
  if (lvl >= 2) {
    kit.add(mesh(new THREE.BoxGeometry(0.42, 0.1, 0.46), carbonMat, 0, 0.68, -0.5));
    kit.add(mesh(new THREE.BoxGeometry(0.34, 0.06, 0.05), MATS.trim, 0, 0.68, -0.74));
  }

  // Nivå 3: ender plater på vingen + front-canards
  if (lvl >= 3) {
    for (const sx of [-0.63, 0.63]) {
      kit.add(mesh(new THREE.BoxGeometry(0.04, 0.18, 0.36), carbonMat, sx, 1.08, 1.16));
      const canard = mesh(new THREE.BoxGeometry(0.16, 0.03, 0.1), carbonMat, sx * 0.85, 0.3, -1.26);
      canard.rotation.z = sx > 0 ? -0.25 : 0.25;
      kit.add(canard);
    }
  }

  kit.userData.flames = flames;
  return kit;
}

// Magnet: blå magnetskiver på dørene + glødende kjerne. Nivå 2: halo + takspole.
// halfWidth = halvparten av karosseribredden, slik at skivene sitter på karosseriet.
export function createMagnetKit(level = 1, halfWidth = 0.65) {
  const kit = new THREE.Group();
  kit.name = "magnetKit";
  const lvl = Math.max(1, Math.min(2, level | 0));

  const magMat = new THREE.MeshStandardMaterial({
    color: 0x2a6dff, emissive: 0x3d7be2, emissiveIntensity: 1.4 + lvl * 0.6,
    metalness: 0.7, roughness: 0.25,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xe2483d, emissive: 0xff3344, emissiveIntensity: 1.4,
  });

  const mx = halfWidth + 0.05; // skivene sitter utenpå karosseriet
  for (const sx of [-mx, mx]) {
    const disc = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 20), magMat, sx, 0.52, 0.05);
    disc.rotation.z = Math.PI / 2;
    kit.add(disc);
    // Bolt-ring rundt skiven
    const boltRing = mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 16), MATS.chrome, sx * 1.03, 0.52, 0.05, false);
    boltRing.rotation.y = Math.PI / 2;
    kit.add(boltRing);
    kit.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), coreMat, sx * 1.05, 0.52, 0.05, false));
  }

  if (lvl >= 2) {
    // Svevende halo under bilen
    const halo = mesh(
      new THREE.TorusGeometry(0.98, 0.035, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x6efdff, transparent: true, opacity: 0.55 }),
      0, 0.32, 0, false
    );
    halo.rotation.x = Math.PI / 2;
    kit.add(halo);
    // Takspole (tesla-look)
    const coil = mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 18), magMat, 0, 1.1, 0.3);
    coil.rotation.x = Math.PI / 2;
    kit.add(coil);
    kit.add(mesh(new THREE.SphereGeometry(0.05, 8, 8), coreMat, 0, 1.18, 0.3, false));
    kit.userData.halo = halo;
  }
  return kit;
}

// Skjold: cyan energiring + kuppel (samme formspråk som spillet).
export function createShieldKit() {
  const kit = new THREE.Group();
  kit.name = "shieldKit";
  const ring = mesh(
    new THREE.TorusGeometry(1.35, 0.07, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0x6efdff, transparent: true, opacity: 0.85 }),
    0, 0.55, 0, false
  );
  ring.rotation.x = 0.15;
  const dome = mesh(
    new THREE.SphereGeometry(1.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshBasicMaterial({
      color: 0x6efdff, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    0, 0.35, 0, false
  );
  kit.add(ring, dome);
  kit.userData.ring = ring;
  kit.userData.dome = dome;
  return kit;
}

// =====================================================================
// TRAFIKK (motgående/medsammensvendte kjøretøy på veien)
// =====================================================================
// Samme fotavtrykk som dagens trafikk i car-runner.js:
// personbil ~1.1×2.1, varebil ~1.2×2.7, buss ~1.25×3.5, front mot -z.

// Felles detaljer for trafikk-kjøretøy
function addTrafficLights(g, width, y, zFront, zRear) {
  for (const sx of [-width / 2 + 0.14, width / 2 - 0.14]) {
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.08, 0.04), MATS.headlight, sx, y, zFront, false));
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.08, 0.04), MATS.taillight, sx, y, zRear, false));
  }
}

function addTrafficWheels(g, positions, radius = 0.28, width = 0.18) {
  const wheels = [];
  for (const [wx, wz] of positions) {
    const w = createWheel(radius, width);
    w.position.set(wx, radius, wz);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
}

// Personbil: enkel ekstrudert silhuett + glasskupe, som en mini-utgave
// av spillerbilen. Mye penere enn dagens to bokser.
export function createTrafficCar(color = 0x3d7be2) {
  const g = new THREE.Group();
  g.name = "trafficCar";
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.35 });

  const profile = new THREE.Shape();
  profile.moveTo(-1.05, 0.14);
  profile.lineTo(0.98, 0.14);
  profile.lineTo(1.08, 0.3);
  profile.lineTo(0.98, 0.42);
  profile.lineTo(0.4, 0.5);
  profile.lineTo(-0.78, 0.52);
  profile.lineTo(-1.05, 0.44);
  profile.lineTo(-1.05, 0.14);
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 0.95, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2,
  });
  bodyGeo.translate(0, 0, -0.475);
  const body = mesh(bodyGeo, bodyMat);
  body.rotation.y = -Math.PI / 2;
  g.add(body);

  const cabinProfile = new THREE.Shape();
  cabinProfile.moveTo(0.32, 0.48);
  cabinProfile.lineTo(0.02, 0.76);
  cabinProfile.lineTo(-0.42, 0.78);
  cabinProfile.lineTo(-0.78, 0.5);
  cabinProfile.lineTo(0.32, 0.48);
  const cabinGeo = new THREE.ExtrudeGeometry(cabinProfile, {
    depth: 0.82, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  cabinGeo.translate(0, 0, -0.41);
  const cabin = mesh(cabinGeo, MATS.glass);
  cabin.rotation.y = -Math.PI / 2;
  g.add(cabin);

  g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.08), MATS.trim, 0, 0.2, -1.06)); // frontfanger
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.08), MATS.trim, 0, 0.2, 1.03));  // bakfanger
  addTrafficLights(g, 0.95, 0.38, -1.08, 1.06);
  addTrafficWheels(g, [[-0.53, 0.62], [0.53, 0.62], [-0.53, -0.62], [0.53, -0.62]], 0.26, 0.18);
  return g;
}

// Varebil: høy boks med skrå frontrute og vindusbånd.
export function createTrafficVan(color = 0xf2f4f3) {
  const g = new THREE.Group();
  g.name = "trafficVan";
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 });

  g.add(mesh(new THREE.BoxGeometry(1.15, 0.95, 2.7), bodyMat, 0, 0.66, 0));
  // Skrå frontrute
  const windshield = mesh(new THREE.BoxGeometry(1.02, 0.5, 0.06), MATS.glass, 0, 0.82, -1.32, false);
  windshield.rotation.x = -0.42;
  g.add(windshield);
  // Sidevinduer foran
  for (const sx of [-0.58, 0.58]) {
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.32, 0.6), MATS.glass, sx, 0.86, -0.85, false));
  }
  g.add(mesh(new THREE.BoxGeometry(1.1, 0.14, 0.1), MATS.trim, 0, 0.22, -1.36)); // frontfanger
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.04), MATS.trim, 0, 0.48, -1.36)); // grill
  addTrafficLights(g, 1.1, 0.55, -1.37, 1.36);
  addTrafficWheels(g, [[-0.58, 0.85], [0.58, 0.85], [-0.58, -0.85], [0.58, -0.85]], 0.3, 0.2);
  return g;
}

// Buss: lang boks med vindusbånd, destinasjonsskilt og fire hjul.
export function createTrafficBus(color = 0xffc94a) {
  const g = new THREE.Group();
  g.name = "trafficBus";
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 });

  g.add(mesh(new THREE.BoxGeometry(1.25, 1.15, 3.5), bodyMat, 0, 0.86, 0));
  // Vindusbånd langs begge sider
  for (const sx of [-0.63, 0.63]) {
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.42, 2.9), MATS.glass, sx, 1.12, 0.1, false));
  }
  // Frontrute + destinasjonsskilt
  g.add(mesh(new THREE.BoxGeometry(1.05, 0.5, 0.04), MATS.glass, 0, 1.05, -1.76, false));
  g.add(mesh(new THREE.BoxGeometry(0.6, 0.14, 0.03), MATS.amberLight, 0, 1.44, -1.76, false));
  // Dørmarkering
  g.add(mesh(new THREE.BoxGeometry(0.02, 0.9, 0.5), MATS.trim, 0.63, 0.75, -1.3, false));
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.14, 0.08), MATS.trim, 0, 0.28, -1.76)); // fanger
  addTrafficLights(g, 1.2, 0.5, -1.78, 1.76);
  addTrafficWheels(g, [[-0.6, 1.15], [0.6, 1.15], [-0.6, -1.15], [0.6, -1.15]], 0.32, 0.22);
  return g;
}

// Lastebil: førerhus + hvit container, seks hjul.
export function createTrafficTruck(color = 0x3d7be2) {
  const g = new THREE.Group();
  g.name = "trafficTruck";
  const cabMat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xe8ecea, metalness: 0.2, roughness: 0.6 });

  // Container
  g.add(mesh(new THREE.BoxGeometry(1.25, 1.35, 2.6), boxMat, 0, 1.05, 0.75));
  // Førerhus (cab-over)
  g.add(mesh(new THREE.BoxGeometry(1.2, 1.05, 1.05), cabMat, 0, 0.9, -1.25));
  g.add(mesh(new THREE.BoxGeometry(1.05, 0.45, 0.05), MATS.glass, 0, 1.1, -1.78, false)); // frontrute
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.3, 0.06), MATS.chrome, 0, 0.55, -1.79));         // kromgrill
  g.add(mesh(new THREE.BoxGeometry(1.15, 0.12, 0.08), MATS.trim, 0, 0.24, -1.8));          // fanger
  // Chassis-hint under containeren
  g.add(mesh(new THREE.BoxGeometry(1.0, 0.18, 2.4), MATS.trim, 0, 0.32, 0.75));
  addTrafficLights(g, 1.15, 0.42, -1.82, 2.06);
  addTrafficWheels(g, [
    [-0.58, -1.35], [0.58, -1.35],
    [-0.58, 1.25], [0.58, 1.25],
    [-0.58, 1.75], [0.58, 1.75],
  ], 0.32, 0.22);
  return g;
}

// =====================================================================
// OBJEKTER PÅ VEIEN: mynt, sperring, svarskilt
// =====================================================================

// Mynt: gullmynt med preget stjerne på begge sider + kant-ring.
// Samme mål og orientering som dagens mynt (radius 0.44, står på høykant).
export function createCoin() {
  const g = new THREE.Group();
  g.name = "coin";
  const goldMat = new THREE.MeshPhysicalMaterial({
    color: 0xffc94a, metalness: 0.95, roughness: 0.22,
    emissive: 0x9a6a10, emissiveIntensity: 0.5,
  });
  const embossMat = new THREE.MeshStandardMaterial({
    color: 0xffe08a, metalness: 0.9, roughness: 0.15,
    emissive: 0xffc94a, emissiveIntensity: 0.7,
  });

  const disc = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.1, 32), goldMat);
  disc.rotation.x = Math.PI / 2; // stå på høykant, flate mot spilleren
  g.add(disc);
  g.add(mesh(new THREE.TorusGeometry(0.44, 0.05, 8, 28), goldMat));

  const starGeo = new THREE.ShapeGeometry(starShape(5, 0.27, 0.12));
  for (const sz of [-0.051, 0.051]) {
    const star = mesh(starGeo, embossMat, 0, 0, sz, false);
    if (sz < 0) star.rotation.y = Math.PI;
    g.add(star);
  }
  return g;
}

// Stripete sperring (rød/hvit) med A-bein og to varsellys.
export function createBarrier() {
  const g = new THREE.Group();
  g.name = "barrier";

  // Striper via canvas (samme stil som spillet)
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
  const stripeTex = new THREE.CanvasTexture(c);
  stripeTex.wrapS = THREE.RepeatWrapping;
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 });
  const plainMat = new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.6 });

  const board = mesh(new THREE.BoxGeometry(1.5, 0.4, 0.16), [
    plainMat, plainMat, plainMat, plainMat, stripeMat, stripeMat,
  ], 0, 0.68, 0);
  g.add(board);
  // Refleks-list på toppen
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.05, 0.17), MATS.amberLight, 0, 0.9, 0, false));

  // A-bein (to kryssede bord per side)
  const legMat = new THREE.MeshStandardMaterial({ color: 0x494f4c, metalness: 0.5, roughness: 0.5 });
  for (const lx of [-0.6, 0.6]) {
    for (const tilt of [-0.3, 0.3]) {
      const leg = mesh(new THREE.BoxGeometry(0.08, 0.62, 0.3), legMat, lx, 0.3, 0);
      leg.rotation.x = tilt;
      g.add(leg);
    }
  }
  // Varsellys
  for (const lx of [-0.45, 0.45]) {
    g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), MATS.amberLight, lx, 0.98, 0, false));
  }
  return g;
}

// Svarskilt: svevende neon-ring med tall inni (Highway Times Tables-stil,
// men som hologram i stedet for flat hvit sirkel).
// userData.setValue(v) bytter tallet uten å bygge skiltet på nytt.
export function createAnswerSign(value = 42) {
  const g = new THREE.Group();
  g.name = "answerSign";

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x38e6ac, emissive: 0x38e6ac, emissiveIntensity: 1.6,
    metalness: 0.4, roughness: 0.3,
  });
  const ring = mesh(new THREE.TorusGeometry(0.95, 0.06, 12, 44), ringMat, 0, 1.15, 0, false);
  ring.rotation.x = -0.35;
  g.add(ring);

  // Tall-tekstur: mørk glass-skive, mint ring, stort hvitt tall
  function makeFace(v) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 256, 256);
    ctx.beginPath();
    ctx.arc(128, 128, 122, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(4,14,11,0.94)";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(56,230,172,0.9)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(128, 128, 104, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(56,230,172,0.4)";
    ctx.stroke();
    ctx.fillStyle = "#f2fffb";
    const text = String(v);
    ctx.font = text.length >= 3
      ? "bold 78px Arial Black, Impact, sans-serif"
      : "bold 104px Arial Black, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 136);
    const tex = new THREE.CanvasTexture(c);
    tex.premultiplyAlpha = false;
    return tex;
  }

  const faceMat = new THREE.MeshBasicMaterial({
    map: makeFace(value), transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.88, 36), faceMat);
  face.rotation.x = -0.35;
  face.position.y = 1.15;
  face.name = "signFace";
  g.add(face);

  // Myk glød på asfalten under
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 20),
    new THREE.MeshBasicMaterial({
      map: getGlowTexture(), color: 0x38e6ac, transparent: true,
      opacity: 0.35, depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  g.add(glow);

  g.userData.setValue = (v) => {
    const old = faceMat.map;
    faceMat.map = makeFace(v);
    faceMat.needsUpdate = true;
    if (old) old.dispose();
  };
  return g;
}

// Sjakkbrett-mållinje på tvers av veien (Highway-stil).
export function createFinishLine(roadWidth = 11) {
  const g = new THREE.Group();
  g.name = "finishLine";

  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d");
  const cells = 16;
  const cw = c.width / cells;
  const ch = c.height / 2;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f4f7f5" : "#121816";
      ctx.fillRect(x * cw, y * ch, cw + 1, ch + 1);
    }
  }
  // Farget kant (mint) så linjen er lett å se
  ctx.fillStyle = "rgba(56,230,172,0.95)";
  ctx.fillRect(0, 0, c.width, 5);
  ctx.fillRect(0, c.height - 5, c.width, 5);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.55,
    metalness: 0.05,
    emissive: 0x1a3a30,
    emissiveIntensity: 0.35,
  });
  const strip = mesh(new THREE.BoxGeometry(roadWidth * 0.96, 0.06, 1.1), mat, 0, 0.04, 0, false);
  g.add(strip);

  // Side-stolper
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x38e6ac, emissive: 0x38e6ac, emissiveIntensity: 0.9, roughness: 0.4,
  });
  for (const x of [-roadWidth * 0.48, roadWidth * 0.48]) {
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.4, 8), postMat, x, 0.7, 0, false));
  }
  return g;
}

// Svevende oppgaveplate (f.eks. "10 × 6") over veien.
export function createQuestionPlate(text = "3 × 5") {
  const g = new THREE.Group();
  g.name = "questionPlate";

  function makeTex(t) {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 200;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 640, 200);
    // Avrundet lilla-outline boble (Highway-referanse)
    const r = 34;
    ctx.beginPath();
    ctx.moveTo(r, 14);
    ctx.lineTo(640 - r, 14);
    ctx.quadraticCurveTo(626, 14, 626, 14 + r);
    ctx.lineTo(626, 186 - r);
    ctx.quadraticCurveTo(626, 186, 640 - r, 186);
    ctx.lineTo(r, 186);
    ctx.quadraticCurveTo(14, 186, 14, 186 - r);
    ctx.lineTo(14, 14 + r);
    ctx.quadraticCurveTo(14, 14, r, 14);
    ctx.closePath();
    ctx.fillStyle = "rgba(12, 8, 28, 0.88)";
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(170, 120, 255, 0.95)";
    ctx.stroke();
    ctx.fillStyle = "#f4f0ff";
    ctx.font = "bold 96px Arial Black, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(t), 320, 108);
    const tex = new THREE.CanvasTexture(c);
    tex.premultiplyAlpha = false;
    return tex;
  }

  const mat = new THREE.MeshBasicMaterial({
    map: makeTex(text), transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.7), mat);
  face.position.y = 3.4;
  face.rotation.x = -0.2;
  face.name = "questionFace";
  g.add(face);

  g.userData.setText = (t) => {
    const old = mat.map;
    mat.map = makeTex(t);
    mat.needsUpdate = true;
    if (old) old.dispose();
  };
  return g;
}

// =====================================================================
// LANDSKAP: trær, kaktus, palme, gatelys
// =====================================================================
// Farger kan overstyres per kart-tema (matcher theme-feltene i shop-data.js).

// Tre med tre lag — "snøtre" er samme form med snøfarge på de øvre lagene.
export function createTree({ trunkColor = 0x2b241c, foliageColor = 0x0d3325, snow = false } = {}) {
  const g = new THREE.Group();
  g.name = snow ? "snowTree" : "tree";
  const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.95 });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef4f8, roughness: 0.9 });

  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.15, 1.0, 7), trunkMat, 0, 0.5, 0));
  const layers = [
    [0.95, 1.1, 1.25],
    [0.72, 0.95, 1.85],
    [0.48, 0.8, 2.4],
  ];
  layers.forEach(([r, h, y], i) => {
    const mat = snow && i > 0 ? snowMat : leafMat;
    g.add(mesh(new THREE.ConeGeometry(r, h, 8), mat, 0, y, 0));
  });
  return g;
}

// Kaktus med to armer og blomst på toppen.
export function createCactus({ foliageColor = 0x3f7038 } = {}) {
  const g = new THREE.Group();
  g.name = "cactus";
  const mat = new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.9 });

  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.9, 10), mat, 0, 0.95, 0));
  g.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), mat, 0, 1.9, 0));
  // Armer: horisontal + vertikal del med kule på toppen
  for (const side of [-1, 1]) {
    const y = side < 0 ? 1.15 : 0.85;
    const armHor = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 8), mat, side * 0.32, y, 0);
    armHor.rotation.z = Math.PI / 2;
    g.add(armHor);
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.55, 8), mat, side * 0.5, y + 0.28, 0));
    g.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), mat, side * 0.5, y + 0.55, 0));
  }
  // Blomst
  g.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({
    color: 0xff6a9a, emissive: 0xd84878, emissiveIntensity: 0.4, roughness: 0.6,
  }), 0, 2.05, 0, false));
  return g;
}

// Palme med bøyd stamme (stablede ledd) og seks nedfallende blader.
export function createPalm({ trunkColor = 0x3c2a1c, foliageColor = 0x14352a } = {}) {
  const g = new THREE.Group();
  g.name = "palm";
  const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.95 });

  // Stamme i fire ledd med svak bøy
  let x = 0;
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const seg = mesh(new THREE.CylinderGeometry(0.07 - i * 0.008, 0.09 - i * 0.008, 0.7, 7), trunkMat, x, y + 0.35, 0);
    seg.rotation.z = -0.08 * (i + 1);
    g.add(seg);
    x += Math.sin(0.08 * (i + 1)) * 0.6;
    y += Math.cos(0.08 * (i + 1)) * 0.66;
  }
  // Blader: flate, tippende kuler rundt toppen
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = mesh(new THREE.SphereGeometry(0.7, 8, 5), leafMat,
      x + Math.cos(a) * 0.55, y + 0.15, Math.sin(a) * 0.55);
    leaf.scale.set(1.5, 0.22, 0.5);
    leaf.rotation.y = -a;
    leaf.rotation.z = -0.25;
    g.add(leaf);
  }
  // Kokosnøtter
  const nutMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 });
  g.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), nutMat, x + 0.12, y - 0.05, 0.08, false));
  g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), nutMat, x - 0.1, y - 0.02, -0.06, false));
  return g;
}

// Gatelys: stolpe, bøyd arm, lampehus med glødende linse, lyskjegle
// og et EKTE spotlight som lyser opp bakken.
// NB: spotlights koster ytelse — i spillet bør bare noen få av gatelysene
// ha lyset slått på (se userData.light, kan fjernes/skjules per instans).
export function createStreetLight({ lampColor = 0xfff2cf, lampEmissive = 0xffe9b0, withLight = true } = {}) {
  const g = new THREE.Group();
  g.name = "streetLight";
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4440, metalness: 0.7, roughness: 0.4 });
  const lensMat = new THREE.MeshStandardMaterial({
    color: lampColor, emissive: lampEmissive, emissiveIntensity: 2.4,
  });

  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.8, 8), poleMat, 0, 1.9, 0));
  // Arm i to ledd (bøyd utover veien, mot -z her)
  const arm1 = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.7), poleMat, 0, 3.72, -0.3);
  arm1.rotation.x = 0.25;
  const arm2 = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.55), poleMat, 0, 3.82, -0.78);
  g.add(arm1, arm2);
  // Lampehus + linse
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.09, 0.42), poleMat, 0, 3.8, -1.0));
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.03, 0.34), lensMat, 0, 3.75, -1.0, false));
  // Synlig lyskjegle — helt ned til bakken
  const cone = mesh(
    new THREE.ConeGeometry(1.0, 3.7, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: lampEmissive, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    0, 1.85, -1.0, false
  );
  g.add(cone);

  // Ekte spotlight som kaster lys på bakken under lampen
  if (withLight) {
    const spot = new THREE.SpotLight(lampEmissive, 30, 11, 0.55, 0.6, 1.4);
    spot.position.set(0, 3.75, -1.0);
    spot.target.position.set(0, 0, -1.0);
    g.add(spot, spot.target);
    g.userData.light = spot;
  }
  return g;
}

// =====================================================================
// Opprydding: kall når en modell fjernes fra scenen for godt.
// Delte materialer (MATS) og glød-teksturen beholdes.
// =====================================================================
export function disposeModel(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (SHARED_MATS.has(m)) continue;
      if (m.map && m.map !== glowTex) m.map.dispose();
      m.dispose();
    }
  });
}
