# Neon Getaway

Neon night getaway racer in Three.js + TypeScript: an endless highway with the
police on your tail.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build in dist/
```

Controls: ↑/W accelerate, ↓/S brake, ←→/A D steer, Space start/restart, M sound.
Touch: on-screen ◀ ▶ pad (bottom left, slide between them) to steer and a BRAKE pedal (bottom right); the car accelerates on its own.

## Getaway rules

- **Heat** rises over time, faster above 160 km/h, and with every near miss and
  takedown. Every 20 heat adds a wanted star (max 5).
- The wanted level sets how many cops chase you (1, 1, 2, 3, 4) and their top
  speed (150 to 210 km/h). Stay faster and they fall back; slow down and they
  close in.
- A cop within about one car length of you fills the **bust meter** (2.2 s);
  full means **BUSTED**. Hitting traffic still ends the run as **CRASHED**.
- Cops steer around traffic with a short look-ahead, so weaving close past cars
  can make them crash: **takedown**. A cop that got close and then falls 160 m
  behind is **lost**.
- **Escape**: once a cop has been close, keep every cop more than 70 m behind
  for 6 s + 2 s per star and the wanted level drops a star (bonus 400 per star
  you had). At one star it's a clean getaway: the heat resets and the next cop
  comes after a 6 s break.

## Scoring

Every point is multiplied by the **multiplier** (x1 to x5), so risky driving
pays more than just driving far.

- **Combo**: each near miss (overtaking with less than 1.1 m of side
  clearance) adds 1, each takedown adds 2. Every 3 combo raises the multiplier
  by one. The combo resets after 3.5 s without adding to it, or when the run ends.
- **Points** (before the multiplier): driving (distance weighted by speed, plus
  5/s above 100 km/h), near miss 100, takedown 500, cop lost 300, escape 400
  per star.
- The results screen breaks the score down by source.

All of these numbers live in `HEAT`, `POLICE`, `ESCAPE` and `SCORE` in `src/config.ts`.

## Missions, daily bonus, next goal

Three **missions** are always active (`src/missions.ts`): totals that add up
across runs ("Get 10 near misses") and single-run goals ("Drive 2 km in one
run", tagged *1 run*). Finishing one pays $250–$1,000 and a new mission takes
its slot; every 4 completions moves new missions up a tier (bigger targets,
bigger pay). A "MISSION DONE" popup fires the moment the target is reached;
the cash lands on the results screen. One free swap (↻) a day.

The **daily bonus** pays $200 on the first day and $200 more per consecutive
day, up to $1,000; a missed day resets it. Days follow the player's local
calendar. The **next goal** line under the wallet ("Viper · $1,200 to go")
opens the garage on that car; once every car is owned it points at the
cheapest upgrade.

All three live in the save (`missions`, `missionsDone`, `rerollDay`, `daily`)
and sync through the portal store like everything else.

## Hazards

The police put obstacles on the road ahead while they chase you. A warning
shows the distance and the lanes (red = blocked).

- **Spike strips** (2+ stars): laid across your lane, sometimes the next one
  too. Running over them blows your tyres: you lose 45% of your speed, top
  speed is capped at 125 km/h for 5 s and the car pulls side to side. Cops
  that drive over a strip crash (takedown).
- **Roadblocks** (3+ stars): police cars parked across every lane but one,
  leaving a 5.2 m gap (`HAZARDS.roadblock.gap`; a lane is 3.6 m),
  with traffic queuing behind them. Hitting one ends the run. Getting through
  the gap pays 800 and adds 2 to the combo.
- **Helicopter** (5 stars): flies in and keeps a searchlight on you. While it
  is overhead, escaping takes twice as long.
- Crashes and takedowns throw car parts (Kenney debris props) and sparks.

Tuning lives in `HAZARDS` in `src/config.ts`.

## Sound

All sound is synthesised with WebAudio in `src/audio.ts` (no audio files):
engine with gear shifts, wind, siren by police distance, helicopter rotor,
and effects for near misses, takedowns, crashes, spikes, roadblocks,
multiplier, escapes, purchases and hazard warnings. `M` or the speaker button
mutes; the setting is saved. Audio starts on the first click or key press and
pauses while the tab is hidden.

## Garage

Every run pays **cash**: $1 per 5 points. Spend it in the garage (from the
start or results screen) on cars and upgrades.

| Car | Price | Top speed | Accel | Handling | Toughness |
|---|---|---|---|---|---|
| Comet | free | 205 km/h | 6.5 | 10 | x1.0 |
| Viper | $3,000 | 215 km/h | 7.5 | 12 | x0.9 |
| Bruiser | $6,500 | 220 km/h | 7.0 | 9.5 | x1.6 |
| Phantom | $15,000 | 240 km/h | 8.5 | 12.5 | x1.0 |

- Upgrades, 5 levels each: **engine** +10 km/h top speed, **turbo** +0.6
  acceleration, **handling** +0.6 steering. Level prices are 1, 2, 3.5, 5.5
  and 8 times the car's base upgrade price ($250 to $900).
- **Toughness** stretches the bust meter: x1.6 takes 3.5 s to bust instead of 2.2 s.
- Cop top speeds run 150 to 210 km/h, so the starter car can't outrun a
  5-star chase without engine upgrades.
- Garage keys: ←/→ browse, Space drive (owned cars only), Backspace back (not Esc, which leaves fullscreen).
- Progress is saved in `localStorage` (`src/save.ts`, the place to plug in a
  portal cloud save). Car names are fictional on purpose; bodies are Kenney CC0
  models until the hero cars arrive.

## Portals (CrazyGames)

The game talks to web portals only through `src/portal.ts`. GitHub Pages and
local dev use a no-op portal (no ads, localStorage saves).

```bash
npm run build:crazygames   # dist-crazygames/ + neon-getaway-crazygames.zip (relative paths)
```

The CrazyGames build (or any page opened with `?portal=crazygames`) loads the
CrazyGames HTML5 SDK v3. If it fails or is disabled on the domain, the game
runs without a portal. On `localhost` the SDK runs in local mode and shows
placeholder ads.

- **Events**: loading start/stop around asset loading, gameplay start when a
  run starts, gameplay stop when it ends. Happytime fires on a new best score,
  at most once a session.
- **Midgame ad**: at the crash/bust transition, before the results, after 90 s
  of gameplay in the session and then at most every 180 s (`ADS` in
  `src/config.ts`; the SDK also enforces its own 3-minute limit). Input and
  simulation are blocked behind a spinner; audio is muted only once the ad
  actually starts.
- **Rewarded ad**: an optional "▶ 2× CASH" button on the results screen
  doubles that run's cash, paid only when the ad finishes (never on an error),
  once per run.
- **Saves** go through the SDK data module (cloud save for signed-in players).
  Progress already in localStorage carries over the first time. Turn on
  *Progress Save* when submitting, or the data module is disabled.
- The portal's `muteAudio` setting overrides the in-game sound toggle.
- **Lands in gameplay**: on CrazyGames the first run starts as soon as loading
  ends (their load time is measured to the first gameplay start), with a
  controls hint that fades after 7 s or on the first input. Other hosts keep
  the title screen.

The simulation runs in steps of at most 1/120 s with frame-rate independent
easing (`ease` in `src/config.ts`), so it plays the same on 30, 60 and 144 Hz
screens.



| File | What it does |
|---|---|
| `src/config.ts` | All tuning: lanes, speeds, traffic, fog, heat, police, scoring |
| `src/road.ts` | Recycled neon road chunks (asphalt, rails, lamps, city blocks) |
| `src/player.ts` | Arcade handling from the garage car's stats, rail scrape, crash spin |
| `src/traffic.ts` | Pooled traffic, lane following, queuing at roadblocks, fair spawning, collision, near misses |
| `src/police.ts` | Pursuit: spawning, slot formation, traffic avoidance, bust meter, light bars |
| `src/vehicles.ts` | Loads the Kenney Car Kit models and props (CC0) and adds head/tail lights |
| `src/environment.ts` | Skyline backdrop and speed lines |
| `src/scoring.ts` | Combo, multiplier and points per source |
| `src/cars.ts` | Car catalog, upgrade steps and prices, cash per score |
| `src/save.ts` | Saved progress (best, cash, owned cars, upgrades) with sanitising |
| `src/garage.ts` | Garage overlay: browse, buy, upgrade |
| `src/missions.ts` | Mission templates, progress, rewards; daily bonus |
| `src/hazards.ts` | Spike strips and roadblocks: spawning, warnings, collisions, lane walls for traffic |
| `src/helicopter.ts` | 5-star helicopter with searchlight (built from primitives) |
| `src/debris.ts` | Pooled flying car parts and spark bursts |
| `src/audio.ts` | Procedural WebAudio engine, siren and effects |
| `src/game.ts` | Loop, states, heat and escapes, chase camera, bloom |
| `src/input.ts`, `src/hud.ts` | Keyboard/touch input and DOM HUD |

The player stays at z = 0 and the world scrolls past, so coordinates never grow.
`window.__game` exposes read-only state for smoke tests, plus `advance(seconds)`,
which switches the game to fixed 1/60 s steps so a test can run the simulation
faster than a slow (software-rendered) browser draws it.
