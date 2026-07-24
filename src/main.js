// Bruker Tauris invoke når appen kjører i Tauri, ellers en enkel
// simulering — slik at frontend kan forhåndsvises i nettleser via
// `bun run preview` uten at Rust/Tauri må bygges først.
// (OBS: siden main.js nå er en ES-modul, må forhåndsvisning skje via
// HTTP-server — å dobbeltklikke index.html direkte fungerer ikke.)
import { createCarRunner } from "./game/car-runner.js";
import { loadProfile, saveProfile, addCoins, purchase, recordBestSurvival } from "./game/profile.js";
import { UPGRADES, PAINTS, MAPS, CARS, getPaint, getMap, getCar } from "./game/shop-data.js";
import { createGarageScene } from "./game/garage-scene.js";

const SURVIVAL_BONUS_RATE = 0.5;
const SURVIVAL_BONUS_CAP = 180; // sekunder før rewardScale

function clampRewardScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(2, Math.max(0.5, Math.round(v * 10) / 10));
}

function formatRewardScaleHint(scale) {
  const s = clampRewardScale(scale);
  return `×${s.toFixed(1)} — skalerer mynt, mattesvar og overlevelsesbonus`;
}

function syncRewardScaleHint(sliderId, hintId) {
  const slider = $(sliderId);
  const hint = $(hintId);
  if (!slider || !hint) return;
  const update = () => {
    hint.textContent = formatRewardScaleHint(slider.value);
  };
  slider.addEventListener("input", update);
  update();
}

const hasTauri = typeof window.__TAURI__ !== "undefined";
const invoke = hasTauri ? window.__TAURI__.core.invoke : mockInvoke;

if (hasTauri) {
  // Ekte OS-vindu er transparent (satt i tauri.conf.json) slik at
  // HUD-boksen kan flyte over skrivebordet med avrundede hjørner.
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
} else {
  // I nettleser-forhåndsvisning: vis HUD-en som en liten fast boks i
  // hjørnet i stedet for full bredde, siden det ekte Tauri-vinduet i
  // HUD-modus faktisk bare er ~356×64px stort.
  document.body.classList.add("preview");
}

// ---------- Enkel simulering for forhåndsvisning i nettleser ----------
const mock = {
  unlockTime: "07:00",
  grantMinutes: 30,
  rewardScale: 1,
  secondsPerHit: 20,
  maxEarnMinutesPerDay: 90,
  autostart: true,
  hudHotkey: "Ctrl+Shift+H",
  earnedToday: 0,
  pin: "1234",
  remainingSeconds: 0,
  tickHandle: null,
  configured: false,
};

const mockUpdate = {
  currentVersion: "0.1.1",
  available: false,
  latestVersion: null,
  notes: null,
  lastCheckedAt: 0,
  checking: false,
  installing: false,
  downloaded: 0,
  total: null,
  error: null,
};

async function mockInvoke(cmd, args) {
  await new Promise((r) => setTimeout(r, 150));

  switch (cmd) {
    case "get_settings_public":
      return {
        unlockTime: mock.unlockTime,
        grantMinutes: mock.grantMinutes,
        rewardScale: mock.rewardScale,
        secondsPerHit: mock.secondsPerHit,
        maxEarnMinutesPerDay: mock.maxEarnMinutesPerDay,
        autostart: mock.autostart,
        hudHotkey: mock.hudHotkey,
        needsSetup: !mock.configured,
      };
    case "complete_setup": {
      if (mock.configured) throw "Appen er allerede konfigurert.";
      const pin = String(args.pin || "").trim();
      if (pin.length < 4 || pin.length > 8) throw "PIN-koden må være mellom 4 og 8 tegn.";
      if (!/^\d+$/.test(pin)) throw "PIN-koden kan bare inneholde tall.";
      mock.pin = pin;
      mock.unlockTime = args.unlockTime;
      mock.grantMinutes = args.grantMinutes;
      const scale = clampRewardScale(
        args.rewardScale != null
          ? Number(args.rewardScale)
          : (Number(args.secondsPerHit) || 20) / 20
      );
      mock.rewardScale = scale;
      mock.secondsPerHit = Math.max(1, Math.round(scale * 20));
      mock.maxEarnMinutesPerDay = args.maxEarnMinutesPerDay;
      mock.autostart = Boolean(args.autostart);
      mock.configured = true;
      return null;
    }
    case "get_status":
      return { remainingSeconds: mock.remainingSeconds };
    case "get_earn_budget": {
      const unlimited = mock.maxEarnMinutesPerDay === 0;
      return {
        unlimited,
        maxPerDay: mock.maxEarnMinutesPerDay,
        earnedToday: mock.earnedToday,
        remaining: unlimited ? null : Math.max(0, mock.maxEarnMinutesPerDay - mock.earnedToday),
      };
    }
    case "verify_pin":
      return args.pin === mock.pin;
    case "update_settings":
      if (args.currentPin !== mock.pin) throw "Feil PIN-kode";
      if (args.newPin && args.newPin.trim()) {
        const np = args.newPin.trim();
        if (np.length < 4 || np.length > 8) throw "PIN-koden må være mellom 4 og 8 tegn.";
        if (!/^\d+$/.test(np)) throw "PIN-koden kan bare inneholde tall.";
        mock.pin = np;
      }
      mock.unlockTime = args.unlockTime;
      mock.grantMinutes = args.grantMinutes;
      {
        const scale = clampRewardScale(
          args.rewardScale != null
            ? Number(args.rewardScale)
            : (Number(args.secondsPerHit) || mock.secondsPerHit) / 20
        );
        mock.rewardScale = scale;
        mock.secondsPerHit = Math.max(1, Math.round(scale * 20));
      }
      mock.maxEarnMinutesPerDay = args.maxEarnMinutesPerDay;
      mock.autostart = Boolean(args.autostart);
      if (args.hudHotkey) mock.hudHotkey = String(args.hudHotkey);
      return null;
    case "get_update_status":
      return { ...mockUpdate };
    case "check_for_update":
      mockUpdate.checking = true;
      mockUpdate.error = null;
      await new Promise((r) => setTimeout(r, 400));
      mockUpdate.checking = false;
      mockUpdate.available = true;
      mockUpdate.latestVersion = "0.2.0";
      mockUpdate.notes =
        "- Ny oppdateringsknapp i innstillinger\n- Viser hva som er nytt\n- Fremdriftsindikator ved nedlasting";
      mockUpdate.lastCheckedAt = Math.floor(Date.now() / 1000);
      return { ...mockUpdate };
    case "install_update": {
      if (!mockUpdate.available) throw "Ingen ny versjon tilgjengelig.";
      mockUpdate.installing = true;
      mockUpdate.downloaded = 0;
      mockUpdate.total = 8_000_000;
      for (let i = 1; i <= 8; i += 1) {
        await new Promise((r) => setTimeout(r, 120));
        mockUpdate.downloaded = i * 1_000_000;
        if (typeof window.__mockUpdateProgress === "function") {
          window.__mockUpdateProgress({
            downloaded: mockUpdate.downloaded,
            total: mockUpdate.total,
          });
        }
      }
      mockUpdate.installing = false;
      mockUpdate.available = false;
      mockUpdate.currentVersion = mockUpdate.latestVersion || mockUpdate.currentVersion;
      mockUpdate.latestVersion = null;
      mockUpdate.notes = null;
      return null;
    }
    case "switch_user":
    case "shutdown_pc":
      console.log(`[forhåndsvisning] ville kalt "${cmd}" i den ekte appen`);
      return null;
    case "redeem_more_time":
      if (args.pin !== mock.pin) throw "Feil PIN-kode";
      mockStartUnlock(mock.grantMinutes * 60);
      return mock.grantMinutes;
    case "redeem_earned_time": {
      const unlimited = mock.maxEarnMinutesPerDay === 0;
      const budgetLeft = unlimited ? args.minutes : Math.max(0, mock.maxEarnMinutesPerDay - mock.earnedToday);
      if (!unlimited && budgetLeft === 0) {
        throw "Du har brukt opp dagens spilletid. Prøv igjen i morgen, eller spør en voksen om mer tid.";
      }
      const granted = unlimited ? args.minutes : Math.min(args.minutes, budgetLeft);
      mock.earnedToday += granted;
      if (granted > 0) mockStartUnlock(granted * 60);
      return granted;
    }
    default:
      return null;
  }
}

