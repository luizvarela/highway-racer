import * as THREE from "three";

// Police helicopter at 5 stars: flies in from ahead, hovers in front of the
// player and keeps a searchlight on the car. Built from primitives (no asset).

const STATION = new THREE.Vector3(0, 12.5, -40); // hover point relative to the player
const AWAY = new THREE.Vector3(0, 40, -260); // where it comes from and leaves to
const TRAVEL_SECONDS = 4;

export class Helicopter {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly rotor: THREE.Mesh;
  private readonly tailRotor: THREE.Mesh;
  private readonly beacon: THREE.MeshStandardMaterial;
  private readonly light = new THREE.SpotLight(0xe6efff, 0, 90, 0.16, 0.5, 1); // intensity 0 when away, never removed
  private readonly beam: THREE.Mesh;
  private progress = 0; // 0 = away, 1 = on station
  private wanted = false;
  private time = 0;

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f2b, metalness: 0.4, roughness: 0.5 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xe8ecf4, metalness: 0.2, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a2440, emissive: 0x2a7bd0, emissiveIntensity: 0.6 });

    const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12).scale(1, 0.9, 1.6), dark);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.4, 16).rotateX(Math.PI / 2).scale(1, 0.9, 1.6), stripe);
    band.scale.set(1, 1, 0.25);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10).scale(1, 0.8, 1.1), glass);
    nose.position.set(0, 0.15, -1.5);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 5, 8).rotateX(Math.PI / 2), dark);
    boom.position.set(0, 0.3, 4);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.8), dark);
    fin.position.set(0, 0.9, 6.3);
    const skidGeo = new THREE.BoxGeometry(0.12, 0.12, 3.6);
    for (const side of [-1, 1]) {
      const skid = new THREE.Mesh(skidGeo, dark);
      skid.position.set(side * 1.0, -1.45, 0);
      this.body.add(skid);
    }
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.35), dark);
    this.rotor.position.y = 1.45;
    const rotor2 = this.rotor.clone();
    rotor2.rotation.y = Math.PI / 2;
    this.rotor.add(rotor2);
    rotor2.position.set(0, 0, 0);
    this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.18), dark);
    this.tailRotor.position.set(0.2, 0.9, 6.4);

    this.beacon = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2030, emissiveIntensity: 0 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.beacon);
    beacon.position.set(0, -1.25, 0.6);

    this.body.add(cabin, band, nose, boom, fin, this.rotor, this.tailRotor, beacon);
    this.group.add(this.body);

    // the searchlight and a faint visible beam down to the car
    this.group.add(this.light, this.light.target);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 3.2, 1, 20, 1, true).translate(0, -0.5, 0),
      new THREE.MeshBasicMaterial({
        color: 0xbfd8ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.group.add(this.beam);
    this.body.visible = this.beam.visible = false;
  }

  /** On station with the light on the car: escaping is slower. */
  get watching(): boolean {
    return this.wanted && this.progress >= 1;
  }

  /** "arrived" the moment it reaches its station. */
  update(dt: number, wanted: boolean, playerX: number): "arrived" | null {
    this.time += dt;
    const before = this.progress;
    this.wanted = wanted;
    this.progress = THREE.MathUtils.clamp(this.progress + (wanted ? dt : -dt) / TRAVEL_SECONDS, 0, 1);
    const shown = this.progress > 0;
    this.body.visible = this.beam.visible = shown;
    if (!shown) {
      this.light.intensity = 0;
      return null;
    }

    const t = THREE.MathUtils.smoothstep(this.progress, 0, 1);
    const sway = Math.sin(this.time * 0.7) * 3;
    this.body.position.lerpVectors(AWAY, STATION, t);
    this.body.position.x = playerX * 0.6 * t + sway;
    this.body.position.y += Math.sin(this.time * 1.3) * 0.4;
    // nose down while flying in, level when hovering; it faces the player (+Z)
    this.body.rotation.set(-0.12 - (1 - t) * 0.2, Math.PI + Math.sin(this.time * 0.5) * 0.08, Math.sin(this.time * 0.7) * 0.06);
    this.rotor.rotation.y += dt * 38;
    this.tailRotor.rotation.x += dt * 50;
    this.beacon.emissiveIntensity = (this.time * 1.2) % 1 < 0.1 ? 8 : 0;

    // searchlight on the car, a little ahead of it
    const target = new THREE.Vector3(playerX, 0, -1);
    this.light.target.position.copy(target);
    this.light.intensity = 150 * t;
    const from = this.light.position.copy(this.body.position).add(new THREE.Vector3(0, -1.3, 1.4));
    const dir = target.clone().sub(from);
    this.beam.position.copy(from);
    this.beam.scale.set(1, dir.length(), 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.07 * t;

    return before < 1 && this.progress >= 1 && wanted ? "arrived" : null;
  }

  reset(): void {
    this.progress = 0;
    this.wanted = false;
    this.body.visible = this.beam.visible = false;
    this.light.intensity = 0;
  }
}
