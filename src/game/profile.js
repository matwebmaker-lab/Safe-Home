// =====================================================================
// Spillerprofil for bilspillet — lagres i localStorage slik at mynter,
// oppgraderinger, lakk og kart overlever mellom økter (fungerer både
// i Tauri-webview og i nettleser-forhåndsvisning).
// =====================================================================

const STORAGE_KEY = "skjermtid-car-profile";

const DEFAULT_PROFILE = {
  coins: 0, // vedvarende lommebok (myntene gir OGSÅ skjermtid som før)
  upgrades: { turbo: 0, magnet: 0, skjold: 0 }, // nivå per oppgradering
  ownedPaints: ["mint"],
  ownedMaps: ["nattby"],
  selectedPaint: "mint",
  selectedMap: "nattby",
};

export function loadProfile() {
  const profile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return profile;
    profile.coins = Math.max(0, saved.coins | 0);
    for (const key of Object.keys(profile.upgrades)) {
      profile.upgrades[key] = Math.max(0, (saved.upgrades?.[key] ?? 0) | 0);
    }
    if (Array.isArray(saved.ownedPaints)) {
      profile.ownedPaints = [...new Set(["mint", ...saved.ownedPaints])];
    }
    if (Array.isArray(saved.ownedMaps)) {
      profile.ownedMaps = [...new Set(["nattby", ...saved.ownedMaps])];
    }
    if (profile.ownedPaints.includes(saved.selectedPaint)) {
      profile.selectedPaint = saved.selectedPaint;
    }
    if (profile.ownedMaps.includes(saved.selectedMap)) {
      profile.selectedMap = saved.selectedMap;
    }
  } catch {
    // Korrupt eller utilgjengelig lagring → start med standardprofil
  }
  return profile;
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