function mockStartUnlock(seconds) {
  mock.remainingSeconds += seconds;
  showHudView(mock.remainingSeconds);
  if (mock.tickHandle) clearInterval(mock.tickHandle);
  mock.tickHandle = setInterval(() => {
    mock.remainingSeconds -= 1;
    if (mock.remainingSeconds <= 0) {
      mock.remainingSeconds = 0;
      clearInterval(mock.tickHandle);
      mock.tickHandle = null;
      showLockedView();
    } else {
      updateHud(mock.remainingSeconds);
    }
  }, 1000);
}

// ---------- Hjelpefunksjoner ----------
function formatMMSS(totalSeconds) {
  const t = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(t / 60).toString().padStart(2, "0");
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function $(id) {
  return document.getElementById(id);
}

// ---------- Klokke i toppchrome ----------
function updateClock() {
  const el = $("clock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
}
updateClock();
setInterval(updateClock, 1000);

// ---------- Modusbytte: låst fullskjerm <-> HUD i hjørnet ----------
// HUD-vinduet vises bare når det er lite tid igjen (under 5 min).
// Med god tid er OS-vinduet skjult, så det ikke ligger over Steam.
const HUD_SHOW_BELOW_SECS = 5 * 60;

const lockedView = $("locked-view");
const hudView = $("hud-view");

function showLockedView() {
  lockedView.hidden = false;
  hudView.hidden = true;
  document.body.classList.remove("mode-hud", "hud-urgent");
  if (hasTauri) invoke("ensure_locked_fullscreen").catch(() => {});
  resetToDefaultActions();
}

function showHudView(remainingSeconds) {
  lockedView.hidden = true;
  hudView.hidden = false;
  document.body.classList.add("mode-hud");
  updateHud(remainingSeconds);
}

async function goToHudAfterGrant() {
  try {
    const status = await invoke("get_status");
    if (status.remainingSeconds > 0) {
      showHudView(status.remainingSeconds);
      return;
    }
  } catch (err) {
    console.error("Klarte ikke å hente status etter unlock:", err);
  }
  showLockedView();
}

function updateHud(remainingSeconds) {
  $("hud-time").textContent = formatMMSS(remainingSeconds);
  document.body.classList.toggle("hud-urgent", remainingSeconds > 0 && remainingSeconds <= 60);
  // Nettleser-forhåndsvisning: skjul pillen når det er god tid
  if (!hasTauri) {
    hudView.style.visibility =
      remainingSeconds > 0 && remainingSeconds <= HUD_SHOW_BELOW_SECS ? "visible" : "hidden";
  }
}

// Dra HUD-pillen rundt på skjermen (Tauri startDragging)
$("hud-pill").addEventListener("mousedown", async (e) => {
  if (!hasTauri || e.button !== 0) return;
  // Ikke start dragging når man trykker på knapper i pillen
  if (e.target.closest("#btn-hud-settings, #btn-hud-play")) return;
  e.preventDefault();
  try {
    await window.__TAURI__.window.getCurrentWindow().startDragging();
  } catch (err) {
    console.error("Klarte ikke å starte dragging:", err);
  }
});

$("btn-hud-settings").addEventListener("click", (e) => {
  e.stopPropagation();
  requestOpenSettings();
});

$("btn-hud-play").addEventListener("click", (e) => {
  e.stopPropagation();
  openEarnGame();
});

function resetToDefaultActions() {
  $("actions-default").hidden = false;
  $("game-panel").hidden = true;
  $("pin-panel").hidden = true;
  $("granted-panel").hidden = true;
  $("settings-gate").hidden = true;
  $("settings-panel").hidden = true;
  $("setup-panel").hidden = true;
  $("shop-panel").hidden = true;
  $("switch-menu").hidden = true;
  $("card").classList.remove("game-active");
  $("card").classList.remove("shop-active");
  $("card").classList.remove("settings-active");
  $("card").classList.remove("setup-active");
  document.body.classList.remove("game-immersive", "setup-mode");
  stopGame();
}

function showSetupWizard(settings) {
  lockedView.hidden = false;
  hudView.hidden = true;
  document.body.classList.add("mode-locked", "setup-mode");
  document.body.classList.remove("mode-hud", "hud-urgent");
  if (hasTauri) invoke("ensure_locked_fullscreen").catch(() => {});

  $("actions-default").hidden = true;
  $("game-panel").hidden = true;
  $("pin-panel").hidden = true;
  $("granted-panel").hidden = true;
  $("settings-gate").hidden = true;
  $("settings-panel").hidden = true;
  $("shop-panel").hidden = true;
  $("setup-panel").hidden = false;
  $("card").classList.add("setup-active");
  $("card").classList.remove("game-active", "shop-active", "settings-active");

  $("setup-reward-scale").value = clampRewardScale(
    settings.rewardScale ?? ((settings.secondsPerHit ?? 20) / 20)
  );
  $("setup-grant-minutes").value = settings.grantMinutes ?? 30;
  $("setup-max-earn").value = settings.maxEarnMinutesPerDay ?? 90;
  $("setup-unlock-time").value = settings.unlockTime || "07:00";
  $("setup-autostart").checked = settings.autostart !== false;
  $("setup-pin").value = "";
  $("setup-pin-confirm").value = "";
  $("setup-error").hidden = true;
  $("setup-pin").focus();
}

// ---------- Oppstart ----------
let currentHudHotkey = "Ctrl+Shift+H";

function applyHudHotkeyLabel(hotkey) {
  currentHudHotkey = hotkey || "Ctrl+Shift+H";
  const pill = $("hud-pill");
  if (pill) {
    pill.title = `Dra for å flytte · ${currentHudHotkey} for å skjule`;
  }
  const input = $("set-hud-hotkey");
  if (input && document.activeElement !== input) {
    input.value = currentHudHotkey;
  }
}

/** Bygg forhåndsvisning / ferdig hurtigtast fra tastatur-event. */
function formatHotkeyFromEvent(e, { allowModifiersOnly = false } = {}) {
  if (e.metaKey || e.key === "Meta" || e.key === "OS") return null;

  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  const isModifierOnly = ["Control", "Shift", "Alt", "Meta", "OS"].includes(e.key);
  if (isModifierOnly) {
    if (!allowModifiersOnly) return null;
    return parts.length ? parts.join("+") : "";
  }

  if (parts.length === 0) return null;

  let key = e.key;
  if (!key) return null;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  else if (key.startsWith("Arrow")) key = key.slice(5);
  else key = key.charAt(0).toUpperCase() + key.slice(1);

  parts.push(key);
  return parts.join("+");
}

async function init() {
  let settings = null;
  try {
    settings = await invoke("get_settings_public");
    $("unlock-time").textContent = settings.unlockTime;
    rewardScale = clampRewardScale(
      settings.rewardScale ?? ((settings.secondsPerHit ?? 20) / 20)
    );
    applyHudHotkeyLabel(settings.hudHotkey);
  } catch (err) {
    console.error("Klarte ikke å hente innstillinger:", err);
  }

  if (settings?.needsSetup) {
    showSetupWizard(settings);
  } else {
    try {
      const status = await invoke("get_status");
      if (status.remainingSeconds > 0) {
        showHudView(status.remainingSeconds);
      } else {
        showLockedView();
      }
    } catch (err) {
      console.error("Klarte ikke å hente status:", err);
      showLockedView();
    }
  }

  if (hasTauri) {
    const { listen } = window.__TAURI__.event;
    listen("time-tick", (event) => {
      if (!hudView.hidden) updateHud(event.payload);
    });
    listen("locked", () => {
      if (!document.body.classList.contains("setup-mode")) showLockedView();
    });
    listen("unlocked", (event) => {
      if (document.body.classList.contains("setup-mode")) return;
      const remaining = Number(event.payload) || 0;
      if (remaining > 0) showHudView(remaining);
    });
    listen("hud-peek", (event) => {
      if (document.body.classList.contains("setup-mode")) return;
      const remaining = Number(event.payload) || 0;
      if (remaining > 0) showHudView(remaining);
    });
    listen("open-settings", () => {
      requestOpenSettings();
    });
    listen("update-status", (event) => {
      applyUpdateStatus(event.payload);
    });
    listen("update-progress", (event) => {
      applyUpdateProgress(event.payload);
    });
  }
}
init();

// ---------- Førstegangsoppsett ----------
$("btn-setup-save").addEventListener("click", async () => {
  const errEl = $("setup-error");
  errEl.hidden = true;

  const pin = $("setup-pin").value.trim();
  const confirm = $("setup-pin-confirm").value.trim();
  const unlockTime = $("setup-unlock-time").value.trim() || "07:00";
  const grantMinutes = Math.max(1, parseInt($("setup-grant-minutes").value, 10) || 1);
  const rewardScaleVal = clampRewardScale($("setup-reward-scale").value);
  const maxEarn = Math.max(0, parseInt($("setup-max-earn").value, 10) || 0);
  const autostart = $("setup-autostart").checked;

  if (!pin || !confirm) {
    errEl.hidden = false;
    errEl.textContent = "Skriv inn og bekreft PIN-koden.";
    return;
  }
  if (pin !== confirm) {
    errEl.hidden = false;
    errEl.textContent = "PIN-kodene er ikke like. Prøv igjen.";
    return;
  }
  if (pin.length < 4 || pin.length > 8) {
    errEl.hidden = false;
    errEl.textContent = "PIN-koden må være mellom 4 og 8 tegn.";
    return;
  }
  if (!/^\d+$/.test(pin)) {
    errEl.hidden = false;
    errEl.textContent = "PIN-koden kan bare inneholde tall.";
    return;
  }

  try {
    await invoke("complete_setup", {
      pin,
      unlockTime,
      grantMinutes,
      rewardScale: rewardScaleVal,
      maxEarnMinutesPerDay: maxEarn,
      autostart,
    });
    rewardScale = rewardScaleVal;
    $("unlock-time").textContent = unlockTime;
    if (!hasTauri) mock.configured = true;
    resetToDefaultActions();
    showLockedView();
  } catch (err) {
    errEl.hidden = false;
    errEl.textContent = String(err);
  }
});

// ---------- "Bytt bruker eller slå av PC" ----------
const switchToggle = $("btn-switch-toggle");
const switchMenu = $("switch-menu");

switchToggle.addEventListener("click", () => {
  const isOpen = !switchMenu.hidden;
  switchMenu.hidden = isOpen;
  switchToggle.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (e) => {
  if (!switchMenu.hidden && !e.target.closest(".switch-wrap")) {
    switchMenu.hidden = true;
    switchToggle.setAttribute("aria-expanded", "false");
  }
});

$("btn-switch-user").addEventListener("click", async () => {
  try {
    await invoke("switch_user");
  } catch (err) {
    console.error("Klarte ikke å bytte bruker:", err);
  }
});

$("btn-shutdown").addEventListener("click", async () => {
  try {
    await invoke("shutdown_pc");
  } catch (err) {
    console.error("Klarte ikke å slå av PC-en:", err);
  }
});

// ---------- "Få mer tid" (voksen godkjenner med PIN) ----------
const actionsDefault = $("actions-default");
const pinPanel = $("pin-panel");
const grantedPanel = $("granted-panel");
const pinInput = $("pin-input");
const pinError = $("pin-error");

$("btn-more-time").addEventListener("click", () => {
  actionsDefault.hidden = true;
  pinPanel.hidden = false;
  pinError.hidden = true;
  pinInput.value = "";
  pinInput.focus();
});

$("btn-pin-cancel").addEventListener("click", () => {
  pinPanel.hidden = true;
  actionsDefault.hidden = false;
});

$("btn-pin-confirm").addEventListener("click", submitPin);
pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitPin();
});

async function submitPin() {
  const pin = pinInput.value.trim();
  if (!pin) return;
  try {
    const minutes = await invoke("redeem_more_time", { pin });
    pinPanel.hidden = true;
    grantedPanel.hidden = false;
    $("granted-text").textContent = `${minutes} minutter innvilget for i dag.`;
    // Kort bekreftelse, deretter riktig HUD-boks i hjørnet
    setTimeout(() => {
      goToHudAfterGrant();
    }, 900);
  } catch (err) {
    pinError.hidden = false;
    pinInput.value = "";
    pinInput.classList.remove("shake");
    void pinInput.offsetWidth;
    pinInput.classList.add("shake");
  }
}

// ---------- "Kjør for å tjene tid" (3D bilspill) ----------
let rewardScale = 1;
let selectedGameMode = "normal"; // "normal" | "bomb"
let carRunner = null;
let gameEarnedSeconds = 0;
let runnerMode = null; // modus runneren ble bygget med
let lastRunEnded = false;

// Vedvarende spillerprofil: lommebok, oppgraderinger, lakk og kart
let profile = loadProfile();
selectedGameMode = profile.lastMode === "bomb" ? "bomb" : "normal";
let shopDirty = false; // true når butikkvalg krever at runneren bygges på nytt

const gamePanel = $("game-panel");
const gameError = $("game-error");
const streakValue = $("streak-value");
const coinsValue = $("coins-value");
const comboStat = $("game-combo");
const shopPanel = $("shop-panel");

function updateWalletDisplays() {
  $("game-wallet-value").textContent = profile.coins;
  $("shop-coins").textContent = profile.coins;
}
updateWalletDisplays();

$("btn-earn-time").addEventListener("click", () => {
  openEarnGame();
});

$("btn-game-cash-out").addEventListener("click", cashOutGame);
$("btn-game-retry").addEventListener("click", () => {
  hideGameOver();
  showModeSelect();
});
$("btn-game-over-garage")?.addEventListener("click", () => {
  hideGameOver();
  openGarageFromGame();
});

$("btn-mode-normal")?.addEventListener("click", () => startMode("normal"));
$("btn-mode-bomb")?.addEventListener("click", () => startMode("bomb"));
$("btn-mode-close")?.addEventListener("click", async () => {
  hideModeSelect();
  await cashOutGame();
});

function updateModeBestLabels() {
  const best = profile.bestSurvival || { normal: 0, bomb: 0 };
  const n = $("mode-best-normal");
  const b = $("mode-best-bomb");
  if (n) n.textContent = String(best.normal | 0);
  if (b) b.textContent = String(best.bomb | 0);
}

function showModeSelect() {
  hideGameOver();
  updateModeBestLabels();
  const el = $("car-mode-select");
  if (el) el.hidden = false;
}

function hideModeSelect() {
  const el = $("car-mode-select");
  if (el) el.hidden = true;
}

async function startMode(mode) {
  selectedGameMode = mode === "bomb" ? "bomb" : "normal";
  profile.lastMode = selectedGameMode;
  saveProfile(profile);
  hideModeSelect();
  // Bygg runner på nytt når modus endres
  if (carRunner && runnerMode !== selectedGameMode) {
    carRunner.dispose();
    carRunner = null;
  }
  await startGame();
}

function openGarageFromGame() {
  if (carRunner) carRunner.pause();
  setGameImmersive(false);
  gamePanel.hidden = true;
  $("card").classList.remove("game-active");
  $("card").classList.add("shop-active");
  renderGarage();
  shopPanel.hidden = false;
  if (garageScene) garageScene.setActive(true);
}

function setBombHealthHud(health) {
  const bar = $("car-bomb-bar");
  const fill = $("car-bomb-fill");
  if (!bar || !fill) return;
  if (health == null) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const pct = Math.max(0, Math.min(1, health));
  fill.style.transform = `scaleX(${pct})`;
}

$("btn-game-fullscreen").addEventListener("click", () => {
  setGameImmersive(!document.body.classList.contains("game-immersive"));
});

/** Åpne bilspillet for å tjene mer tid — fra låseskjerm eller HUD-pille. */
async function openEarnGame() {
  lockedView.hidden = false;
  hudView.hidden = true;
  document.body.classList.remove("mode-hud", "hud-urgent");

  $("actions-default").hidden = true;
  $("pin-panel").hidden = true;
  $("granted-panel").hidden = true;
  $("settings-gate").hidden = true;
  $("settings-panel").hidden = true;
  $("setup-panel").hidden = true;
  $("shop-panel").hidden = true;
  $("switch-menu").hidden = true;
  $("card").classList.remove("settings-active", "shop-active", "setup-active");
  $("card").classList.add("game-active");

  gamePanel.hidden = false;
  gameError.hidden = true;
  setGameImmersive(true);

  // Hold fullskjerm mens spillet er åpent (ellers synker tick-tråden
  // tilbake til HUD-pille når det fortsatt er tid igjen).
  if (hasTauri) {
    try {
      await invoke("begin_settings_ui");
    } catch {
      /* forhåndsvisning */
    }
  }

  await refreshGameBudgetLabel();
  gameEarnedSeconds = 0;
  updateGameEarnedDisplay();
  showModeSelect();
}

function setGameImmersive(on) {
  document.body.classList.toggle("game-immersive", on);
  const btn = $("btn-game-fullscreen");
  btn.textContent = on ? "⛶" : "⛶";
  btn.title = on ? "Avslutt fullskjerm (Esc / F)" : "Fullskjerm (F)";
  // ResizeObserver i runneren plukker opp ny størrelse
  window.dispatchEvent(new Event("resize"));
}

window.addEventListener("keydown", (e) => {
  if (gamePanel.hidden) return;
  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    setGameImmersive(!document.body.classList.contains("game-immersive"));
  } else if (e.key === "Escape" && document.body.classList.contains("game-immersive")) {
    e.preventDefault();
    setGameImmersive(false);
  }
});

