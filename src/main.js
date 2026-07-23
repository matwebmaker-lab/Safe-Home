// Bruker Tauris invoke når appen kjører i Tauri, ellers en enkel
// simulering — slik at frontend kan forhåndsvises i nettleser via
// `npm run preview` uten at Rust/Tauri må bygges først.
// (OBS: siden main.js nå er en ES-modul, må forhåndsvisning skje via
// HTTP-server — å dobbeltklikke index.html direkte fungerer ikke.)
import { createCarRunner } from "./game/car-runner.js";
import { loadProfile, saveProfile, addCoins, purchase } from "./game/profile.js";
import { UPGRADES, PAINTS, MAPS, getPaint, getMap } from "./game/shop-data.js";

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
  // HUD-modus faktisk bare er 250×64px stort.
  document.body.classList.add("preview");
}

// ---------- Enkel simulering for forhåndsvisning i nettleser ----------
const mock = {
  unlockTime: "07:00",
  grantMinutes: 30,
  secondsPerHit: 20,
  maxEarnMinutesPerDay: 90,
  autostart: false,
  earnedToday: 0,
  pin: "1234",
  remainingSeconds: 0,
  tickHandle: null,
};

async function mockInvoke(cmd, args) {
  await new Promise((r) => setTimeout(r, 150));

  switch (cmd) {
    case "get_settings_public":
      return {
        unlockTime: mock.unlockTime,
        grantMinutes: mock.grantMinutes,
        secondsPerHit: mock.secondsPerHit,
        maxEarnMinutesPerDay: mock.maxEarnMinutesPerDay,
        autostart: mock.autostart,
      };
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
      mock.secondsPerHit = args.secondsPerHit;
      mock.maxEarnMinutesPerDay = args.maxEarnMinutesPerDay;
      mock.autostart = Boolean(args.autostart);
      return null;
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
  e.preventDefault();
  try {
    await window.__TAURI__.window.getCurrentWindow().startDragging();
  } catch (err) {
    console.error("Klarte ikke å starte dragging:", err);
  }
});

function resetToDefaultActions() {
  $("actions-default").hidden = false;
  $("game-panel").hidden = true;
  $("pin-panel").hidden = true;
  $("granted-panel").hidden = true;
  $("settings-gate").hidden = true;
  $("settings-panel").hidden = true;
  $("shop-panel").hidden = true;
  $("switch-menu").hidden = true;
  $("card").classList.remove("game-active");
  $("card").classList.remove("shop-active");
  $("card").classList.remove("settings-active");
  document.body.classList.remove("game-immersive");
  stopGame();
}

// ---------- Oppstart ----------
async function init() {
  try {
    const settings = await invoke("get_settings_public");
    $("unlock-time").textContent = settings.unlockTime;
    secondsPerHit = settings.secondsPerHit;
  } catch (err) {
    console.error("Klarte ikke å hente innstillinger:", err);
  }

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

  if (hasTauri) {
    const { listen } = window.__TAURI__.event;
    listen("time-tick", (event) => {
      if (!hudView.hidden) updateHud(event.payload);
    });
    listen("locked", () => {
      showLockedView();
    });
    listen("unlocked", (event) => {
      const remaining = Number(event.payload) || 0;
      if (remaining > 0) showHudView(remaining);
    });
    listen("hud-peek", (event) => {
      const remaining = Number(event.payload) || 0;
      if (remaining > 0) showHudView(remaining);
    });
  }
}
init();

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
let secondsPerHit = 20; // = sekunder per mynt (samme config-felt som før)
let carRunner = null;
let gameEarnedSeconds = 0;

// Vedvarende spillerprofil: lommebok, oppgraderinger, lakk og kart
let profile = loadProfile();
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

$("btn-earn-time").addEventListener("click", async () => {
  actionsDefault.hidden = true;
  gamePanel.hidden = false;
  gameError.hidden = true;
  $("card").classList.add("game-active");
  setGameImmersive(true);
  await refreshGameBudgetLabel();
  await startGame();
});

