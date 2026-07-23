# Safe Home (Tauri)

En egen erstatning for Windows' innebygde Family Safety-skjermtidslås
("Time's up!"), bygget i Tauri med design hentet fra ZeBeyond-referansen
(mørk bakgrunn, rutenett, grønt glød, mint/cyan-gradient-knapp).

Ved første oppstart må en voksen konfigurere PIN-kode, sekunder per
mattestykke og øvrige skjermtidsinnstillinger. Alt+F4 og Start-menyen
blokkeres mens låseskjermen er synlig.

## Funksjoner

- **Bytt bruker eller slå av PC** — original-knappen, åpner en liten meny
  med "Bytt bruker" (låser arbeidsstasjonen) og "Slå av PC" (slår av
  maskinen umiddelbart).
- **Få mer tid** — en voksen taster inn PIN-koden sin for å innvilge
  ekstra tid i dag.
- **Kjør for å tjene tid** — den som bruker enheten kan spille et 3D
  bilspill (endless runner bygget med Three.js) for å tjene tid selv,
  med realistisk nattekjøring-grafikk: ekte bilsilhuett med blank lakk,
  vinduer, front- og baklykter (frontlysene lyser faktisk opp veien),
  prosedyrell asfalt, autovern, gatelys, trær, gradient-himmel med
  stjerner, skygger og stripede trafikksperringer,
  uten å måtte spørre en voksen: kjør fremover, bytt fil med piltastene
  (eller A/D, eller sveip på touch), samle mynter og unngå de røde
  hindringene. Hver mynt gir sekunder (standard 20, justerbart), og en
  rekke på 5+ mynter uten krasj gir +25 % bonus, 10+ gir +50 %. Krasj
  koster ingen opptjent tid — bare rekka nullstilles og bilen bremses
  et øyeblikk. Når de synes de har tjent nok (minst 60 sekunder),
  trykker de «Ferdig – bruk tiden». Daglig opptjeningsgrense: standard
  90 min/dag, endres i innstillingene — 0 betyr ingen grense.
  Spillet har også matteoppgaver, butikk, biloppgraderinger og flere
  kart — se egen seksjon under.
- **Boks i hjørnet** (nytt) — når enheten er låst opp (enten via voksen-PIN
  eller opptjent tid), krymper vinduet til en liten flytende boks øverst
  til høyre som viser gjenstående tid live. Når tiden er ute, vokser
  vinduet automatisk tilbake til full låseskjerm.
- **Innstillinger** (nytt) — tannhjulet øverst til høyre er PIN-beskyttet
  og lar en voksen endre: PIN-kode, teksten for opplåsingstidspunkt,
  hvor mange minutter «Få mer tid» gir, hvor mange sekunder hvert treff i
  spillet er verdt, og den daglige opptjeningsgrensen.

Standard-PIN er **1234** — bytt den i innstillingspanelet
i appen når som helst.

## Nytt i bilspillet: matte, butikk, oppgraderinger og kart

Bilspillet er utvidet med fire nye systemer. Alt er ren frontend
(ingen endringer i Rust-backenden), og alt innhold er fortsatt 100 %
prosedyrelt — ingen eksterne modeller eller teksturfiler.

### Matteoppgaver (gange)

Hver 7. bølge (`QUESTION_EVERY` i `car-runner.js`) blir en oppgaverunde
i stedet for en vanlig bølge:

- Det genereres en gangoppgave `a × b` der begge faktorer er 1–10
  (f.eks. «3 × 5 = ?»). Selve oppgaven vises i et banner øverst i
  spill-HUD-en (`#car-hud-question`) via callback-en `onQuestion`.
- Tre skilt-porter spawnes — ett per kjørefelt — med tall tegnet på
  `CanvasTexture` (samme teknikk som asfalt-/stripeteksturene).
  Ett skilt har riktig svar, de to andre har plausible feilsvar
  (`a·(b±1)`, `(a±1)·b`, `±a`, `±b` osv. — alltid unike og positive).
- Kjører bilen i riktig skilt: +3 bonusmynter og rekka øker, med grønt
  glimt på bilen. Feil skilt: rekka nullstilles og bilen bremses
  (samme slowdown-mekanisme som hindringer), med rødt glimt.
- Skilt-teksturene caches per tall for å unngå gjentatt
  tekstur-oppbygging i lange økter.

### Lommebok og lagring (`src/game/profile.js`)

- Mynter gir fortsatt skjermtid akkurat som før, men hver mynt legges
  også i en **vedvarende lommebok** som brukes i butikken.
- Profilen lagres i `localStorage` under nøkkelen
  `safe-home-car-profile` (fungerer både i Tauri-webview og
  nettleser-forhåndsvisning) og inneholder: `coins`, `upgrades`
  (nivå per id), `ownedPaints`, `ownedMaps`, `selectedPaint`,
  `selectedMap`.