async function refreshGameBudgetLabel() {
  const label = $("game-budget");
  try {
    const budget = await invoke("get_earn_budget");
    if (budget.unlimited) {
      label.textContent = "Ingen daglig grense satt.";
    } else {
      label.textContent = `Du kan tjene opptil ${budget.remaining} min til i dag (${budget.earnedToday} av ${budget.maxPerDay} min brukt).`;
    }
  } catch {
    label.textContent = "";
  }
}

function updateGameStatsHud({ combo, coinsCollected }) {
  streakValue.textContent = combo;
  coinsValue.textContent = coinsCollected;
  comboStat.classList.toggle("car-hud-stat--hot", combo >= 5);
}

async function ensureCarRunner() {
  if (carRunner) {
    carRunner.setRewardScale(rewardScale);
    return carRunner;
  }
  try {
    runnerMode = selectedGameMode;
    carRunner = createCarRunner($("car-game-canvas"), {
      rewardScale,
      mode: selectedGameMode,
      paint: getPaint(profile.selectedPaint).color,
      car: getCar(profile.selectedCar),
      upgrades: { ...profile.upgrades },
      theme: getMap(profile.selectedMap).theme,
      onEarn: (seconds) => {
        gameEarnedSeconds += seconds;
        updateGameEarnedDisplay();
      },
      onComboBreak: () => {},
      onStatsUpdate: updateGameStatsHud,
      onCoinCollect: () => {
        addCoins(profile, 1);
        saveProfile(profile);
        updateWalletDisplays();
      },
      onBombHealth: setBombHealthHud,
      onQuestion: (question) => {
        const el = $("car-hud-question");
        const answersEl = $("car-hud-answers");
        if (question) {
          el.textContent = question.text;
          el.hidden = false;
          answersEl.textContent = "";
          const laneLabels = ["Fil 1", "Fil 2", "Fil 3", "Fil 4"];
          (question.answers || []).forEach((value, i) => {
            const chip = document.createElement("div");
            chip.className = "car-answer-chip";
            const small = document.createElement("small");
            small.textContent = laneLabels[i] || `Fil ${i + 1}`;
            chip.appendChild(small);
            chip.appendChild(document.createTextNode(String(value)));
            answersEl.appendChild(chip);
          });
          answersEl.hidden = false;
        } else {
          el.hidden = true;
          answersEl.hidden = true;
          answersEl.textContent = "";
        }
      },
      onShieldUsed: () => {
        profile.upgrades.skjold = 0;
        saveProfile(profile);
      },
      onGameOver: (payload) => {
        showGameOver(payload);
      },
    });
    return carRunner;
  } catch (err) {
    gameError.hidden = false;
    gameError.textContent = err.message || String(err);
    throw err;
  }
}