$("btn-game-cash-out").addEventListener("click", cashOutGame);
$("btn-game-retry").addEventListener("click", () => {
  retryGame();
});

$("btn-game-fullscreen").addEventListener("click", () => {
  setGameImmersive(!document.body.classList.contains("game-immersive"));
});

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
    carRunner.setSecondsPerCoin(secondsPerHit);
    return carRunner;
  }
  try {
    // Send alltid ferske profil-verdier (lakk, kart og oppgraderinger)
    carRunner = createCarRunner($("car-game-canvas"), {
      secondsPerCoin: secondsPerHit,
      paint: getPaint(profile.selectedPaint).color,
      upgrades: { ...profile.upgrades },
      theme: getMap(profile.selectedMap).theme,
      onEarn: (seconds) => {
        gameEarnedSeconds += seconds;
        updateGameEarnedDisplay();
      },
      onComboBreak: () => {},
      onStatsUpdate: updateGameStatsHud,
      onCoinCollect: () => {
        // Hver mynt går i lommeboka (i tillegg til opptjent tid)
        addCoins(profile, 1);
        saveProfile(profile);
        updateWalletDisplays();
      },
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
        // Skjoldet ble brukt opp i spillet — fjern det fra profilen
        profile.upgrades.skjold = 0;
        saveProfile(profile);
      },
      onGameOver: ({ reason }) => {
        showGameOver(reason);
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

function showGameOver(reason) {
  const titles = {
    wrong: "Feil svar — ute!",
    miss: "Du kjørte forbi — ute!",
    crash: "Krasj — ute!",
  };
  const descs = {
    wrong: "Kjør gjennom porten med riktig svar neste gang.",
    miss: "Du må velge én av de fire svarene på veien.",
    crash: "Unngå bilene på motorveien mens du kjører.",
  };
  $("car-game-over-title").textContent = titles[reason] || "Runden er over";
  $("car-game-over-desc").textContent =
    descs[reason] || "Prøv igjen, eller bruk tiden du har opptjent.";
  $("car-game-over").hidden = false;
}

async function startGame() {
  hideGameOver();
  gameEarnedSeconds = 0;
  updateGameEarnedDisplay();
  const runner = await ensureCarRunner();
  runner.start();
}

async function retryGame() {
  hideGameOver();
  // Behold opptjent tid fra tidligere runder i samme økt
  const runner = await ensureCarRunner();
  runner.start();
}

function stopGame() {
  hideGameOver();
  if (carRunner) carRunner.stop();
  gameEarnedSeconds = 0;
}

function updateGameEarnedDisplay() {
  $("game-earned-value").textContent = formatMMSS(gameEarnedSeconds);
}

async function cashOutGame() {
  const earned = gameEarnedSeconds;
  setGameImmersive(false);
  stopGame();

  if (earned < 60) {
    resetToDefaultActions();
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
      setTimeout(() => {
        goToHudAfterGrant();
      }, 900);
    } else {
      resetToDefaultActions();
    }
  } catch (err) {
    gameError.hidden = false;
    gameError.textContent = String(err);
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
  if (carRunner) carRunner.pause(); // spillet fortsetter der det slapp
  setGameImmersive(false);
  gamePanel.hidden = true;
  $("card").classList.remove("game-active");
  $("card").classList.add("shop-active");
  setGarageTab("parts");
  renderShop();
  shopPanel.hidden = false;
});

$("btn-shop-back").addEventListener("click", async () => {
  shopPanel.hidden = true;
  $("card").classList.remove("shop-active");
  $("card").classList.add("game-active");
  gamePanel.hidden = false;
  hideGameOver();
  setGameImmersive(true);
  if (shopDirty) {
    // Noe ble kjøpt eller byttet: bygg runneren på nytt og start runden
    // på nytt — opptjent tid (gameEarnedSeconds) beholdes.
    shopDirty = false;
    const runner = await ensureCarRunner();
    runner.start();
  } else if (carRunner) {
    carRunner.resume();
  }
});

let garageTab = "parts";

function setGarageTab(tab) {
  garageTab = tab;
  document.querySelectorAll(".garage-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  $("shop-upgrades").hidden = tab !== "parts";
  $("shop-paints").hidden = tab !== "paint";
  $("shop-maps").hidden = tab !== "maps";
}

document.querySelectorAll(".garage-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    setGarageTab(btn.dataset.tab);
  });
});

