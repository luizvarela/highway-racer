# Highway Racer (prototype)

Endless highway racer in Three.js + TypeScript. Step 1: core loop only.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build in dist/
```

Controls: ↑/W accelerate, ↓/S brake, ←→/A D steer, Space start/restart.
Touch: hold the left/right half of the screen to steer (auto-throttle), both halves to brake.

## Layout

| File | What it does |
|---|---|
| `src/config.ts` | All tuning: lanes, speeds, traffic density, fog |
| `src/road.ts` | Recycled road chunks (asphalt, rails, lamps, trees) |
| `src/player.ts` | Arcade handling: speed + lateral steering, rail scrape, crash spin |
| `src/traffic.ts` | Pooled traffic, lane following, fair spawning, AABB collision |
| `src/vehicles.ts` | Low-poly vehicle builder (sports, sedan, hatch, van, truck, bus) |
| `src/game.ts` | Loop, states (ready / running / crashed), scoring, camera |
| `src/input.ts`, `src/hud.ts` | Keyboard/touch input and DOM HUD |

The player stays at z = 0 and the world scrolls past, so coordinates never grow.
`window.__game` exposes read-only state for smoke tests.
