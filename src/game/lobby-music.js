// =====================================================================
// Lobby-musikk for garasjen — generert med WebAudio, ingen lydfiler.
// Rolig synthwave-loop i A-moll (Am–F–C–G), ~92 BPM:
// myk bass, detunede pad-kord, arpeggio og lette trommer.
//
// Bruk:
//   const music = createLobbyMusic();
//   music.start();          // krever bruker-geste (klikk) første gang
//   music.stop();           // falmer ut
//   music.toggle();         // -> true hvis den spiller
// =====================================================================

const BPM = 92;
const EIGHTH = 60 / BPM / 2; // sekunder per åttedelsnote

// Akkordene: [grunn-tone (halvtoner fra A2=110 Hz), kordtoner]
const CHORDS = [
  [0, [0, 3, 7]],    // Am
  [-4, [-4, 0, 3]],  // F
  [3, [3, 7, 10]],   // C
  [-2, [-2, 2, 5]],  // G
];
const ARP_PATTERN = [0, 1, 2, 1, 3, 1, 2, 1]; // indekser i kordtoner (+oktav)

function freq(semitonesFromA2) {
  return 110 * Math.pow(2, semitonesFromA2 / 12);
}

export function createLobbyMusic() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let playing = false;

  function buildContext() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    // Litt varme: enkel lowpass på master
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    master.connect(filter);
    filter.connect(ctx.destination);
    // Støy-buffer til hi-hat
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // Myk kick: sinus som faller i tonehøyde
  function kick(t, vol = 0.5) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  // Hi-hat: kort filtrert støy
  function hat(t, vol = 0.05) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + 0.06);
  }

  // Bass: rolig triangle
  function bass(t, semis, dur, vol = 0.16) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq(semis - 12);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.setTargetAtTime(0, t + dur * 0.6, 0.06);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.3);
  }

  // Pad: to detunede sagtenner gjennom lowpass, langsom åpning
  function pad(t, semisList, dur, vol = 0.045) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 750;
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0, t);
    padGain.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    padGain.gain.setValueAtTime(vol, t + dur * 0.75);
    padGain.gain.linearRampToValueAtTime(0, t + dur);
    filter.connect(padGain);
    padGain.connect(master);
    for (const s of semisList) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq(s + 12);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + dur + 0.1);
      }
    }
  }

  // Arpeggio-plukk: kort triangle med rask decay
  function pluck(t, semis, vol = 0.05) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq(semis + 12);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  function scheduleStep(s, t) {
    const bar = Math.floor(s / 8) % CHORDS.length;
    const inBar = s % 8;
    const [root, tones] = CHORDS[bar];

    if (inBar % 4 === 0) kick(t);            // 1 og 3
    if (inBar % 2 === 1) hat(t);             // offbeats
    if (inBar === 0) {
      bass(t, root, EIGHTH * 3);
      pad(t, tones, EIGHTH * 8);             // hel takt pad
    }
    if (inBar === 5) bass(t, root, EIGHTH * 2, 0.12);
    const arpIdx = ARP_PATTERN[inBar];
    const arpSemis = arpIdx < tones.length ? tones[arpIdx] : root + 12;
    pluck(t, arpSemis);
  }

  function tick() {
    // Planlegg ~120 ms frem i tid
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextTime);
      nextTime += EIGHTH;
      step++;
    }
  }

  return {
    get playing() { return playing; },
    start() {
      if (playing) return;
      if (!ctx) buildContext();
      ctx.resume();
      playing = true;
      step = 0;
      nextTime = ctx.currentTime + 0.06;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.2); // falm inn
      timer = setInterval(tick, 40);
    },
    stop() {
      if (!playing) return;
      playing = false;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6); // falm ut
      setTimeout(() => {
        if (!playing) {
          clearInterval(timer);
          timer = null;
        }
      }, 700);
    },
    toggle() {
      if (playing) this.stop();
      else this.start();
      return playing;
    },
  };
}
