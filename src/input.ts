// Keyboard + touch input, reduced to three axes the game reads each frame.
//
// Touch: an on-screen steering pad (bottom left, slide the thumb between ◀
// and ▶) and a brake pedal (bottom right). The car accelerates on its own
// while the brake is up. The controls show only on touch devices while
// driving (body.touch.driving, see style.css).

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
  private readonly steerTouches = new Map<number, number>(); // pointerId -> -1 | 1
  private readonly brakeTouches = new Set<number>();
  private usingTouch = false;
  private smoothedSteer = 0;
  onAction: (() => void) | null = null;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if ([...LEFT, ...RIGHT, ...UP, ...DOWN, "Space"].includes(e.code)) e.preventDefault();
      if ((e.code === "Space" || e.code === "Enter") && !e.repeat) this.onAction?.();
      this.keys.add(e.code);
      this.usingTouch = false;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.release());

    // any touch (e.g. tapping Start) switches to touch driving: auto-throttle from the first frame
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") this.usingTouch = true;
    });

    // touch devices get the on-screen controls
    const markTouch = () => document.body.classList.add("touch");
    if (window.matchMedia("(pointer: coarse)").matches) markTouch();
    window.addEventListener("touchstart", markTouch, { passive: true, once: true });

    const pad = document.getElementById("touch-steer")!;
    const side = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2 ? -1 : 1;
    };
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId); // keep steering while the thumb slides off the pad
      this.usingTouch = true;
      this.steerTouches.set(e.pointerId, side(e));
      this.showPressed();
    });
    pad.addEventListener("pointermove", (e) => {
      if (!this.steerTouches.has(e.pointerId)) return;
      this.steerTouches.set(e.pointerId, side(e));
      this.showPressed();
    });
    const steerEnd = (e: PointerEvent) => {
      this.steerTouches.delete(e.pointerId);
      this.showPressed();
    };
    pad.addEventListener("pointerup", steerEnd);
    pad.addEventListener("pointercancel", steerEnd);

    const brake = document.getElementById("touch-brake")!;
    brake.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      brake.setPointerCapture(e.pointerId);
      this.usingTouch = true;
      this.brakeTouches.add(e.pointerId);
      this.showPressed();
    });
    const brakeEnd = (e: PointerEvent) => {
      this.brakeTouches.delete(e.pointerId);
      this.showPressed();
    };
    brake.addEventListener("pointerup", brakeEnd);
    brake.addEventListener("pointercancel", brakeEnd);

    // no long-press menus or text selection on the controls
    for (const el of [pad, brake]) el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Drop every held key and touch (window blur, run end). */
  release(): void {
    this.keys.clear();
    this.steerTouches.clear();
    this.brakeTouches.clear();
    this.showPressed();
  }

  private touchSteer(): number {
    let s = 0;
    for (const v of this.steerTouches.values()) s += v;
    return Math.sign(s);
  }

  private showPressed(): void {
    const s = this.touchSteer();
    document.getElementById("touch-left")!.classList.toggle("on", s < 0);
    document.getElementById("touch-right")!.classList.toggle("on", s > 0);
    document.getElementById("touch-brake")!.classList.toggle("on", this.brakeTouches.size > 0);
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
      steerTarget = this.touchSteer();
      brake = this.brakeTouches.size > 0 ? 1 : 0;
      throttle = brake ? 0 : 1; // auto-throttle while the brake is up
    }

    // ease steering in/out so digital input feels analogue
    const rate = steerTarget === 0 ? 10 : 6;
    this.smoothedSteer += (steerTarget - this.smoothedSteer) * Math.min(1, rate * dt);
    if (Math.abs(this.smoothedSteer) < 0.001) this.smoothedSteer = 0;

    return { throttle, brake, steer: this.smoothedSteer };
  }
}
