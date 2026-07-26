// =====================================================================
// DOM-effekter for lommebok og opptjent tid: mynt som flyr til inventar,
// tall som tick'er opp, og en kort pop/flash på mål-elementet.
// =====================================================================

import { COIN_SVG } from "./garage-icons.js";

function layer() {
  return document.getElementById("stat-fx-layer");
}

function formatMMSS(total) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Force-reflow + temporary class (samme mønster som PIN-shake). */
export function popStat(el, className = "stat-pop", durationMs = 450) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), durationMs);
}

function spawnCoinNode(x, y) {
  const host = layer();
  if (!host) return null;
  const node = document.createElement("div");
  node.className = "stat-fx-coin";
  node.innerHTML = COIN_SVG;
  // Unik gradient-id så flere samtidige mynter ikke kolliderer
  const gid = `coin-fly-${Math.random().toString(36).slice(2, 9)}`;
  node.querySelector("radialGradient")?.setAttribute("id", gid);
  const circle = node.querySelector("circle[fill^='url']");
  if (circle) circle.setAttribute("fill", `url(#${gid})`);
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.transform = "translate(-50%, -50%) scale(1)";
  host.appendChild(node);
  return node;
}

/**
 * Flyt en (eller flere) mynter fra et startpunkt til lommebok-målet.
 * @param {HTMLElement} targetEl  Elementet mynten skal lande på (f.eks. strong eller .resource-coins)
 * @param {{ fromEl?: HTMLElement|null, count?: number }} [opts]
 */
export function flyCoinTo(targetEl, opts = {}) {
  if (!targetEl) return;
  const count = Math.max(1, Math.min(opts.count ?? 1, 3));
  const fromEl = opts.fromEl || null;

  let startX;
  let startY;
  if (fromEl) {
    const r = fromEl.getBoundingClientRect();
    startX = r.left + r.width / 2;
    startY = r.top + r.height / 2;
  } else {
    startX = window.innerWidth * 0.5;
    startY = window.innerHeight * 0.55;
  }

  const dest = targetEl.getBoundingClientRect();
  const endX = dest.left + dest.width / 2;
  const endY = dest.top + dest.height / 2;
  const popTarget = targetEl.closest(".resource-coins") || targetEl;

  for (let i = 0; i < count; i++) {
    const delay = i * 70;
    const jitterX = (i - (count - 1) / 2) * 18;
    const sx = startX + jitterX;
    const sy = startY + (i % 2 === 0 ? -6 : 8);

    window.setTimeout(() => {
      const node = spawnCoinNode(sx, sy);
      if (!node) return;

      const dx = endX - sx;
      const dy = endY - sy;
      const midX = dx * 0.45;
      const midY = dy * 0.35 - 70; // bue oppover
      const duration = 520;

      const t0 = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        // ease-in-out cubic
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        // kvadratisk Bezier for buen
        const u = 1 - e;
        const x = u * u * 0 + 2 * u * e * midX + e * e * dx;
        const y = u * u * 0 + 2 * u * e * midY + e * e * dy;
        const scale = 1 - e * 0.35;
        const opacity = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
        node.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
        node.style.opacity = String(opacity);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          node.remove();
          if (i === count - 1) popStat(popTarget);
        }
      }
      requestAnimationFrame(frame);
    }, delay);
  }
}

/**
 * Tell opp MM:SS på et element og spill en kort flash/pop.
 * @param {HTMLElement} el
 * @param {{ fromSeconds: number, toSeconds: number, format?: (n:number)=>string }} opts
 */
export function bumpTime(el, opts) {
  if (!el) return;
  const from = Math.max(0, Math.floor(opts.fromSeconds ?? 0));
  const to = Math.max(0, Math.floor(opts.toSeconds ?? from));
  const fmt = opts.format || formatMMSS;
  const wrap = el.closest(".resource-time") || el;

  if (to <= from) {
    el.textContent = fmt(to);
    return;
  }

  el.textContent = fmt(from);

  wrap.classList.remove("stat-pop", "time-flash");
  void wrap.offsetWidth;
  wrap.classList.add("stat-pop", "time-flash");
  window.setTimeout(() => wrap.classList.remove("stat-pop"), 450);
  window.setTimeout(() => wrap.classList.remove("time-flash"), 550);

  // +Xs-etikett som stiger
  const host = layer();
  if (host) {
    const plus = document.createElement("div");
    plus.className = "stat-fx-plus";
    const gained = to - from;
    plus.textContent = `+${gained}s`;
    const r = wrap.getBoundingClientRect();
    plus.style.left = `${r.left + r.width / 2}px`;
    plus.style.top = `${r.top}px`;
    plus.style.transform = "translate(-50%, -100%)";
    host.appendChild(plus);
    const t0 = performance.now();
    const dur = 700;
    function rise(now) {
      const t = Math.min(1, (now - t0) / dur);
      const y = -12 - t * 28;
      plus.style.transform = `translate(-50%, calc(-100% + ${y}px))`;
      plus.style.opacity = String(1 - t);
      if (t < 1) requestAnimationFrame(rise);
      else plus.remove();
    }
    requestAnimationFrame(rise);
  }

  const duration = Math.min(480, 40 + (to - from) * 12);
  const t0 = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - t, 2);
    const val = Math.round(from + (to - from) * eased);
    el.textContent = fmt(val);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(to);
  }
  requestAnimationFrame(tick);
}
