// =====================================================================
// 3D-garasje-scene — delt mellom forhåndsvisning og selve appen.
// Verksted i samme stil som mockup-en: blankt speilende gulv (Reflector),
// bloom på neon og lysrør (UnrealBloomPass), PMREM-miljø for lakken,
// genererte teksturer (betong, kledning, port, korktavle) og støv i luften.
//
// Bruk:
//   const gs = createGarageScene(canvas);
//   gs.setCar({ paint, style, upgrades });   // bygg bilen på nytt
//   gs.setActive(true/false);                // start/stopp render-løkken
//   gs.dispose();
// =====================================================================
import * as THREE from "../vendor/three.module.min.js";
import { EffectComposer } from "../vendor/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/postprocessing/OutputPass.js";
import { Reflector } from "../vendor/objects/Reflector.js";
import { RoomEnvironment } from "../vendor/environments/RoomEnvironment.js";
import { createPlayerCar, disposeModel } from "../3dassets/models.js";

// =====================================================================
// Genererte teksturer (canvas — ingen nedlastede filer)
// =====================================================================
function canvasTexture(size, draw, repeat = [1, 1]) {
  const c = document.createElement("canvas");
  c.width = size[0];
  c.height = size[1];
  draw(c.getContext("2d"), size[0], size[1]);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  return tex;
}

// Betonggulv: kornete grunn, sprekker og matte flekker
function makeConcreteTexture() {
  return canvasTexture([512, 512], (ctx, w, h) => {
    ctx.fillStyle = "#181e1b";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 16000; i++) {
      const s = 14 + Math.random() * 30;
      ctx.fillStyle = `rgb(${s},${s + 4},${s + 2})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.3, 1.3);
    }
    // store, lyse slitasjeflekker
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = "rgba(70,80,74,0.05)";
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 0, Math.PI * 2);
      ctx.fill();
    }
    // sprekker
    ctx.strokeStyle = "rgba(8,10,9,0.5)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (Math.random() - 0.5) * 90;
        y += (Math.random() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // svake ruter (støpeskjøt)
    ctx.strokeStyle = "rgba(10,12,11,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);
  }, [4, 4]);
}

// Veggkledning: mørke paneler med skjøter og falmet maling
function makeWallTexture() {
  return canvasTexture([512, 256], (ctx, w, h) => {
    ctx.fillStyle = "#1a211e";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const s = 16 + Math.random() * 18;
      ctx.fillStyle = `rgba(${s},${s + 5},${s + 2},0.5)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    // vertikale panelskjøter
    for (let x = 0; x <= w; x += 64) {
      ctx.fillStyle = "rgba(8,11,10,0.8)";
      ctx.fillRect(x - 1, 0, 2, h);
      ctx.fillStyle = "rgba(60,72,66,0.25)";
      ctx.fillRect(x + 1, 0, 1, h);
    }
    // falmede flekker
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = "rgba(46,64,56,0.06)";
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 15 + Math.random() * 45, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [6, 2]);
}

// Garasjeport: horisontale lameller
function makeDoorTexture() {
  return canvasTexture([256, 256], (ctx, w, h) => {
    ctx.fillStyle = "#1c2422";
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      const g = ctx.createLinearGradient(0, y, 0, y + 32);
      g.addColorStop(0, "#232c29");
      g.addColorStop(0.5, "#1a2120");
      g.addColorStop(1, "#121817");
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, 32);
      ctx.fillStyle = "rgba(6,8,8,0.9)";
      ctx.fillRect(0, y, w, 2);
    }
  }, [3, 3]);
}

