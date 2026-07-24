// =====================================================================
// 3D-garasje: roterbar forhåndsvisning av valgt bil i garasjepanelet.
// Bruker modellene fra 3dassets — dra for å se bilen fra alle sider.
// =====================================================================
import * as THREE from "../vendor/three.module.min.js";
import { createPlayerCar, disposeModel } from "../3dassets/models.js";

export function createGarageView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 50);

  // Garasje-lys: varm taklampe + kjølig fyll + mint kantlys
  scene.add(new THREE.AmbientLight(0x8fd8c0, 0.4));
  scene.add(new THREE.HemisphereLight(0x2a6d55, 0x050807, 0.55));
  const key = new THREE.DirectionalLight(0xfff2dc, 1.9);
  key.position.set(3, 6, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.002;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6efdff, 0.5);
  rim.position.set(-4, 2.5, -4);
  scene.add(rim);

  // Gulv: mørk plate som tar imot skyggen
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5, 40),
    new THREE.MeshStandardMaterial({ color: 0x0c1210, roughness: 0.85, metalness: 0.15 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.PolarGridHelper(5, 10, 5, 40, 0x1b3b30, 0x122019);
  grid.position.y = 0.005;
  scene.add(grid);

  // ---------- Orbit (dra for å rotere, auto-roter ellers) ----------
  const orbit = { theta: Math.PI * 0.7, phi: 1.12, radius: 4.6, targetY: 0.5 };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let idleTimer = null;

  function armAutoRotate() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleTimer = null; }, 2500);
  }
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = -1; }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    orbit.theta -= (e.clientX - lastX) * 0.01;
    orbit.phi = Math.min(1.45, Math.max(0.5, orbit.phi - (e.clientY - lastY) * 0.008));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = () => { dragging = false; armAutoRotate(); };
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

  // ---------- Bil ----------
  let car = null;
  let current = { paint: 0x38e6ac, style: "sport", upgrades: { turbo: 0, magnet: 0, skjold: 0 } };

  function rebuild() {
    if (car) {
      scene.remove(car);
      disposeModel(car);
    }
    car = createPlayerCar({
      paint: current.paint,
      style: current.style,
      turbo: current.upgrades.turbo || 0,
      magnet: current.upgrades.magnet || 0,
      skjold: current.upgrades.skjold || 0,
    });
    scene.add(car);
  }
  rebuild();

  // ---------- Størrelse + loop (kjører bare når aktiv) ----------
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  let active = false;
  let rafId = null;
  let last = 0;

  function frame(now) {
    if (!active) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (!dragging && idleTimer === null) orbit.theta += dt * 0.4;
    if (car) {
      for (const w of car.userData.wheels || []) w.rotation.x += dt * 2;
      const flames = car.userData.flames || [];
      const t = now / 1000;
      flames.forEach((f, i) => {
        const pulse = 0.85 + Math.sin(t * 18 + i) * 0.15;
        f.scale.set(pulse, 0.7 + Math.random() * 0.6, pulse);
      });
      if (car.userData.shieldRing) {
        car.userData.shieldRing.rotation.y += dt * 0.8;
        car.userData.shieldDome.rotation.y -= dt * 0.35;
      }
    }
    applyCamera();
    renderer.render(scene, camera);
  }

  resize();
  applyCamera();
  renderer.render(scene, camera);

  return {
    // Bytt bil/lakk/oppgraderinger — kalles ved hvert garasjevalg
    update({ paint, style, upgrades }) {
      current = {
        paint: paint ?? current.paint,
        style: style || current.style,
        upgrades: { ...current.upgrades, ...(upgrades || {}) },
      };
      rebuild();
      resize();
      if (!active) renderer.render(scene, camera);
    },
    // Render-loopen kjøres bare mens garasjen er åpen
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
      if (car) disposeModel(car);
      renderer.dispose();
    },
  };
}
