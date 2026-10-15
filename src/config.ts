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

export const PLAYER = {
  startSpeedKmh: 60,
  minSpeedKmh: 30,
  maxSpeedKmh: 240,
  accel: 7.5, // m/s² at standstill, tapers to 0 at max speed
  brake: 24, // m/s²
  coastDecel: 2.5, // m/s² with no input
  steerSpeed: 11, // max lateral m/s
  steerResponse: 9, // how fast lateral velocity reaches its target
  width: 1.8,
  length: 4.4,
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
};

export const laneCenter = (lane: number): number =>
  -ROAD_WIDTH / 2 + LANE_WIDTH * (lane + 0.5);
