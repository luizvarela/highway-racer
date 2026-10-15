// Keyboard + touch input, reduced to three axes the game reads each frame.

export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
}

const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const UP = ["ArrowUp", "KeyW"];
const DOWN = ["ArrowDown", "KeyS"];

export class Input {
  private readonly keys = new Set<string>();
  private readonly touches = new Map<number, number>(); // pointerId -> clientX
  private usingTouch = false;
  private smoothedSteer = 0;
  onAction: (() => void) | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if ([...LEFT, ...RIGHT, ...UP, ...DOWN, "Space"].includes(e.code)) e.preventDefault();
      if ((e.code === "Space" || e.code === "Enter") && !e.repeat) this.onAction?.();
      this.keys.add(e.code);
      this.usingTouch = false;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.touches.clear();
    });

    target.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      this.usingTouch = true;
      this.touches.set(e.pointerId, e.clientX);
    });
    target.addEventListener("pointermove", (e) => {
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, e.clientX);
    });
    const end = (e: PointerEvent) => this.touches.delete(e.pointerId);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  read(dt: number): InputState {
    let steerTarget = 0;
    let throttle = this.any(UP) ? 1 : 0;
    let brake = this.any(DOWN) ? 1 : 0;

    if (this.any(LEFT)) steerTarget -= 1;
    if (this.any(RIGHT)) steerTarget += 1;

    if (this.usingTouch) {
      const half = window.innerWidth / 2;
      let left = false;
      let right = false;
      for (const x of this.touches.values()) {
        if (x < half) left = true;
        else right = true;
      }
      // both sides held = brake; otherwise auto-throttle
      if (left && right) brake = 1;
      else {
        throttle = 1;
        steerTarget = left ? -1 : right ? 1 : 0;
      }
    }

    // ease steering in/out so digital keys feel analogue
    const rate = steerTarget === 0 ? 10 : 6;
    this.smoothedSteer += (steerTarget - this.smoothedSteer) * Math.min(1, rate * dt);
    if (Math.abs(this.smoothedSteer) < 0.001) this.smoothedSteer = 0;

    return { throttle, brake, steer: this.smoothedSteer };
  }
}