function updateGaragePreview() {
  const paint = getPaint(profile.selectedPaint);
  const map = getMap(profile.selectedMap);
  const body = $("garage-car-body");
  if (body) {
    body.setAttribute("fill", "#" + paint.color.toString(16).padStart(6, "0"));
  }
  $("garage-car-label").textContent = `${paint.name} · ${map.name}`;
}

function renderShop() {
  updateWalletDisplays();
  updateGaragePreview();
  renderShopUpgrades();
  renderShopPaints();
  renderShopMaps();
}

function makeActionBtn(label, opts = {}) {
  const btn = document.createElement("button");
  btn.className = opts.outline ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm";
  btn.textContent = label;
  btn.disabled = !!opts.disabled;
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}

function renderShopUpgrades() {
  const wrap = $("shop-upgrades");
  wrap.textContent = "";
  wrap.className = "garage-shelf";
  const icons = { turbo: "T", magnet: "M", skjold: "S" };
  for (const up of UPGRADES) {
    const level = profile.upgrades[up.id] || 0;
    const maxed = level >= up.prices.length;
    const multiLevel = up.prices.length > 1;
    const item = document.createElement("div");
    item.className = "garage-item";
    if (level > 0) item.classList.add("is-selected");

    const icon = document.createElement("div");
    icon.className = "garage-item-icon";
    icon.textContent = icons[up.id] || "•";

    const text = document.createElement("div");
    text.className = "garage-item-text";
    const name = document.createElement("p");
    name.className = "garage-item-name";
    name.textContent = multiLevel
      ? `${up.name}  ·  ${level}/${up.prices.length}`
      : up.name;
    const desc = document.createElement("p");
    desc.className = "garage-item-desc";
    desc.textContent = up.description;
    text.append(name, desc);

    let btn;
    if (maxed) {
      btn = makeActionBtn(multiLevel ? "Maks" : "Montert", { outline: true, disabled: true });
    } else {
      const price = up.prices[level];
      btn = makeActionBtn(`${price} ◆`, {
        disabled: profile.coins < price,
        onClick: () => {
          if (!purchase(profile, price)) return;
          profile.upgrades[up.id] = level + 1;
          saveProfile(profile);
          markShopDirty();
          renderShop();
        },
      });
    }
    item.append(icon, text, btn);
    wrap.appendChild(item);
  }
}

function renderShopPaints() {
  const wrap = $("shop-paints");
  wrap.textContent = "";
  wrap.className = "garage-shelf garage-paints";
  for (const paint of PAINTS) {
    const owned = profile.ownedPaints.includes(paint.id);
    const selected = profile.selectedPaint === paint.id;
    const card = document.createElement("div");
    card.className = "garage-paint" + (selected ? " is-selected" : "");

    const swatch = document.createElement("div");
    swatch.className = "garage-paint-swatch";
    swatch.style.background = "#" + paint.color.toString(16).padStart(6, "0");

    const name = document.createElement("p");
    name.className = "garage-paint-name";
    name.textContent = paint.name;

    let btn;
    if (selected) {
      btn = makeActionBtn("På", { outline: true, disabled: true });
    } else if (owned) {
      btn = makeActionBtn("Velg", {
        onClick: () => {
          profile.selectedPaint = paint.id;
          saveProfile(profile);
          markShopDirty();
          renderShop();
        },
      });
    } else {
      btn = makeActionBtn(`${paint.price} ◆`, {
        disabled: profile.coins < paint.price,
        onClick: () => {
          if (!purchase(profile, paint.price)) return;
          profile.ownedPaints.push(paint.id);
          profile.selectedPaint = paint.id;
          saveProfile(profile);
          markShopDirty();
          renderShop();
        },
      });
    }
    card.append(swatch, name, btn);
    wrap.appendChild(card);
  }
}

