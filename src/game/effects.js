// =====================================================================
// Lettvekts VFX for bilspillet: kameraristing, glød, eksplosjon.
// Fungerer uten postprocessing-stack; reduserer partikler ved lowGraphics.
// =====================================================================
import * as THREE from "../vendor/three.module.min.js";

const COLOR_MINT = 0x38e6ac;
const COLOR_GOLD = 0xffe08a;
const COLOR_RED = 0xe2483d;
const COLOR_WHITE = 0xffffff;

function makeRadialTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function createEffects({ scene, camera, overlayEl, lowGraphics = false }) {
  const particles = [];
  const bursts = [];
  let shakeIntensity = 0;
  let shakeUntil = 0;
  let elapsed = 0;
  const baseCam = { x: 0, y: 9.5, z: 11.5 };
  const glowTex = makeRadialTexture("rgba(255,255,255,0.95)", "rgba(255,200,80,0.35)");
  const gloryTex = makeRadialTexture("rgba(180,255,230,0.95)", "rgba(56,230,172,0.25)");
  const disposables = [glowTex, gloryTex];

  const explosionMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(COLOR_GOLD) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float core = smoothstep(0.55, 0.0, r);
        float ring = smoothstep(0.85, 0.35, r) * smoothstep(0.15, 0.45, r);
        float pulse = 0.75 + 0.25 * sin(uTime * 18.0);
        float alpha = (core * 1.2 + ring * 0.7) * uIntensity * pulse;
        vec3 col = mix(uColor, vec3(1.0), core);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
  });
  disposables.push(explosionMat);

  function spawnSprites(position, count, color, speed, life, size) {
    const n = lowGraphics ? Math.max(4, Math.floor(count * 0.35)) : count;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 1,
      });
      const spr = new THREE.Sprite(mat);
      spr.position.copy(position);
      spr.position.x += (Math.random() - 0.5) * 0.4;
      spr.position.y += 0.4 + Math.random() * 0.6;
      spr.position.z += (Math.random() - 0.5) * 0.4;
      const s = size * (0.5 + Math.random());
      spr.scale.set(s, s, 1);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        1.5 + Math.random() * speed,
        (Math.random() - 0.5) * speed * 0.5
      );
      scene.add(spr);
      particles.push({ spr, mat, vel, life, age: 0, size: s });
    }
  }

  function setOverlay(color, opacity) {
    if (!overlayEl) return;
    overlayEl.style.background = color;
    overlayEl.style.opacity = String(opacity);
  }

  function shake(intensity, duration) {
    shakeIntensity = Math.max(shakeIntensity, intensity);
    shakeUntil = Math.max(shakeUntil, elapsed + duration);
  }

  function flash(cssColor, duration = 0.25, peak = 0.45) {
    if (!overlayEl) return;
    setOverlay(cssColor, peak);
    const start = elapsed;
    bursts.push({
      kind: "flash",
      start,
      duration,
      peak,
      color: cssColor,
    });
  }

  function glory(position) {
    spawnSprites(position, 18, COLOR_MINT, 4.5, 0.7, 0.9);
    spawnSprites(position, 8, COLOR_WHITE, 2.5, 0.5, 1.4);
    const mat = new THREE.SpriteMaterial({
      map: gloryTex,
      color: COLOR_MINT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.95,
    });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(position);
    spr.position.y += 1.2;
    spr.scale.set(3.5, 3.5, 1);
    scene.add(spr);
    bursts.push({
      kind: "ring",
      spr,
      mat,
      start: elapsed,
      duration: 0.55,
      startScale: 2.2,
      endScale: 7,
    });
    flash("rgba(180,255,230,0.55)", 0.28, 0.35);
  }

  function explode(position, scale = 1) {
    spawnSprites(position, 28 * scale, COLOR_GOLD, 7 * scale, 0.85, 1.1 * scale);
    spawnSprites(position, 14 * scale, COLOR_RED, 5 * scale, 0.7, 0.8 * scale);
    spawnSprites(position, 10 * scale, COLOR_WHITE, 3 * scale, 0.5, 1.6 * scale);

    const geo = new THREE.SphereGeometry(1.2 * scale, lowGraphics ? 12 : 24, lowGraphics ? 8 : 16);
    const mat = explosionMat.clone();
    mat.uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(COLOR_GOLD) },
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y += 1.0;
    scene.add(mesh);
    bursts.push({
      kind: "explosion",
      mesh,
      mat,
      geo,
      start: elapsed,
      duration: 0.9,
      startScale: 0.4 * scale,
      endScale: 4.5 * scale,
    });
    shake(0.55 * scale, 0.7);
    flash("rgba(255,200,60,0.7)", 0.55, 0.65);
  }

  function failBurst(position, big = false) {
    spawnSprites(position, big ? 22 : 12, COLOR_RED, big ? 6 : 3.5, 0.6, big ? 1.0 : 0.65);
    shake(big ? 0.5 : 0.28, big ? 0.65 : 0.4);
    flash("rgba(220,40,40,0.55)", big ? 0.5 : 0.35, big ? 0.55 : 0.4);
  }

  function update(dt, camBase) {
    elapsed += dt;
    if (camBase) {
      baseCam.x = camBase.x;
      baseCam.y = camBase.y;
      baseCam.z = camBase.z;
    }

    // Kameraristing
    if (elapsed < shakeUntil && shakeIntensity > 0) {
      const t = (shakeUntil - elapsed) / 0.7;
      const amp = shakeIntensity * Math.max(0, Math.min(1, t));
      camera.position.x = baseCam.x + (Math.random() - 0.5) * amp * 1.4;
      camera.position.y = baseCam.y + (Math.random() - 0.5) * amp * 0.8;
      camera.position.z = baseCam.z + (Math.random() - 0.5) * amp * 0.5;
    } else {
      shakeIntensity = 0;
      camera.position.x = baseCam.x;
      camera.position.y = baseCam.y;
      camera.position.z = baseCam.z;
    }

    // Partikler
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      p.vel.y -= 6 * dt;
      p.spr.position.addScaledVector(p.vel, dt);
      const lifeT = 1 - p.age / p.life;
      p.mat.opacity = Math.max(0, lifeT);
      const s = p.size * (0.6 + lifeT * 0.6);
      p.spr.scale.set(s, s, 1);
      if (p.age >= p.life) {
        scene.remove(p.spr);
        p.mat.dispose();
        particles.splice(i, 1);
      }
    }

    // Burst-effekter (ring / eksplosjon / flash)
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const t = (elapsed - b.start) / b.duration;
      if (b.kind === "flash") {
        const o = b.peak * Math.max(0, 1 - t);
        setOverlay(b.color, o);
        if (t >= 1) bursts.splice(i, 1);
      } else if (b.kind === "ring") {
        const s = b.startScale + (b.endScale - b.startScale) * Math.min(1, t);
        b.spr.scale.set(s, s, 1);
        b.mat.opacity = Math.max(0, 1 - t);
        if (t >= 1) {
          scene.remove(b.spr);
          b.mat.dispose();
          bursts.splice(i, 1);
        }
      } else if (b.kind === "explosion") {
        const s = b.startScale + (b.endScale - b.startScale) * Math.min(1, t);
        b.mesh.scale.setScalar(s);
        b.mat.uniforms.uTime.value = elapsed - b.start;
        b.mat.uniforms.uIntensity.value = Math.max(0, 1 - t * 0.95);
        if (t >= 1) {
          scene.remove(b.mesh);
          b.geo.dispose();
          b.mat.dispose();
          bursts.splice(i, 1);
        }
      }
    }
  }

  function clear() {
    for (const p of particles) {
      scene.remove(p.spr);
      p.mat.dispose();
    }
    particles.length = 0;
    for (const b of bursts) {
      if (b.spr) {
        scene.remove(b.spr);
        b.mat.dispose();
      }
      if (b.mesh) {
        scene.remove(b.mesh);
        b.geo.dispose();
        b.mat.dispose();
      }
    }
    bursts.length = 0;
    shakeIntensity = 0;
    shakeUntil = 0;
    setOverlay("transparent", 0);
  }

  function dispose() {
    clear();
    for (const d of disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
  }

  function setLowGraphics(on) {
    lowGraphics = on;
  }

  return {
    shake,
    flash,
    glory,
    explode,
    failBurst,
    update,
    clear,
    dispose,
    setLowGraphics,
  };
}
