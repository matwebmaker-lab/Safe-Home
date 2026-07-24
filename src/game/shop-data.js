// =====================================================================
// Butikkdata for bilspillet: oppgraderinger, lakk og kart.
// Alt kjøpes med mynter fra lommeboka (se profile.js).
//
// Hvert kart er et theme-objekt som sendes til createCarRunner().
// Nattbyens tema må samsvare med DEFAULT_THEME i car-runner.js —
// det er dagens utseende, og det skal se nøyaktig likt ut.
// =====================================================================

// ---------- Biler (karosseri-stil + fordeler) ----------
// style peker på BODY_STYLES i 3dassets/models.js.
// perk tolkes av car-runner.js:
//   turboBonus:  ekstra turbo-nivå oppå kjøpte nivåer (mer fart)
//   magnetBonus: innebygd magnet-nivå (uansett kjøpte nivåer)
//   freeShield:  gratis skjold i hver runde
export const CARS = [
  {
    id: "standard",
    name: "Standard",
    style: "sport",
    description: "Den trofaste startbilen. Ingen bonuser – men gratis!",
    price: 0,
    perk: {},
  },
  {
    id: "rakett",
    name: "Rakett",
    style: "racer",
    description: "Bygd for fart: +10 % toppfart, som et ekstra turbo-nivå.",
    price: 150,
    perk: { turboBonus: 1 },
  },
  {
    id: "boblen",
    name: "Boblen",
    style: "comet",
    description: "Har innebygd myntmagnet (nivå 1) som drar mynter til seg.",
    price: 200,
    perk: { magnetBonus: 1 },
  },
  {
    id: "vakta",
    name: "Vakta",
    style: "muskel",
    description: "Solid muskelbil med skjold-generator: gratis skjold i hver runde.",
    price: 250,
    perk: { freeShield: true },
  },
  {
    id: "mini",
    name: "Mini",
    style: "mini",
    description: "Liten, søt og billig. En fin første bil å samle på.",
    price: 60,
    perk: {},
  },
  {
    id: "pickup",
    name: "Pickup",
    style: "pickup",
    description: "Tøff arbeidshest: gratis skjold hver runde OG innebygd magnet.",
    price: 400,
    perk: { freeShield: true, magnetBonus: 1 },
  },
  {
    id: "buggy",
    name: "Buggy",
    style: "buggy",
    description: "Terrengkløver med bergingsbur og full myntmagnet (nivå 2).",
    price: 350,
    perk: { magnetBonus: 2 },
  },
  {
    id: "formel",
    name: "Formel",
    style: "formel",
    description: "Ren racerbil med åpne hjul: +20 % toppfart (to ekstra turbo-nivåer).",
    price: 500,
    perk: { turboBonus: 2 },
  },
];

// ---------- Oppgraderinger (nivåbaserte, pris per nivå) ----------
export const UPGRADES = [
  {
    id: "turbo",
    name: "Turbo-motor",
    description: "+10 % toppfart per nivå – flere mynter per minutt.",
    prices: [30, 60, 100],
  },
  {
    id: "magnet",
    name: "Myntmagnet",
    description: "Drar mynter i nabofilen mot bilen. Nivå 2 har lengre rekkevidde og sterkere drag.",
    prices: [40, 80],
  },
  {
    id: "skjold",
    name: "Skjold",
    description: "Tåler én kollisjon uten at du mister rekken. Brukes opp og kan kjøpes på nytt.",
    prices: [25],
  },
];

// ---------- Lakk (farge på bilen) ----------
export const PAINTS = [
  { id: "mint", name: "Mint", color: 0x38e6ac, price: 0 },
  { id: "rod", name: "Rød", color: 0xe2483d, price: 20 },
  { id: "bla", name: "Blå", color: 0x3d7be2, price: 20 },
  { id: "lilla", name: "Lilla", color: 0x9b5de5, price: 30 },
  { id: "hvit", name: "Hvit", color: 0xf2f4f3, price: 40 },
  { id: "gull", name: "Gull", color: 0xffc94a, price: 50 },
];