- API: `loadProfile()`, `saveProfile()`, `addCoins(profile, n)`,
  `purchase(profile, price)` (trekker prisen ved råd, returnerer
  true/false). Korrupt/manglende lagring faller tilbake til
  standardprofil.

### Butikk og garasje (`src/game/shop-data.js` + `#shop-panel`)

Ny knapp «Butikk og garasje» i spillpanelet åpner en butikk med tre
seksjoner (rendres dynamisk fra `main.js`):

- **Oppgraderinger** (nivåbaserte):
  - `turbo` Turbo-motor — 3 nivå (30/60/100 mynter), +10 % toppfart
    og akselerasjon per nivå.
  - `magnet` Myntmagnet — 2 nivå (40/80), drar mynter i nabofeltet mot
    bilen (nivå 2 har lengre rekkevidde og sterkere drag).
  - `skjold` Skjold — 25 mynter, tåler én kollisjon uten å miste
    rekka (cyan ring rundt bilen mens aktivt; brukes opp og kan
    kjøpes på nytt).
- **Lakk** — 6 farger: mint (gratis), rød/blå (20), lilla (30),
  hvit (40), gull (50).
- **Kart** — 4 stk med helt forskjellig tema: Nattbyen (gratis, det
  opprinnelige utseendet), Ørkenen (75, dag/sand/kaktuser),
  Vinterveien (100, snø/snøtrær), Solnedgang (150, oransje-lilla
  himmel/palmer).

### Kart-temaer

Hvert kart er et `theme`-objekt i `shop-data.js` (himmel-gradient,
tåke, bakkefarge, lys, stjerneopasitet, scenery-variant:
`tre`/`snøtre`/`kaktus`/`palme`) som sendes til `createCarRunner()`.
`DEFAULT_THEME` i `car-runner.js` er Nattbyen og skal se nøyaktig ut
som den gamle versjonen. Når spilleren bytter kart/lakk/oppgradering i
butikken, gjenskapes runneren (`dispose()` + `createCarRunner()`)
ved neste spillstart — det finnes ingen runtime-temabytte.

### Utvidede callbacks i `createCarRunner(canvas, options)`

Nye options: `paint` (hex-farge på lakken), `upgrades`
(`{turbo, magnet, skjold}`-nivåer), `theme` (kart-objekt),
`onQuestion(questionOrNull)`, `onCoinCollect()` (kalles per mynt,
også for bonusmynter), `onShieldUsed()` (skjoldet ble brukt opp —
`main.js` nullstiller da `upgrades.skjold` i profilen). Eksisterende
API (`start/stop/pause/resume/dispose/setSecondsPerCoin`,
`onEarn/onComboBreak/onStatsUpdate`) er uendret.


## Forhåndsvise uten å bygge Rust

Frontend-en er nå ES-moduler (pga. Three.js-importen), så du kan **ikke**
lenger dobbeltklikke `index.html` direkte — den må serveres over HTTP:

```bash
npm run preview
```

Åpne så http://localhost:3456 for å teste alt — bilspillet, meny,
PIN-flyt, innstillinger og HUD-boksen — uten Rust/Tauri. `main.js`
simulerer da Tauri-kallene lokalt (PIN er `1234`). I forhåndsvisning
vises HUD-boksen som en liten fast boks i hjørnet av siden; i den ekte
appen er selve vinduet 250×64px og transparent rundt boksen.

## Forutsetninger for den ekte appen