function hideGameOver() {
  $("car-game-over").hidden = true;
}

function showGameOver(payload = {}) {
  const reason = payload.reason || "wrong";
  const survivalSeconds = Math.max(0, Math.floor(payload.survivalSeconds || 0));
  const coins = payload.coinsCollected | 0;
  const mode = payload.mode === "bomb" ? "bomb" : "normal";

  const titles = {
    wrong: "Feil svar — ute!",
    miss: "Du kjørte forbi — ute!",
    crash: "Krasj — ute!",
    bomb: "Bombe — bang!",
  };
  const descs = {
    wrong: "Kjør gjennom porten med riktig svar neste gang.",
    miss: "Du må velge én av de fire svarene på mållinjen.",
    crash: "Unngå bilene på motorveien mens du kjører.",
    bomb: "Hold farten oppe for å holde bombehelsen høy.",
  };

  // Overlevelsesbonus → skjermtid (én gang per runde)
  const capped = Math.min(SURVIVAL_BONUS_CAP, survivalSeconds);
  const bonus = Math.floor(capped * SURVIVAL_BONUS_RATE * rewardScale);
  if (bonus > 0) {
    gameEarnedSeconds += bonus;
    updateGameEarnedDisplay();
  }

  recordBestSurvival(profile, mode, survivalSeconds);
  saveProfile(profile);

  $("car-game-over-title").textContent = titles[reason] || "Runden er over";
  $("car-game-over-desc").textContent =
    descs[reason] || "Prøv igjen, eller bruk tiden du har opptjent.";
  $("car-game-over-survival").textContent = `${survivalSeconds}s`;
  $("car-game-over-score").textContent = String(survivalSeconds);
  $("car-game-over-coins").textContent = String(coins);
  $("car-game-over-bonus").textContent = `+${bonus}s`;
  $("car-game-over").hidden = false;
  lastRunEnded = true;
}