function mapPreviewGradient(map) {
  const stops = map.theme?.skyStops || [];
  if (stops.length < 2) return "linear-gradient(90deg, #1a2822, #38e6ac)";
  const mid = stops[Math.floor(stops.length / 2)][1];
  const end = stops[stops.length - 1][1];
  return `linear-gradient(110deg, ${stops[0][1]}, ${mid}, ${end})`;
}

function renderShopMaps() {
  const wrap = $("shop-maps");
  wrap.textContent = "";
  wrap.className = "garage-shelf garage-maps";
  for (const map of MAPS) {
    const owned = profile.ownedMaps.includes(map.id);
    const selected = profile.selectedMap === map.id;
    const card = document.createElement("div");
    card.className = "garage-map" + (selected ? " is-selected" : "");

    const preview = document.createElement("div");
    preview.className = "garage-map-preview";
    preview.style.background = mapPreviewGradient(map);

    const name = document.createElement("p");
    name.className = "garage-item-name";
    name.textContent = map.name;

    const desc = document.createElement("p");
    desc.className = "garage-item-desc";
    desc.textContent = map.description;

    let btn;
    if (selected) {
      btn = makeActionBtn("Kjører her", { outline: true, disabled: true });
    } else if (owned) {
      btn = makeActionBtn("Velg", {
        onClick: () => {
          profile.selectedMap = map.id;
          saveProfile(profile);
          markShopDirty();
          renderShop();
        },
      });
    } else {
      btn = makeActionBtn(`${map.price} ◆`, {
        disabled: profile.coins < map.price,
        onClick: () => {
          if (!purchase(profile, map.price)) return;
          profile.ownedMaps.push(map.id);
          profile.selectedMap = map.id;
          saveProfile(profile);
          markShopDirty();
          renderShop();
        },
      });
    }
    card.append(preview, name, desc, btn);
    wrap.appendChild(card);
  }
}

// ---------- Innstillinger ----------
const settingsGate = $("settings-gate");
const settingsPanel = $("settings-panel");
const settingsPinInput = $("settings-pin-input");
const settingsPinError = $("settings-pin-error");
let pendingSettingsPin = "";

$("btn-settings").addEventListener("click", async () => {
  if (hasTauri) {
    try {
      await invoke("ensure_locked_fullscreen");
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
});

$("btn-settings-gate-cancel").addEventListener("click", () => {
  settingsGate.hidden = true;
  actionsDefault.hidden = false;
  $("card").classList.remove("settings-active");
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
  $("set-seconds-per-hit").value = settings.secondsPerHit;
  $("set-max-earn").value = settings.maxEarnMinutesPerDay;
  $("set-new-pin").value = "";
  $("set-confirm-pin").value = "";
  $("set-autostart").checked = Boolean(settings.autostart);
  $("settings-save-error").hidden = true;
  $("settings-save-ok").hidden = true;
  settingsPanel.hidden = false;
  $("card").classList.add("settings-active");
}

$("btn-settings-cancel").addEventListener("click", () => {
  settingsPanel.hidden = true;
  pendingSettingsPin = "";
  resetToDefaultActions();
});

$("btn-settings-save").addEventListener("click", async () => {
  const saveError = $("settings-save-error");
  const saveOk = $("settings-save-ok");
  saveError.hidden = true;
  saveOk.hidden = true;

  const unlockTime = $("set-unlock-time").value.trim() || "07:00";
  const grantMinutes = Math.max(1, parseInt($("set-grant-minutes").value, 10) || 1);
  const secondsPerHitVal = Math.max(1, parseInt($("set-seconds-per-hit").value, 10) || 1);
  const maxEarn = Math.max(0, parseInt($("set-max-earn").value, 10) || 0);
  const newPin = $("set-new-pin").value.trim();
  const confirmPin = $("set-confirm-pin").value.trim();
  const autostart = $("set-autostart").checked;

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
      secondsPerHit: secondsPerHitVal,
      maxEarnMinutesPerDay: maxEarn,
      autostart,
    });
    secondsPerHit = secondsPerHitVal;
    $("unlock-time").textContent = unlockTime;
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