- [Node.js](https://nodejs.org)
- [Rust](https://www.rust-lang.org/tools/install) + `cargo`
- Tauris systemavhengigheter for Windows (Microsoft Visual C++ Build
  Tools + WebView2 — WebView2 følger som regel med Windows 10/11)

## Kjøre appen i utviklingsmodus

```bash
npm install
npm run tauri dev
```

## Bygge en installerbar .exe lokalt

```bash
npm run tauri build
```

For at oppdaterings-signaturer skal genereres lokalt trenger du
`TAURI_SIGNING_PRIVATE_KEY` (se under).

Legg gjerne til egne ikoner før du bygger en ferdig installasjonsfil:

```bash
npm install -g @tauri-apps/cli
tauri icon sti/til/din-logo.png
```

## Release via GitHub Actions

GitHub bygger Windows-installeren, publiserer en Release og legger ut
`latest.json` som appen bruker til automatiske oppdateringer.

### Ny versjon (anbefalt)

1. Gå til **Actions → Release → Run workflow**
2. Velg bump-type:
   - **patch** — `0.1.0` → `0.1.1` (små fikser)
   - **minor** — `0.1.0` → `0.2.0` (nye funksjoner)
   - **major** — `0.1.0` → `1.0.0` (store endringer)
3. Workflowen bumper versjon i `package.json`, `Cargo.toml` og
   `tauri.conf.json`, lager tag `vX.Y.Z`, bygger NSIS/MSI og publiserer
   releasen.

### Manuell tag

```bash
npm run bump -- patch   # eller minor / major
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version"
git tag v$(node -p "require('./package.json').version")
git push origin main --tags
```

### Secrets (allerede satt for dette repoet)

| Secret | Beskrivelse |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Privat nøkkel for å signere oppdateringer |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Valgfri passord (tom hvis nøkkelen er uten) |

Privat nøkkel ligger lokalt i `%USERPROFILE%\.tauri\safe-home.key`.
**Mist aldri denne** — uten den kan ikke nye oppdateringer signeres for
brukere som allerede har appen.

## Automatiske oppdateringer

Installerte klienter sjekker
`https://github.com/matwebmaker-lab/Safe-Home/releases/latest/download/latest.json`
noen sekunder etter oppstart. Finnes en nyere signert versjon, lastes den
ned og installeres (NSIS, passiv modus), og appen starter på nytt.

- Fungerer bare i **release-bygg** (ikke `tauri dev`).
- Brukere som har en eldre installasjon *uten* updater må installere én
  gang manuelt fra GitHub Releases; deretter går resten av seg selv.

## Hvordan data lagres

Appen lagrer to små JSON-filer i:

```
%APPDATA%\no.familie.safehome\
├── config.json   PIN-hash, opplåsingstekst, minutter/sekunder, dagsgrense
└── state.json     gjenstående tid akkurat nå + opptjent i dag
```

Alt dette settes nå enklest via innstillingspanelet i appen (tannhjulet).
`config.json` opprettes automatisk med standardverdier første gang appen
kjøres, og kan også redigeres for hånd om ønskelig.

## Hva denne appen bevisst *ikke* gjør

For å holde omfanget ærlig og håndterbart, er dette låseskjermen, dens
knapper, opptjeningsspillet og HUD-boksen — ikke en fullverdig
foreldrekontroll-plattform:

- Den **overvåker ikke automatisk klokkeslett** for når den skal vises
  første gang — du bestemmer selv når appen startes (f.eks. ved
  Windows-oppstart, eller trigges fra et annet skript). Når den først
  vises og en periode med tid går ut, tar den seg derimot selv av å
  bytte mellom låst og HUD-modus.
- Den **hindrer ikke** Alt+Tab, Oppgavebehandling eller andre måter å
  bytte bort fra vinduet på SO-nivå — det krever systemnære «kiosk-modus»-
  hooks som er utenfor dette prosjektets omfang.
- Spillet krever WebGL (WebView2 på Windows 10/11 støtter dette). Hvis
  WebGL mangler, vises en tydelig feilmelding i stedet for spillet.
- Grafikken justerer seg selv: hvis maskinen ligger under ~24 fps de
  første sekundene, skrus skygger, frontlyskaster og landskap av
  automatisk. Du kan også tvinge lav grafikk med `?lowgfx` i URL-en
  (mest nyttig i nettleser-forhåndsvisning). Spillets hastighet er
  uavhengig av bildefrekvens, så det går i riktig tempo også på trege
  maskiner.
- Spillets opptjente tid rapporteres av frontend-koden til Rust-backenden.
  Det er ikke hardnet mot en teknisk kyndig bruker som endrer JavaScript
  via utviklerverktøy — men Tauri-produksjonsbygg har normalt ikke
  utviklerverktøy tilgjengelig.
- Dagsgrensen for opptjent tid nullstilles ved UTC-midnatt, ikke
  nødvendigvis ved midnatt lokal tid.

## Mappestruktur

```
safe-home/
├── .github/workflows/     GitHub Actions (release + versjonsbump)
├── scripts/bump-version.mjs
├── src/                   Frontend (HTML/CSS/JS ES-moduler, ingen bundler)
│   ├── index.html          Låst visning + HUD-visning + alle paneler
│   ├── styles.css
│   ├── main.js             App-logikk (ES-modul)
│   ├── game/car-runner.js  3D bilspillet (Three.js endless runner m/ matte,
│   │                         oppgraderinger og kart-temaer)
│   ├── game/profile.js     Lommebok + eide ting, lagres i localStorage
│   ├── game/shop-data.js   Butikkdata: oppgraderinger, lakk og kart-temaer
│   └── vendor/             three.module.min.js + three.core.min.js (offline)
├── src-tauri/              Rust-backend
│   ├── src/main.rs         Kommandoer, vindusbytte, bakgrunnstråd, auto-update
│   ├── Cargo.toml
│   ├── tauri.conf.json     Vindu + updater-endepunkt
│   └── capabilities/
└── package.json
```

## Én ting å merke seg

Rust-koden er skrevet for hånd og kunne ikke kompileres i miljøet den ble
laget i (ingen `cargo`/Windows-mål tilgjengelig der), så kjør
`npm run tauri dev` og gi beskjed om du treffer på kompileringsfeil.
Frontend-koden (HTML/CSS/JS) er derimot testet og verifisert fullt ut i
nettleser — alle knapper, spillet, innstillinger og HUD-overgangene
fungerer som beskrevet.
