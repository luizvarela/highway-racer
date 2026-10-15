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
  can make them crash: **takedown** (+500). A cop that got close and then falls
  160 m behind is **lost** (+300).
- **Near miss**: overtaking a vehicle with less than 1.1 m of side clearance
  scores 60 times the combo, which chains while near misses come within 3 s.

All of these numbers live in `HEAT`, `POLICE` and `SCORE` in `src/config.ts`.

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
| `src/game.ts` | Loop, states, heat and scoring, chase camera, bloom |
| `src/input.ts`, `src/hud.ts` | Keyboard/touch input and DOM HUD |

The player stays at z = 0 and the world scrolls past, so coordinates never grow.
`window.__game` exposes read-only state for smoke tests, plus `advance(seconds)`,
which switches the game to fixed 1/60 s steps so a test can run the simulation
faster than a slow (software-rendered) browser draws it.
