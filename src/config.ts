// World units are metres; forward is -Z. The player stays at z = 0 and the
// world scrolls towards +Z, so coordinates never grow (no float drift).

export const KMH = 1 / 3.6; // multiply km/h by this to get m/s

export const LANE_WIDTH = 3.6;
export const LANE_COUNT = 4;
export const ROAD_WIDTH = LANE_WIDTH * LANE_COUNT;
export const SHOULDER = 1.0;
export const RAIL_X = ROAD_WIDTH / 2 + SHOULDER;

export const CHUNK_LENGTH = 60; // multiple of the 12 m lane-dash period
export const CHUNK_COUNT = 10; // must be even so lamp sides alternate cleanly
export const RECYCLE_Z = 20; // a chunk entirely behind this z moves to the front

export const FOG_NEAR = 140;
export const FOG_FAR = 460;

// top speed, acceleration and steering come from the garage car (src/cars.ts)
export const PLAYER = {
  startSpeedKmh: 60,
  minSpeedKmh: 30,
  fxMaxSpeedKmh: 250, // speed lines, FOV and camera reach full strength here
  brake: 24, // m/s²
  coastDecel: 2.5, // m/s² with no input
  steerResponse: 9, // how fast lateral velocity reaches its target
};

export const HIGH_SPEED_KMH = 100;

export const TRAFFIC = {
  poolSize: 40,
  spawnMin: 320, // spawn distance ahead (inside fog)
  spawnMax: 500,
  despawnBehind: 40,
  baseCount: 15,
  countPerKm: 5,
  maxCount: 30,
  minLaneGap: 26, // free road needed in a lane to spawn
  followGap: 14, // traffic slows down behind a slower vehicle within this gap
  brakeDecel: 6, // m/s², for stopping behind a stopped vehicle or roadblock
  stopGap: 2.5, // metres left when stopped
};

export const laneCenter = (lane: number): number =>
  -ROAD_WIDTH / 2 + LANE_WIDTH * (lane + 0.5);

// Getaway: heat (0..100) sets the wanted level, which sets how many police
// chase you and how fast they go. Drop below their speed and they close in.
export const HEAT = {
  perSecond: 0.35, // the chase escalates on its own
  perSecondFast: 0.35, // extra while above fastKmh
  fastKmh: 160,
  nearMiss: 4,
  takedown: 6,
  perLevel: 20, // level = 1 + floor(heat / perLevel), max 5
};

export const POLICE = {
  firstSpawnDelay: 4, // seconds of head start before the first cop shows up
  respawnDelay: [3, 6] as [number, number],
  spawnBehind: 100, // metres behind the player
  loseDistance: 160, // a cop this far behind has lost you
  // per wanted level 1..5
  maxSpeedKmh: [150, 165, 180, 195, 210],
  count: [1, 1, 2, 3, 4],
  steerSpeed: 8, // lateral m/s
  reaction: [0.55, 1.0] as [number, number], // seconds of look-ahead (rookies look less far)
  bustRange: { dx: 3.6, dz: 9 },
  bustFillSeconds: 2.2,
  bustDrainSeconds: 1.5,
};

export const SCORE = {
  // driving: points per metre at 100 km/h (scales with speed), plus a per-second bonus above HIGH_SPEED_KMH
  perMetre: 0.1,
  highSpeedPerSecond: 5,
  nearMiss: 100,
  nearMissGap: 1.1, // metres of side clearance that counts as a near miss
  takedown: 500,
  copLost: 300,
  // every near miss adds 1 to the combo, a takedown adds 2; the combo resets
  // when nothing adds to it for comboWindow seconds
  comboWindow: 3.5,
  comboPerStep: 3, // combo needed per +1 on the multiplier
  maxMultiplier: 5, // the multiplier applies to every point scored
  takedownCombo: 2,
};

// Escaping: once a cop has been close, keep every cop more than clearDistance
// behind for a while and the wanted level drops a star.
export const ESCAPE = {
  clearDistance: 70, // metres
  baseSeconds: 6, // plus perLevelSeconds per wanted star
  perLevelSeconds: 2,
  drainSeconds: 1.5, // how fast progress drains while a cop is close
  bonusPerLevel: 400,
  cooldown: 6, // seconds before the next cop after an escape
};

// Hazards the police put on the road ahead once the wanted level is high enough.
export const HAZARDS = {
  spawnAhead: 380, // metres (inside the fog)
  warnDistance: 260, // HUD warning from this far out
  minSpacing: 160, // metres between two hazards
  spikes: {
    minLevel: 2,
    interval: [13, 22] as [number, number], // seconds between strips
    speedKept: 0.55, // speed multiplier when the tyres blow
    capKmh: 125, // top speed with blown tyres...
    capSeconds: 5, // ...for this long
    heat: 3,
  },
  roadblock: {
    minLevel: 3,
    interval: [20, 34] as [number, number],
    bonus: 800, // points for getting through the gap
    combo: 2,
  },
  heli: {
    minLevel: 5,
    evadeRate: 0.5, // escape progress fills this much slower under the searchlight
  },
};