// ---------- Kart (tema for hele verdenen) ----------
export const MAPS = [
  {
    id: "nattby",
    name: "Nattbyen",
    description: "Den klassiske nattkjøringen under stjernehimmelen.",
    price: 0,
    theme: {
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
      glowColor: 0x38e6ac, glowOpacity: 0.055,
      scenery: "tre",
    },
  },
  {
    id: "orken",
    name: "Ørkenen",
    description: "Solskinnskjøring blant sanddyner og kaktuser.",
    price: 75,
    theme: {
      skyStops: [[0.0, "#6fb6dd"], [0.55, "#a4d4e6"], [0.78, "#e6d6a4"], [0.88, "#efc784"], [1.0, "#c89f60"]],
      fogColor: 0xd8c090, fogNear: 30, fogFar: 110,
      groundColor: 0xc9a55e,
      trunkColor: 0x7a5c34,
      foliageColor: 0x3f7038,
      railColor: 0xb0a48f,
      lampColor: 0xfff2cf,
      lampEmissive: 0xffe9b0,
      ambientColor: 0xfff0d8, ambientIntensity: 0.75,
      hemiSky: 0xbfe0f0, hemiGround: 0x8a6c40, hemiIntensity: 0.9,
      sunColor: 0xfff4dc, sunIntensity: 2.2,
      starOpacity: 0,
      glowColor: 0xffc94a, glowOpacity: 0.04,
      scenery: "kaktus",
    },
  },
  {
    id: "vinter",
    name: "Vinterveien",
    description: "Kald, klar vinterdag med snødekte trær langs veien.",
    price: 100,
    theme: {
      skyStops: [[0.0, "#5a7a9c"], [0.55, "#8aa8c0"], [0.78, "#c0d4e0"], [0.88, "#dce8f0"], [1.0, "#aebfd0"]],
      fogColor: 0xc8d8e4, fogNear: 24, fogFar: 90,
      groundColor: 0xe4ecf2,
      trunkColor: 0x5c4c3c,
      foliageColor: 0xeef4f8,
      railColor: 0xa8b4bc,
      lampColor: 0xfff2cf,
      lampEmissive: 0xffe9b0,
      ambientColor: 0xd8e8f8, ambientIntensity: 0.6,
      hemiSky: 0xafc4d8, hemiGround: 0x788898, hemiIntensity: 0.8,
      sunColor: 0xe8f0ff, sunIntensity: 1.6,
      starOpacity: 0,
      glowColor: 0x9fd8ff, glowOpacity: 0.05,
      scenery: "snøtre",
    },
  },
  {
    id: "solnedgang",
    name: "Solnedgang",
    description: "Kveldskjøring under en brennende oransje og lilla himmel.",
    price: 150,
    theme: {
      skyStops: [[0.0, "#2a1a4a"], [0.5, "#6a2a5c"], [0.75, "#c8503c"], [0.87, "#f08048"], [1.0, "#38182c"]],
      fogColor: 0x3c1c30, fogNear: 26, fogFar: 95,
      groundColor: 0x241218,
      trunkColor: 0x3c2a1c,
      foliageColor: 0x14352a,
      railColor: 0x8a8078,
      lampColor: 0xffd9b0,
      lampEmissive: 0xffc890,
      ambientColor: 0xe8a888, ambientIntensity: 0.4,
      hemiSky: 0x8a4a6a, hemiGround: 0x180a10, hemiIntensity: 0.55,
      sunColor: 0xffb070, sunIntensity: 1.6,
      starOpacity: 0.35,
      glowColor: 0xff8048, glowOpacity: 0.06,
      scenery: "palme",
    },
  },
  {
    id: "dagslys",
    name: "Dagstur",
    description: "Solkjøring på landeveien en fin sommerdag.",
    price: 125,
    theme: {
      skyStops: [[0.0, "#3a7cc8"], [0.55, "#7ab4e4"], [0.78, "#b8d8f0"], [0.88, "#d8ecf8"], [1.0, "#a8cce8"]],
      fogColor: 0xa8c8e0, fogNear: 32, fogFar: 115,
      groundColor: 0x3a6a34,
      trunkColor: 0x5c4630,
      foliageColor: 0x2a5a2c,
      railColor: 0xb8bcb8,
      lampColor: 0xfff2cf,
      lampEmissive: 0xffe9b0,
      ambientColor: 0xf0f4e8, ambientIntensity: 0.8,
      hemiSky: 0xbfd8f0, hemiGround: 0x3a5a34, hemiIntensity: 1.0,
      sunColor: 0xfff8e0, sunIntensity: 2.4,
      starOpacity: 0,
      glowColor: 0xfff4c8, glowOpacity: 0.05,
      scenery: "tre",
    },
  },
  {
    id: "galakse",
    name: "Galakse",
    description: "Nattkjøring helt ytterst i verdensrommet, under tusen stjerner.",
    price: 200,
    theme: {
      skyStops: [[0.0, "#05010f"], [0.5, "#0d0524"], [0.75, "#2a1050"], [0.87, "#4a2070"], [1.0, "#08020f"]],
      fogColor: 0x0a0518, fogNear: 26, fogFar: 95,
      groundColor: 0x0a0714,
      trunkColor: 0x1c1428,
      foliageColor: 0x241a44,
      railColor: 0x6a6a8a,
      lampColor: 0xd8ccff,
      lampEmissive: 0xbfa8ff,
      ambientColor: 0x8a7ac8, ambientIntensity: 0.35,
      hemiSky: 0x3a2a6d, hemiGround: 0x050308, hemiIntensity: 0.55,
      sunColor: 0xc8b8f0, sunIntensity: 1.3,
      starOpacity: 1.0,
      glowColor: 0x9b5de5, glowOpacity: 0.08,
      scenery: "tre",
    },
  },
];

export function getCar(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

export function getPaint(id) {
  return PAINTS.find((p) => p.id === id) || PAINTS[0];
}

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
