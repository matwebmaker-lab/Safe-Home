// =====================================================================
// Spillerprofil for bilspillet — lagres i localStorage slik at mynter,
// oppgraderinger, lakk og kart overlever mellom økter (fungerer både
// i Tauri-webview og i nettleser-forhåndsvisning).
// =====================================================================

const STORAGE_KEY = "safe-home-car-profile";
const LEGACY_STORAGE_KEY = "skjermtid-car-profile";

const DEFAULT_PROFILE = {
  coins: 0, // vedvarende lommebok (myntene gir OGSÅ skjermtid som før)
  upgrades: { turbo: 0, magnet: 0, skjold: 0 }, // nivå per oppgradering
  ownedCars: ["standard"],
  ownedPaints: ["mint"],
  ownedMaps: ["nattby"],
  selectedCar: "standard",
  selectedPaint: "mint",
  selectedMap: "nattby",
  lastMode: "normal", // "normal" | "bomb"
  bestSurvival: { normal: 0, bomb: 0 }, // beste overlevelsestid (sekunder)
};

export function loadProfile() {
  const profile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return profile;
    profile.coins = Math.max(0, saved.coins | 0);
    for (const key of Object.keys(profile.upgrades)) {
      profile.upgrades[key] = Math.max(0, (saved.upgrades?.[key] ?? 0) | 0);
    }
    if (Array.isArray(saved.ownedCars)) {
      profile.ownedCars = [...new Set(["standard", ...saved.ownedCars])];
    }
    if (Array.isArray(saved.ownedPaints)) {
      profile.ownedPaints = [...new Set(["mint", ...saved.ownedPaints])];
    }
    if (Array.isArray(saved.ownedMaps)) {
      profile.ownedMaps = [...new Set(["nattby", ...saved.ownedMaps])];
    }
    if (profile.ownedCars.includes(saved.selectedCar)) {
      profile.selectedCar = saved.selectedCar;
    }
    if (profile.ownedPaints.includes(saved.selectedPaint)) {
      profile.selectedPaint = saved.selectedPaint;
    }
    if (profile.ownedMaps.includes(saved.selectedMap)) {
      profile.selectedMap = saved.selectedMap;
    }
    if (saved.lastMode === "normal" || saved.lastMode === "bomb") {
      profile.lastMode = saved.lastMode;
    }
    if (saved.bestSurvival && typeof saved.bestSurvival === "object") {
      profile.bestSurvival.normal = Math.max(0, saved.bestSurvival.normal | 0);
      profile.bestSurvival.bomb = Math.max(0, saved.bestSurvival.bomb | 0);
    }
  } catch {
    // Korrupt eller utilgjengelig lagring → start med standardprofil
  }
  return profile;
}

/** Oppdater beste overlevelsestid for en modus. Returnerer true ved ny rekord. */
export function recordBestSurvival(profile, mode, seconds) {
  const key = mode === "bomb" ? "bomb" : "normal";
  const score = Math.max(0, Math.floor(seconds));
  if (score > (profile.bestSurvival[key] | 0)) {
    profile.bestSurvival[key] = score;
    return true;
  }
  return false;
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Lagring er "best effort" — spillet skal fungere uten
  }
}

export function addCoins(profile, n) {
  profile.coins = Math.max(0, profile.coins + n);
  return profile.coins;
}

// Trekker prisen fra lommeboka hvis spilleren har råd. Returnerer true
// ved gjennomført kjøp, false hvis det ikke er nok mynter.
export function purchase(profile, price) {
  if (profile.coins < price) return false;
  profile.coins -= price;
  return true;
}
