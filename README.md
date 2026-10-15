# Highway Racer (prototype)

Neon night getaway racer in Three.js + TypeScript: an endless highway with the
police on your tail.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build in dist/
```

Controls: ↑/W accelerate, ↓/S brake, ←→/A D steer, Space start/restart.
Touch: hold the left/right half of the screen to steer (auto-throttle), both halves to brake.

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

## Layout

| File | What it does |
|---|---|
| `src/config.ts` | All tuning: lanes, speeds, traffic, fog, heat, police, scoring |
| `src/road.ts` | Recycled neon road chunks (asphalt, rails, lamps, city blocks) |
| `src/player.ts` | Arcade handling: speed + lateral steering, rail scrape, crash spin |
| `src/traffic.ts` | Pooled traffic, lane following, fair spawning, collision, near misses |
| `src/police.ts` | Pursuit: spawning, slot formation, traffic avoidance, bust meter, light bars |
| `src/vehicles.ts` | Loads the Kenney Car Kit models (CC0) and adds head/tail lights |
| `src/environment.ts` | Skyline backdrop and speed lines |
| `src/scoring.ts` | Combo, multiplier and points per source |
| `src/game.ts` | Loop, states, heat and escapes, chase camera, bloom |
| `src/input.ts`, `src/hud.ts` | Keyboard/touch input and DOM HUD |

The player stays at z = 0 and the world scrolls past, so coordinates never grow.
`window.__game` exposes read-only state for smoke tests, plus `advance(seconds)`,
which switches the game to fixed 1/60 s steps so a test can run the simulation
faster than a slow (software-rendered) browser draws it.