async function startGame() {
  hideGameOver();
  hideModeSelect();
  lastRunEnded = false;
  setBombHealthHud(selectedGameMode === "bomb" ? 1 : null);
  updateGameEarnedDisplay();
  const runner = await ensureCarRunner();
  runner.start();
}

async function retryGame() {
  hideGameOver();
  showModeSelect();
}

function stopGame() {
  hideGameOver();
  hideModeSelect();
  setBombHealthHud(null);
  if (carRunner) carRunner.stop();
  gameEarnedSeconds = 0;
  lastRunEnded = false;
}

function updateGameEarnedDisplay() {
  $("game-earned-value").textContent = formatMMSS(gameEarnedSeconds);
}

async function cashOutGame() {
  const earned = gameEarnedSeconds;
  setGameImmersive(false);
  stopGame();

  if (earned < 60) {
    gamePanel.hidden = true;
    $("card").classList.remove("game-active");
    document.body.classList.remove("game-immersive");
    await leaveGameOverlay();
    return;
  }

  const minutes = Math.round(earned / 60);
  try {
    const granted = await invoke("redeem_earned_time", { minutes });
    gamePanel.hidden = true;
    $("card").classList.remove("game-active");
    document.body.classList.remove("game-immersive");
    if (granted > 0) {
      grantedPanel.hidden = false;
      $("granted-text").textContent =
        granted < minutes
          ? `${granted} minutt${granted === 1 ? "" : "er"} innvilget (dagens grense er nådd).`
          : `${granted} minutt${granted === 1 ? "" : "er"} innvilget — godt kjørt!`;
      setTimeout(async () => {
        // Frigi fullskjerm-hold etter bekreftelsen; synker til HUD ved gjenstående tid.
        await leaveSettingsUi();
        goToHudAfterGrant();
      }, 900);
    } else {
      await leaveGameOverlay();
    }
  } catch (err) {
    gameError.hidden = false;
    gameError.textContent = String(err);
  }
}

/** Etter spill uten ny tid: tilbake til HUD hvis det er tid igjen, ellers låseskjerm. */
async function leaveGameOverlay() {
  let remaining = 0;
  try {
    const status = await invoke("get_status");
    remaining = Number(status.remainingSeconds) || 0;
  } catch {
    /* forhåndsvisning */
  }

  if (hasTauri) {
    await leaveSettingsUi();
  }

  if (remaining > 0) {
    showHudView(remaining);
  } else {
    resetToDefaultActions();
  }
}

// ---------- Butikk og garasje ----------
// Runneren må bygges på nytt for at nye kart/lakk/oppgraderinger
// skal tre i kraft (den leser dem bare ved opprettelse).
function markShopDirty() {
  shopDirty = true;
  if (carRunner) {
    carRunner.dispose();
    carRunner = null;
  }
}

$("btn-open-shop").addEventListener("click", () => {
  openGarageFromGame();
});

$("btn-shop-back").addEventListener("click", async () => {
  if (garageScene) garageScene.setActive(false);
  shopPanel.hidden = true;
  $("card").classList.remove("shop-active");
  $("card").classList.add("game-active");
  gamePanel.hidden = false;
  hideGameOver();
  setGameImmersive(true);
  if (shopDirty) {
    shopDirty = false;
    if (carRunner) {
      carRunner.dispose();
      carRunner = null;
    }
    showModeSelect();
  } else if (lastRunEnded || !carRunner) {
    showModeSelect();
  } else if (carRunner) {
    carRunner.resume();
  }
});

// ---------- Fullskjerm 3D-garasje ----------
// 3D-scenen kommer fra garage-scene.js (delt med forhåndsvisningen).
let garageScene = null;
let garagePop = null; // hvilken popover som er åpen: "cars" | "paint" | "maps"

function effTurboLevel() {
  return Math.min(3, profile.upgrades.turbo + (getCar(profile.selectedCar).perk.turboBonus || 0));
}

function updateGaragePreview() {
  const paint = getPaint(profile.selectedPaint);
  const car = getCar(profile.selectedCar);
  const map = getMap(profile.selectedMap);
  if (!garageScene) garageScene = createGarageScene($("garage-3d-canvas"));
  garageScene.setCar({
    paint: paint.color,
    style: car.style,
    upgrades: profile.upgrades,
  });
  garageScene.setMapTint(map.theme);
  $("gf-val-car").textContent = car.name + " ›";
  $("gf-val-paint").style.background = "#" + paint.color.toString(16).padStart(6, "0");
  $("gf-val-map").textContent = map.name + " ›";
  $("gf-perk-text").textContent = Object.keys(car.perk).length
    ? car.description
    : `${car.name} har ingen spesialfordel — ennå.`;
}