// Korktavle (pegboard): hullrutenett
function makePegboardTexture() {
  return canvasTexture([256, 256], (ctx, w, h) => {
    ctx.fillStyle = "#2c251a";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) {
      const s = 30 + Math.random() * 22;
      ctx.fillStyle = `rgba(${s},${s - 6},${s - 16},0.4)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
    }
    ctx.fillStyle = "rgba(10,8,5,0.85)";
    for (let y = 12; y < h; y += 24) {
      for (let x = 12; x < w; x += 24) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [3, 2]);
}

// Myk radial glød (lysreflekser i gulvet)
function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.5, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Neonskilt-tekstur
function neonSignTexture(text, color) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a0f0d";
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = "bold 72px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 68);
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#eafff6";
  ctx.fillText(text, 256, 68);
  return new THREE.CanvasTexture(c);
}

// Plakat-tekstur (SPEED/GARAGE/RACING)
function posterTexture(word) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#101715";
  ctx.fillRect(0, 0, 256, 320);
  ctx.save();
  ctx.translate(128, 160);
  ctx.rotate(-0.28);
  ctx.font = "bold 44px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#2a5a44";
  ctx.fillText(word, 0, -20);
  ctx.fillText(word, 0, 60);
  ctx.restore();
  return new THREE.CanvasTexture(c);
}

// =====================================================================
// Selve garasje-scenen
// =====================================================================
export function createGarageScene(canvas, { lowGraphics = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // myke skyggekanter
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a09);
  scene.fog = new THREE.Fog(0x060a09, 15, 32);

  // PMREM-miljø: gir klarlakken ekte refleksjoner (dempet — ellers
  // blåses hele scenen ut sammen med det øvrige lyset)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.15;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const orbit = { theta: Math.PI / 2 - 0.35, phi: 1.30, radius: 6.0, targetY: 0.85 };

  // ---------- Lys ----------
  const hemi = new THREE.HemisphereLight(0x3a5a50, 0x0a0d0b, 0.85);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x5a6e66, 0.6));
  for (const fx of [-3, 3]) {
    const fill = new THREE.PointLight(0xa8ccc0, 10, 11, 1.6);
    fill.position.set(fx, 3.9, -3);
    scene.add(fill);
  }

  // ---------- Gulv: ekte speiling + betong-overlay ----------
  const glowTex = makeGlowTexture();
  const reflector = new Reflector(new THREE.CircleGeometry(16, 48), {
    textureWidth: lowGraphics ? 512 : 1024,
    textureHeight: lowGraphics ? 512 : 1024,
    color: 0x2e3632,
    clipBias: 0.003,
  });
  reflector.rotation.x = -Math.PI / 2;
  scene.add(reflector);
  // Betong-overlay dempker og gjør speilingen «ru», som vått betong
  const concreteTex = makeConcreteTexture();
  const floorOverlay = new THREE.Mesh(
    new THREE.CircleGeometry(16, 48),
    new THREE.MeshStandardMaterial({
      map: concreteTex, transparent: true, opacity: 0.78,
      roughness: 0.35, metalness: 0.35, depthWrite: false,
    })
  );
  floorOverlay.rotation.x = -Math.PI / 2;
  floorOverlay.position.y = 0.005;
  floorOverlay.receiveShadow = true;
  scene.add(floorOverlay);

  function floorStreak(w, l, x, z, opacity) {
    const s = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshBasicMaterial({ map: glowTex, color: 0xd8fff0, transparent: true, opacity, depthWrite: false })
    );
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.015, z);
    scene.add(s);
  }

  // ---------- Podium ----------
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(2.15, 2.25, 0.09, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a2220, roughness: 0.5, metalness: 0.3 })
  );
  podium.position.y = 0.045;
  podium.receiveShadow = true;
  scene.add(podium);
  const podiumRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.15, 0.02, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x3ddc97, emissive: 0x3ddc97, emissiveIntensity: 0.6 })
  );
  podiumRing.rotation.x = Math.PI / 2;
  podiumRing.position.y = 0.09;
  scene.add(podiumRing);

  // ---------- Vegger, tak, port ----------
  const wallTex = makeWallTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, 8), wallMat);
  wall.position.set(0, 4, -7);
  wall.receiveShadow = true;
  scene.add(wall);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), wallMat);
    side.rotation.y = sx * Math.PI / 2;
    side.position.set(sx * -9, 4, 1);
    scene.add(side);
  }
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x101513, roughness: 0.9 });
  for (const bz of [-5.5, -2.5, 0.5]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(18, 0.16, 0.28), beamMat);
    beam.position.set(0, 4.6, bz);
    scene.add(beam);
  }
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 3.2),
    new THREE.MeshStandardMaterial({ map: makeDoorTexture(), roughness: 0.7, metalness: 0.4 })
  );
  door.position.set(0.7, 1.6, -6.88);
  scene.add(door);

  // ---------- Skilt og plakater ----------
  function placeSign(text, color, w, h, x, y, z, lightIntensity) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: neonSignTexture(text, color), transparent: true })
    );
    sign.position.set(x, y, z);
    scene.add(sign);
    const light = new THREE.PointLight(new THREE.Color(color), lightIntensity, 10, 1.6);
    light.position.set(x, y - 0.2, z + 0.9);
    scene.add(light);
  }
  placeSign("UPGRADE", "#4affc0", 3.6, 0.9, -5.5, 3.0, -6.86, 12);
  placeSign("DRIVE →", "#6efdff", 2.4, 0.8, 4.0, 2.5, -6.86, 8);

  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.4),
    new THREE.MeshBasicMaterial({ map: posterTexture("SPEED") })
  );
  poster.position.set(-3.2, 2.3, -6.87);
  scene.add(poster);
  for (const [sx, word] of [[-1, "GARAGE"], [1, "RACING"]]) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.6),
      new THREE.MeshBasicMaterial({ map: posterTexture(word) })
    );
    p.rotation.y = sx * -Math.PI / 2;
    p.position.set(sx * -8.9, 2.4, -1.5);
    scene.add(p);
  }

  // ---------- Arbeidsbenk venstre ----------
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x2a2f2c, roughness: 0.8, metalness: 0.3 });
  const pegboard = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 1.5),
    new THREE.MeshStandardMaterial({ map: makePegboardTexture(), roughness: 0.95 })
  );
  pegboard.position.set(-5.6, 1.95, -6.88);
  scene.add(pegboard);
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.8), benchMat);
  benchTop.position.set(-5.6, 0.88, -6.5);
  benchTop.castShadow = true;
  scene.add(benchTop);
  for (const lx of [-7.0, -4.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 0.7), benchMat);
    leg.position.set(lx, 0.44, -6.5);
    scene.add(leg);
  }
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.06, 0.5), benchMat);
  shelf.position.set(-5.6, 1.55, -6.62);
  scene.add(shelf);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffe9b0, emissiveIntensity: 3.5 })
  );
  strip.position.set(-5.6, 1.5, -6.6);
  scene.add(strip);
  const benchLight = new THREE.PointLight(0xffe0b0, 14, 8, 1.6);
  benchLight.position.set(-5.6, 1.7, -5.9);
  scene.add(benchLight);

  // ---------- Hyller høyre ----------
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x232a27, metalness: 0.6, roughness: 0.5 });
  for (const px of [4.8, 6.8]) {
    for (const pz of [-5.9, -5.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, 0.06), rackMat);
      post.position.set(px, 1.2, pz);
      scene.add(post);
    }
  }
  for (let i = 0; i < 3; i++) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.7), rackMat);
    sh.position.set(5.8, 0.5 + i * 0.75, -5.6);
    sh.castShadow = true;
    scene.add(sh);
  }
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x4a3a24, roughness: 0.9 });
  const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), crateMat);
  crate1.position.set(5.3, 1.06, -5.6);
  crate1.castShadow = true;
  const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.45), crateMat);
  crate2.position.set(6.2, 0.78, -5.6);
  crate2.castShadow = true;
  scene.add(crate1, crate2);

  // ---------- Dekkstabel + ekstra dekor ----------
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0d0c, roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 10, 20), tireMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(4.4, 0.15 + i * 0.27, -3.6);
    t.castShadow = true;
    scene.add(t);
  }
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 10, 20), tireMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(-7.6, 0.15 + i * 0.27, 1.8);
    t.castShadow = true;
    scene.add(t);
  }
  const crateSide = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), crateMat);
  crateSide.position.set(-6.2, 0.4, 2.4);
  crateSide.rotation.y = 0.5;
  crateSide.castShadow = true;
  scene.add(crateSide);

  // ---------- Lysrør-armaturer ----------
  function tubeLight(x, z) {
    const g = new THREE.Group();
    for (const cx of [-0.6, 0.6]) {
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6),
        new THREE.MeshStandardMaterial({ color: 0x222826, roughness: 0.8 })
      );
      cord.position.set(cx, 4.05, 0);
      g.add(cord);
    }
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.08, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x232a27, metalness: 0.7, roughness: 0.4 })
    );
    housing.position.y = 3.4;
    const tube = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.05, 0.13),
      new THREE.MeshBasicMaterial({ color: 0xf2fff8 })
    );
    tube.position.y = 3.35;
    const spot = new THREE.SpotLight(0xe8fff4, 26, 13, 0.78, 0.45, 1.3);
    spot.position.set(0, 3.3, 0);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.002;
    g.add(housing, tube, spot, spot.target);
    g.position.set(x, 0, z);
    scene.add(g);
    floorStreak(1.6, 4.6, x, z + 2.2, 0.18);
  }
  tubeLight(-1.1, -2.6);
  tubeLight(1.4, -2.2);
  tubeLight(-0.9, 2.4);
  tubeLight(1.2, 2.8);
  const frontFill = new THREE.PointLight(0xa8ccc0, 2.5, 11, 1.6);
  frontFill.position.set(0, 4.2, 4.0);
  scene.add(frontFill);
  floorStreak(1.4, 3.2, -5.6, -4.6, 0.12);

  // ---------- Trafikkone ----------
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.55, 12),
    new THREE.MeshStandardMaterial({ color: 0xd86820, roughness: 0.7 })
  );
  cone.position.set(3.4, 0.28, -1.4);
  cone.castShadow = true;
  scene.add(cone);
  const coneStripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.135, 0.035, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6 })
  );
  coneStripe.rotation.x = Math.PI / 2;
  coneStripe.position.set(3.4, 0.3, -1.4);
  scene.add(coneStripe);

  // ---------- Støv i luften (driver sakte i lyskjeglene) ----------
  const dustCount = lowGraphics ? 0 : 220;
  let dust = null;
  if (dustCount > 0) {
    const pos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = Math.random() * 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xbfe8d8, size: 0.02, sizeAttenuation: true,
      transparent: true, opacity: 0.45,
    }));
    scene.add(dust);
  }

  // ---------- Bil på podiet ----------
  let carGroup = null;
  const turntable = new THREE.Group();
  scene.add(turntable);

  // ---------- Bloom (post-processing) ----------
  let composer = null;
  if (!lowGraphics) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.35, 0.4, 1.15);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ---------- Orbit ----------
  let dragging = false;
  let lastX = 0;
  let idleTimer = null;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = -1; }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });
  const endDrag = () => {
    dragging = false;
    idleTimer = setTimeout(() => { idleTimer = null; }, 2200);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  function applyCamera() {
    const sp = Math.sin(orbit.phi);
    camera.position.set(
      orbit.radius * sp * Math.cos(orbit.theta),
      orbit.radius * Math.cos(orbit.phi),
      orbit.radius * sp * Math.sin(orbit.theta)
    );
    camera.lookAt(0, orbit.targetY, 0);
  }

  // ---------- Størrelse ----------
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  // ---------- Render-løkke ----------
  let active = false;
  let rafId = null;
  let last = 0;

  function frame(now) {
    if (!active) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (!dragging && idleTimer === null) orbit.theta += dt * 0.35;
    if (dust) dust.rotation.y += dt * 0.02;
    if (carGroup) {
      for (const w of carGroup.userData.wheels || []) w.rotation.x += dt * 2;
      const t = now / 1000;
      (carGroup.userData.flames || []).forEach((f, i) => {
        const pulse = 0.85 + Math.sin(t * 18 + i) * 0.15;
        f.scale.set(pulse, 0.7 + Math.random() * 0.6, pulse);
      });
      if (carGroup.userData.shieldRing) {
        carGroup.userData.shieldRing.rotation.y += dt * 0.8;
        carGroup.userData.shieldDome.rotation.y -= dt * 0.35;
      }
    }
    applyCamera();
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  resize();
  applyCamera();
  if (composer) composer.render();
  else renderer.render(scene, camera);

  return {
    // Bygg/bytt bilen på podiet
    setCar({ paint, style, upgrades = {} }) {
      if (carGroup) {
        turntable.remove(carGroup);
        disposeModel(carGroup);
      }
      carGroup = createPlayerCar({
        paint,
        style,
        turbo: upgrades.turbo || 0,
        magnet: upgrades.magnet || 0,
        skjold: upgrades.skjold || 0,
      });
      carGroup.position.y = 0.09;
      turntable.add(carGroup);
    },
    // Ton garasjelyset svakt mot valgt kart
    setMapTint(theme) {
      if (theme?.hemiSky) hemi.color.setHex(theme.hemiSky);
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        resize();
        last = performance.now();
        rafId = requestAnimationFrame(frame);
      } else if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    dispose() {
      this.setActive(false);
      resizeObserver.disconnect();
      if (carGroup) disposeModel(carGroup);
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
