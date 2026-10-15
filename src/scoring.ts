import { SCORE } from "./config";

// Run score with a combo-driven multiplier. Every point goes through award(),
// so the multiplier applies to everything and the results can show where the
// points came from.

export type PointSource = "driving" | "nearMiss" | "takedown" | "copLost" | "escape";

export const POINT_SOURCES: PointSource[] = ["driving", "nearMiss", "takedown", "copLost", "escape"];

export class Scoring {
  combo = 0;
  bestCombo = 0;
  bestMultiplier = 1;
  private comboTimer = 0;
  private readonly points = new Map<PointSource, number>();

  get multiplier(): number {
    return Math.min(SCORE.maxMultiplier, 1 + Math.floor(this.combo / SCORE.comboPerStep));
  }

  /** 1 right after the combo grew, falling to 0 when it is about to reset */
  get comboLeft(): number {
    return this.combo > 0 ? Math.max(0, this.comboTimer / SCORE.comboWindow) : 0;
  }

  get total(): number {
    let t = 0;
    for (const v of this.points.values()) t += v;
    return t;
  }

  breakdown(): Record<PointSource, number> {
    return Object.fromEntries(POINT_SOURCES.map((s) => [s, Math.floor(this.points.get(s) ?? 0)])) as Record<PointSource, number>;
  }

  reset(): void {
    this.combo = 0;
    this.bestCombo = 0;
    this.bestMultiplier = 1;
    this.comboTimer = 0;
    this.points.clear();
  }

  update(dt: number): void {
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
  }

  /** Grow the combo; returns true when that raised the multiplier. */
  chain(steps: number): boolean {
    const before = this.multiplier;
    this.combo += steps;
    this.comboTimer = SCORE.comboWindow;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
    return this.multiplier > before;
  }

  breakCombo(): void {
    this.combo = 0;
    this.comboTimer = 0;
  }

  /** Adds base × multiplier to the source and returns the points awarded. */
  award(source: PointSource, base: number): number {
    const pts = base * this.multiplier;
    this.points.set(source, (this.points.get(source) ?? 0) + pts);
    return pts;
  }
}