function renderGarageStats() {
  const style = getCar(profile.selectedCar).style;
  const handling = { formel: 8, racer: 6, mini: 6, comet: 5, sport: 5, buggy: 4, muskel: 4, pickup: 3 }[style] ?? 5;
  const brakes = { mini: 7, formel: 6, comet: 6, sport: 5, racer: 5, buggy: 4, muskel: 4, pickup: 3 }[style] ?? 5;
  const rows = [
    ["⚡", "Hastighet", 2 + effTurboLevel() * 2],
    ["🚀", "Akselerasjon", 2 + Math.round(effTurboLevel() * 1.5)],
    ["🎯", "Håndtering", handling],
    ["🛑", "Bremser", brakes],
  ];
  const wrap = $("gf-stat-rows");
  wrap.textContent = "";
  for (const [ico, name, val] of rows) {
    const row = document.createElement("div");
    row.className = "gf-stat";
    const bars = Array.from({ length: 8 }, (_, i) =>
      `<i class="${i < val ? "on" : ""}"></i>`).join("");
    row.innerHTML = `<div class="gf-stat-row"><span class="ico">${ico}</span> ${name}</div><div class="gf-bars">${bars}</div>`;
    wrap.appendChild(row);
  }
}

// ---------- Oppgraderingskort ----------
const GARAGE_CARD_ICONS = { turbo: "🌀", magnet: "🧲", skjold: "🛡" };
const GARAGE_CARD_NAMES = { turbo: "MOTOR", magnet: "MAGNET", skjold: "SKJOLD" };
const GARAGE_SOON_CARDS = [["◎", "DEKK"], ["🧪", "NITRO"]];

function renderGarageCards() {
  const wrap = $("gf-cards");
  wrap.textContent = "";
  for (const up of UPGRADES) {
    const level = profile.upgrades[up.id] || 0;
    const maxed = level >= up.prices.length;
    const price = maxed ? null : up.prices[level];
    const card = document.createElement("div");
    card.className = "gf-card";
    card.innerHTML = `
      <h3>${GARAGE_CARD_NAMES[up.id] || up.name}</h3>
      <div class="big-ico">${GARAGE_CARD_ICONS[up.id] || "⚙"}</div>
      <div class="lvl">${maxed ? "MAKS NIVÅ" : "NIVÅ " + level}</div>`;
    const btn = document.createElement("button");
    btn.className = "buy" + (maxed ? " maxed" : "");
    btn.type = "button";
    btn.textContent = maxed ? "✓ Fullt" : `${price} ◆`;
    btn.disabled = !maxed && profile.coins < price;
    btn.addEventListener("click", () => {
      if (maxed || !purchase(profile, price)) return;
      profile.upgrades[up.id] = level + 1;
      saveProfile(profile);
      markShopDirty();
      renderGarage();
    });
    card.appendChild(btn);
    wrap.appendChild(card);
  }
  // Dekk og Nitro er ikke i spillet ennå
  for (const [ico, name] of GARAGE_SOON_CARDS) {
    const card = document.createElement("div");
    card.className = "gf-card soon";
    card.innerHTML = `
      <h3>${name}</h3>
      <div class="big-ico">${ico}</div>
      <div class="lvl">KOMMER SNART</div>`;
    const btn = document.createElement("button");
    btn.className = "buy";
    btn.type = "button";
    btn.disabled = true;
    btn.textContent = "Snart";
    card.appendChild(btn);
    wrap.appendChild(card);
  }
}

// ---------- Popovers (bil / lakk / bane) ----------
function renderGaragePopover(kind) {
  const pop = $("gf-pop");
  pop.textContent = "";
  if (kind === "cars" || kind === "maps") {
    const items = kind === "cars" ? CARS : MAPS;
    const ownedKey = kind === "cars" ? "ownedCars" : "ownedMaps";
    const selectedKey = kind === "cars" ? "selectedCar" : "selectedMap";
    pop.innerHTML = `<p class="gf-pop-title">${kind === "cars" ? "Velg bil" : "Velg bane"}</p>`;
    for (const item of items) {
      const owned = profile[ownedKey].includes(item.id);
      const selected = profile[selectedKey] === item.id;
      const afford = profile.coins >= item.price;
      const el = document.createElement("div");
      el.className = "gf-pop-item" + (selected ? " is-selected" : "") + (!owned && !afford ? " cant-afford" : "");
      const priceLabel = selected ? "Valgt" : owned ? "Velg" : `${item.price} ◆`;
      el.innerHTML = `
        <span class="nm">${item.name}</span>
        <span class="pr ${owned || selected ? "owned" : ""}">${priceLabel}</span>
        <span class="ds">${item.description}</span>`;
      el.addEventListener("click", () => {
        if (!owned) {
          if (!purchase(profile, item.price)) return;
          profile[ownedKey].push(item.id);
        }
        profile[selectedKey] = item.id;
        saveProfile(profile);
        markShopDirty();
        renderGarage();
        renderGaragePopover(kind);
      });
      pop.appendChild(el);
    }
  } else if (kind === "paint") {
    pop.innerHTML = `<p class="gf-pop-title">Velg lakk</p>`;
    const sw = document.createElement("div");
    sw.className = "gf-swatches";
    for (const p of PAINTS) {
      const owned = profile.ownedPaints.includes(p.id);
      const b = document.createElement("button");
      b.type = "button";
      b.title = owned ? p.name : `${p.name} — ${p.price} ◆`;
      b.className = "gf-swatch" + (p.id === profile.selectedPaint ? " is-selected" : "") + (owned ? "" : " locked");
      b.style.background = "#" + p.color.toString(16).padStart(6, "0");
      if (!owned) {
        const tag = document.createElement("span");
        tag.className = "price-tag";
        tag.textContent = p.price;
        b.appendChild(tag);
      }
      b.addEventListener("click", () => {
        if (!profile.ownedPaints.includes(p.id)) {
          if (!purchase(profile, p.price)) return;
          profile.ownedPaints.push(p.id);
        }
        profile.selectedPaint = p.id;
        saveProfile(profile);
        markShopDirty();
        renderGarage();
        renderGaragePopover("paint");
      });
      sw.appendChild(b);
    }
    pop.appendChild(sw);
  }
}

document.querySelectorAll(".gf-row").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.open;
    const pop = $("gf-pop");
    if (garagePop === kind) {
      pop.hidden = true;
      garagePop = null;
    } else {
      garagePop = kind;
      renderGaragePopover(kind);
      pop.hidden = false;
    }
  });
});

function renderGarage() {
  updateWalletDisplays();
  updateGaragePreview();
  renderGarageStats();
  renderGarageCards();
}

// START LØPET: ut av garasjen og til modusvalg (bygg runner på nytt ved behov)
$("btn-shop-start").addEventListener("click", () => {
  if (garageScene) garageScene.setActive(false);
  shopPanel.hidden = true;
  $("card").classList.remove("shop-active");
  $("card").classList.add("game-active");
  gamePanel.hidden = false;
  hideGameOver();
  setGameImmersive(true);
  if (shopDirty) {
    shopDirty = false;
    if (carRunner) {
      carRunner.dispose();
      carRunner = null;
    }
  }
  showModeSelect();
});

