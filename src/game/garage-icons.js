// =====================================================================
// SVG-ikoner for garasjen: gullmynt til priser og sølv-kortikoner
// i stilen fra design-mockupen. Delt mellom appen (main.js) og
// forhåndsvisningen (garage-preview.html) — ikke lag kopier.
// =====================================================================

// Gullmynt med $ (samme som lommeboka øverst i mockupen).
// Gradient-id-ene dupliseres når ikonet brukes flere steder — trygt
// så lenge definisjonene er identiske (nettleseren bruker den første).
export const COIN_SVG = `<svg class="coin-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="coin-g" cx="0.35" cy="0.3" r="0.95"><stop offset="0" stop-color="#ffe9a8"/><stop offset="0.55" stop-color="#ffc94a"/><stop offset="1" stop-color="#c98f1d"/></radialGradient></defs><circle cx="32" cy="32" r="26" fill="url(#coin-g)" stroke="#a87614" stroke-width="4"/><text x="32" y="43" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="900" fill="#8a5c10">$</text></svg>`;

// Sølv-gradient som gir kortikonene det «metalliske» uttrykket.
const silver = (id, body) =>
  `<svg class="card-svg" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6eee9"/><stop offset="0.5" stop-color="#aebbb3"/><stop offset="1" stop-color="#74837b"/></linearGradient></defs>${body}</svg>`;

const shade = "rgba(20, 30, 26, 0.35)";

// Nøklene tilsvarer UPGRADES[].id i shop-data.js, pluss de to
// «kommer snart»-kortene (dekk og nitro).
export const CARD_ICON_SVGS = {
  // MOTOR (turbo-oppgraderingen): motorblokk med sylindertopper
  turbo: silver("gi-motor", `
    <rect x="10" y="26" width="44" height="24" rx="4" fill="url(#gi-motor)"/>
    <rect x="16" y="15" width="8" height="11" rx="2" fill="url(#gi-motor)"/>
    <rect x="28" y="15" width="8" height="11" rx="2" fill="url(#gi-motor)"/>
    <rect x="40" y="15" width="8" height="11" rx="2" fill="url(#gi-motor)"/>
    <rect x="3" y="32" width="7" height="11" rx="2" fill="url(#gi-motor)"/>
    <rect x="54" y="30" width="7" height="9" rx="2" fill="url(#gi-motor)"/>
    <rect x="14" y="50" width="36" height="5" rx="2.5" fill="url(#gi-motor)"/>
    <rect x="14" y="31" width="36" height="4" rx="2" fill="${shade}"/>`),
  // MAGNET: hestesko-magnet
  magnet: silver("gi-magnet", `
    <path d="M16 54 V30 A16 16 0 0 1 48 30 V54 H37 V30 A5 5 0 0 0 27 30 V54 Z" fill="url(#gi-magnet)"/>
    <rect x="16" y="44" width="11" height="10" fill="${shade}"/>
    <rect x="37" y="44" width="11" height="10" fill="${shade}"/>`),
  // SKJOLD
  skjold: silver("gi-skjold", `
    <path d="M32 5 L53 13 V30 C53 44 44 53 32 59 C20 53 11 44 11 30 V13 Z" fill="url(#gi-skjold)"/>
    <path d="M32 13 L45 18.5 V30 C45 39.5 39.5 46.5 32 51.5 C24.5 46.5 19 39.5 19 30 V18.5 Z" fill="${shade}"/>`),
  // DEKK (kommer snart): hjul med mønsterblokker og felg
  dekk: silver("gi-dekk", `
    <circle cx="32" cy="32" r="21" fill="none" stroke="url(#gi-dekk)" stroke-width="11" stroke-dasharray="7 5"/>
    <circle cx="32" cy="32" r="13" fill="url(#gi-dekk)"/>
    <circle cx="32" cy="32" r="5.5" fill="#26302b"/>
    <circle cx="25.6" cy="25.6" r="1.7" fill="#26302b"/>
    <circle cx="38.4" cy="25.6" r="1.7" fill="#26302b"/>
    <circle cx="25.6" cy="38.4" r="1.7" fill="#26302b"/>
    <circle cx="38.4" cy="38.4" r="1.7" fill="#26302b"/>`),
  // NITRO (kommer snart): gassflaske med ventil
  nitro: silver("gi-nitro", `
    <rect x="23" y="18" width="18" height="38" rx="8" fill="url(#gi-nitro)"/>
    <rect x="27.5" y="10" width="9" height="9" rx="2" fill="url(#gi-nitro)"/>
    <rect x="22" y="4" width="20" height="7" rx="3.5" fill="url(#gi-nitro)"/>
    <rect x="23" y="32" width="18" height="9" fill="${shade}"/>`),
};