// ---------- Innstillinger ----------
const settingsGate = $("settings-gate");
const settingsPanel = $("settings-panel");
const settingsPinInput = $("settings-pin-input");
const settingsPinError = $("settings-pin-error");
let pendingSettingsPin = "";
let settingsTab = "time";
const SETTINGS_TABS = ["time", "pin", "windows", "about"];

function setSettingsTab(tab) {
  if (!SETTINGS_TABS.includes(tab)) tab = "time";
  settingsTab = tab;
  document.querySelectorAll(".settings-nav-item").forEach((btn) => {
    const active = btn.dataset.settingsTab === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".settings-pane").forEach((pane) => {
    pane.hidden = pane.id !== `settings-pane-${tab}`;
  });
}

document.querySelectorAll(".settings-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSettingsTab(btn.dataset.settingsTab);
  });
  btn.addEventListener("keydown", (e) => {
    const idx = SETTINGS_TABS.indexOf(btn.dataset.settingsTab);
    if (idx < 0) return;
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (idx + 1) % SETTINGS_TABS.length;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (idx - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = SETTINGS_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setSettingsTab(SETTINGS_TABS[next]);
    document.querySelector(`.settings-nav-item[data-settings-tab="${SETTINGS_TABS[next]}"]`)?.focus();
  });
});

async function requestOpenSettings() {
  if (document.body.classList.contains("setup-mode")) return;
  // Allerede inne i innstillingspanelet — ikke forstyrr.
  if (!settingsPanel.hidden) return;

  lockedView.hidden = false;
  hudView.hidden = true;
  document.body.classList.remove("mode-hud", "hud-urgent");

  $("game-panel").hidden = true;
  $("pin-panel").hidden = true;
  $("granted-panel").hidden = true;
  $("settings-panel").hidden = true;
  $("setup-panel").hidden = true;
  $("shop-panel").hidden = true;
  $("switch-menu").hidden = true;
  $("card").classList.remove("game-active", "shop-active", "setup-active");
  document.body.classList.remove("game-immersive");
  stopGame();

  if (hasTauri) {
    try {
      await invoke("begin_settings_ui");
    } catch {
      /* forhåndsvisning */
    }
  }

  actionsDefault.hidden = true;
  settingsGate.hidden = false;
  settingsPinError.hidden = true;
  settingsPinInput.value = "";
  $("card").classList.add("settings-active");
  settingsPinInput.focus();
}

async function leaveSettingsUi() {
  if (!hasTauri) return;
  try {
    await invoke("end_settings_ui");
  } catch {
    /* forhåndsvisning */
  }
}

$("btn-settings").addEventListener("click", () => {
  requestOpenSettings();
});

$("btn-settings-gate-cancel").addEventListener("click", async () => {
  settingsGate.hidden = true;
  actionsDefault.hidden = false;
  $("card").classList.remove("settings-active");
  await leaveSettingsUi();
});

$("btn-settings-pin-confirm").addEventListener("click", submitSettingsPin);
settingsPinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSettingsPin();
});

async function submitSettingsPin() {
  const pin = settingsPinInput.value.trim();
  if (!pin) return;
  try {
    const ok = await invoke("verify_pin", { pin });
    if (!ok) throw "Feil PIN-kode";
    pendingSettingsPin = pin;
    settingsGate.hidden = true;
    await openSettingsPanel();
  } catch {
    settingsPinError.hidden = false;
    settingsPinInput.value = "";
  }
}

async function openSettingsPanel() {
  const settings = await invoke("get_settings_public");
  $("set-unlock-time").value = settings.unlockTime;
  $("set-grant-minutes").value = settings.grantMinutes;
  $("set-reward-scale").value = clampRewardScale(
    settings.rewardScale ?? ((settings.secondsPerHit ?? 20) / 20)
  );
  $("set-max-earn").value = settings.maxEarnMinutesPerDay;
  $("set-new-pin").value = "";
  $("set-confirm-pin").value = "";
  $("set-autostart").checked = Boolean(settings.autostart);
  applyHudHotkeyLabel(settings.hudHotkey);
  $("settings-save-error").hidden = true;
  $("settings-save-ok").hidden = true;
  setSettingsTab("time");
  settingsPanel.hidden = false;
  $("card").classList.add("settings-active");
  await refreshUpdateStatus();
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function applyUpdateProgress(payload) {
  const downloaded = Number(payload?.downloaded) || 0;
  const total = payload?.total == null ? null : Number(payload.total);
  const progress = $("settings-update-progress");
  const fill = $("settings-update-progress-fill");
  const label = $("settings-update-progress-label");
  progress.hidden = false;
  if (total && total > 0) {
    const pct = Math.min(100, Math.round((downloaded / total) * 100));
    fill.style.width = `${pct}%`;
    label.textContent = `Laster ned… ${formatBytes(downloaded)} / ${formatBytes(total)} (${pct} %)`;
  } else {
    fill.style.width = "15%";
    label.textContent = `Laster ned… ${formatBytes(downloaded)}`;
  }
}

function applyUpdateStatus(status) {
  if (!status) return;
  const versionEl = $("settings-current-version");
  const statusEl = $("settings-update-status");
  const notesWrap = $("settings-update-notes");
  const notesTitle = $("settings-update-notes-title");
  const notesBody = $("settings-update-notes-body");
  const progress = $("settings-update-progress");
  const checkBtn = $("btn-check-update");
  const installBtn = $("btn-install-update");

  versionEl.textContent = `Versjon ${status.currentVersion || "—"}`;

  if (status.installing) {
    statusEl.textContent = "Laster ned og installerer oppdatering…";
    applyUpdateProgress({ downloaded: status.downloaded, total: status.total });
  } else {
    progress.hidden = true;
    $("settings-update-progress-fill").style.width = "0%";
  }

  if (status.checking) {
    statusEl.textContent = "Sjekker etter oppdateringer…";
  } else if (status.error && !status.available) {
    statusEl.textContent = `Kunne ikke sjekke: ${status.error}`;
  } else if (status.available && status.latestVersion) {
    statusEl.textContent = `Ny versjon tilgjengelig: ${status.latestVersion}`;
  } else if (status.lastCheckedAt) {
    statusEl.textContent = "Du har nyeste versjon.";
  } else {
    statusEl.textContent = "Trykk «Se etter oppdatering» for å sjekke.";
  }

  if (status.available && status.notes) {
    notesWrap.hidden = false;
    notesTitle.textContent = `Hva er nytt i ${status.latestVersion || "ny versjon"}`;
    notesBody.textContent = String(status.notes).trim();
  } else {
    notesWrap.hidden = true;
    notesBody.textContent = "";
  }

  checkBtn.disabled = Boolean(status.checking || status.installing);
  installBtn.hidden = !status.available;
  installBtn.disabled = Boolean(status.checking || status.installing);
}

async function refreshUpdateStatus() {
  try {
    const status = await invoke("get_update_status");
    applyUpdateStatus(status);
  } catch (err) {
    $("settings-current-version").textContent = "Versjon —";
    $("settings-update-status").textContent = String(err);
  }
}

$("btn-check-update").addEventListener("click", async () => {
  $("btn-check-update").disabled = true;
  $("settings-update-status").textContent = "Sjekker etter oppdateringer…";
  try {
    const status = await invoke("check_for_update");
    applyUpdateStatus(status);
  } catch (err) {
    $("settings-update-status").textContent = String(err);
    $("btn-check-update").disabled = false;
  }
});

$("btn-install-update").addEventListener("click", async () => {
  $("btn-install-update").disabled = true;
  $("btn-check-update").disabled = true;
  applyUpdateProgress({ downloaded: 0, total: null });
  $("settings-update-status").textContent = "Laster ned og installerer oppdatering…";
  if (!hasTauri) {
    window.__mockUpdateProgress = (payload) => applyUpdateProgress(payload);
  }
  try {
    await invoke("install_update");
    if (!hasTauri) {
      applyUpdateStatus(await invoke("get_update_status"));
      $("settings-update-status").textContent =
        "Oppdatering installert (forhåndsvisning — appen starter ikke på nytt).";
    }
  } catch (err) {
    $("settings-update-status").textContent = String(err);
    $("btn-check-update").disabled = false;
    await refreshUpdateStatus();
  } finally {
    if (!hasTauri) delete window.__mockUpdateProgress;
  }
});

$("btn-settings-cancel").addEventListener("click", async () => {
  settingsPanel.hidden = true;
  pendingSettingsPin = "";
  resetToDefaultActions();
  await leaveSettingsUi();
});

$("btn-settings-nav-close").addEventListener("click", () => {
  $("btn-settings-cancel").click();
});

const hudHotkeyInput = $("set-hud-hotkey");
let hudHotkeyCapturing = false;
let hudHotkeyCommitted = false;

function isCompleteHotkey(value) {
  if (!value || !value.includes("+")) return false;
  const last = value.split("+").pop();
  return Boolean(last) && !["Ctrl", "Shift", "Alt"].includes(last);
}

async function startHudHotkeyCapture() {
  hudHotkeyCapturing = true;
  hudHotkeyCommitted = false;
  if (hasTauri) {
    try {
      await invoke("begin_hud_hotkey_capture");
      // Gi hotkey-tråden tid til å avregistrere (poller ~50 ms)
      await new Promise((r) => setTimeout(r, 60));
    } catch {
      /* forhåndsvisning */
    }
  }
}

async function stopHudHotkeyCapture() {
  hudHotkeyCapturing = false;
  if (hasTauri) {
    try {
      await invoke("end_hud_hotkey_capture");
    } catch {
      /* forhåndsvisning */
    }
  }
}

hudHotkeyInput.addEventListener("focus", () => {
  hudHotkeyInput.dataset.prev = hudHotkeyInput.value;
  hudHotkeyInput.value = "";
  hudHotkeyInput.placeholder = "Trykk kombinasjon…";
  startHudHotkeyCapture();
});
hudHotkeyInput.addEventListener("blur", () => {
  stopHudHotkeyCapture();
  if (!hudHotkeyCommitted && !isCompleteHotkey(hudHotkeyInput.value)) {
    hudHotkeyInput.value = hudHotkeyInput.dataset.prev || currentHudHotkey;
  }
  hudHotkeyInput.placeholder = "Klikk og trykk en kombinasjon";
});
hudHotkeyInput.addEventListener("keydown", (e) => {
  if (document.activeElement !== hudHotkeyInput) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") {
    hudHotkeyCommitted = false;
    hudHotkeyInput.value = hudHotkeyInput.dataset.prev || currentHudHotkey;
    hudHotkeyInput.blur();
    return;
  }
  if (e.repeat) return;

  const isModifierOnly = ["Control", "Shift", "Alt", "Meta", "OS"].includes(e.key);
  if (isModifierOnly) {
    const preview = formatHotkeyFromEvent(e, { allowModifiersOnly: true });
    if (preview !== null) hudHotkeyInput.value = preview;
    return;
  }

  const combo = formatHotkeyFromEvent(e);
  if (!combo) return;
  hudHotkeyCommitted = true;
  hudHotkeyInput.value = combo;
  hudHotkeyInput.blur();
});
hudHotkeyInput.addEventListener("keyup", (e) => {
  if (document.activeElement !== hudHotkeyInput || hudHotkeyCommitted) return;
  if (!["Control", "Shift", "Alt", "Meta", "OS"].includes(e.key)) return;
  const preview = formatHotkeyFromEvent(e, { allowModifiersOnly: true });
  if (preview !== null) hudHotkeyInput.value = preview;
});

$("btn-settings-save").addEventListener("click", async () => {
  const saveError = $("settings-save-error");
  const saveOk = $("settings-save-ok");
  saveError.hidden = true;
  saveOk.hidden = true;

  const unlockTime = $("set-unlock-time").value.trim() || "07:00";
  const grantMinutes = Math.max(1, parseInt($("set-grant-minutes").value, 10) || 1);
  const rewardScaleVal = clampRewardScale($("set-reward-scale").value);
  const maxEarn = Math.max(0, parseInt($("set-max-earn").value, 10) || 0);
  const newPin = $("set-new-pin").value.trim();
  const confirmPin = $("set-confirm-pin").value.trim();
  const autostart = $("set-autostart").checked;
  const hudHotkey = $("set-hud-hotkey").value.trim() || "Ctrl+Shift+H";

  if (newPin || confirmPin) {
    if (newPin !== confirmPin) {
      saveError.hidden = false;
      saveError.textContent = "PIN-kodene er ikke like. Prøv igjen.";
      return;
    }
    if (newPin.length < 4 || newPin.length > 8) {
      saveError.hidden = false;
      saveError.textContent = "PIN-koden må være mellom 4 og 8 tegn.";
      return;
    }
    if (!/^\d+$/.test(newPin)) {
      saveError.hidden = false;
      saveError.textContent = "PIN-koden kan bare inneholde tall.";
      return;
    }
  }

  try {
    await invoke("update_settings", {
      currentPin: pendingSettingsPin,
      newPin: newPin ? newPin : null,
      unlockTime,
      grantMinutes,
      rewardScale: rewardScaleVal,
      maxEarnMinutesPerDay: maxEarn,
      autostart,
      hudHotkey,
    });
    rewardScale = rewardScaleVal;
    if (carRunner) carRunner.setRewardScale(rewardScale);
    $("unlock-time").textContent = unlockTime;
    applyHudHotkeyLabel(hudHotkey);
    if (newPin) {
      pendingSettingsPin = newPin;
      if (!hasTauri) mock.pin = newPin;
    }
    $("set-new-pin").value = "";
    $("set-confirm-pin").value = "";
    saveOk.hidden = false;
    saveOk.textContent = newPin
      ? "Lagret. Ny PIN-kode er aktiv."
      : "Lagret.";
  } catch (err) {
    saveError.hidden = false;
    saveError.textContent = String(err);
  }
});

// Belønningsskala: live hint i oppsett og innstillinger
syncRewardScaleHint("setup-reward-scale", "setup-reward-scale-hint");
syncRewardScaleHint("set-reward-scale", "set-reward-scale-hint");
