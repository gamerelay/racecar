// The car select's turntable (PLAN phase 4): your car on a slow turntable, drawn over the live
// race behind the lobby. It's a scene of its own that the renderer draws after the world, into the
// same target with the depth cleared, so the game's post pass (ink, grade, grain) is on it too and
// the preview looks like the game. A new car drives up onto the table; a new paint or plate swaps
// in place. It's framed into a box on screen (the menu's stage), so the CSS decides where the car
// sits: beside the docked menu, or above it on a phone.

import { CylinderGeometry, DirectionalLight, type Fog, Group, HemisphereLight, type Material, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Scene } from 'three';
import type { CarClass, PaintDef } from '../core/content';
import { damp } from '../core/math';
import type { CarPlate, CarVisual, Skin } from './skin';

/** A new car's drive-up: how long it takes (s). */
export const DRIVE_UP = 0.9;
/** The table's turn, rad/s. */
const TURN = 0.3;
/** Where the table is turned when a new car arrives: its nose toward the camera, a little left. */
const START_ANGLE = -0.6;
/** How far above level the camera looks down at the car (rad), and its field of view (deg). */
const ELEVATION = 0.2;
const FOV = 30;
/** Wheel radius the spin is worked out from (the renderer's). */
const WHEEL = 0.38;

/** Where a car driving up from `from` m back is `t` s in: meters back from the table's middle, and its speed (m/s). Eases out to a stop. */
export function driveUp(t: number, from: number, seconds = DRIVE_UP): { back: number; speed: number } {
  const k = 1 - Math.min(1, Math.max(0, t / seconds));
  return { back: from * k * k * k, speed: (3 * from * k * k) / seconds };
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How the camera frames a table of radius `r` (m) into `box` on a `w` × `h` view with a vertical
 * field of view `fov` (deg): how far back it stands, and the view offset that puts the table in
 * the box's middle. The table spans most of the box's height, and never more than its width.
 */
export function frameStage(w: number, h: number, box: Box, r: number, fov = FOV): { dist: number; offX: number; offY: number } {
  const t = Math.tan((fov * Math.PI) / 360);
  // The table's radius on screen, in px.
  const px = Math.max(8, Math.min(box.height * 0.36, box.width * 0.36));
  return { dist: (r * h) / (2 * px * t), offX: w / 2 - (box.left + box.width / 2), offY: h / 2 - (box.top + box.height / 2) };
}

/** The table's radius for a car: room round its nose and tail. */
export const tableRadius = (cls: Pick<CarClass, 'size'>) => Math.max(2.6, cls.size[1] + 0.7);

export class Showroom {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 3000);
  /** Drawn this frame: the lobby is up and you have a seat. */
  visible = false;
  private readonly table = new Group();
  private readonly top: Mesh;
  private readonly rim: Mesh;
  private readonly hemi = new HemisphereLight();
  private readonly key = new DirectionalLight();
  private car: { v: CarVisual; key: string; cls: CarClass } | null = null;
  private angle = START_ANGLE;
  /** Seconds into the current car's drive-up. */
  private t = DRIVE_UP;
  /** How far back this car's drive-up starts (m). */
  private from = 0;
  private spin = 0;
  private dist = 0;
  private radius = 2.6;
  /** The table's size as drawn: it grows or shrinks to a new car over a moment, with the camera. */
  private shown = 0;
  private box: Box | null = null;
  private view = { w: 1, h: 1 };

  constructor(private readonly skin: Skin) {
    // A dark plate with a lit rim, one unit wide, scaled to the car.
    this.top = new Mesh(new CylinderGeometry(1, 1, 0.22, 64), new MeshLambertMaterial({ color: 0x4a3a78, emissive: 0x140a28 }));
    this.top.position.y = -0.11;
    this.rim = new Mesh(new CylinderGeometry(1.03, 1.03, 0.08, 64, 1, true), new MeshBasicMaterial({ color: 0x35f0ff }));
    this.rim.position.y = -0.04;
    this.scene.add(this.top, this.rim, this.table);
    this.key.position.set(-4, 7, 9);
    this.scene.add(this.hemi, this.key, this.key.target);
  }

  /** Lights the table like the world it's over: its sky and sun colors (the key comes from the front). */
  light(world: Scene): void {
    for (const o of world.children) {
      if (o instanceof HemisphereLight) {
        this.hemi.color.copy(o.color);
        this.hemi.groundColor.copy(o.groundColor);
        this.hemi.intensity = o.intensity;
      } else if (o instanceof DirectionalLight) {
        this.key.color.copy(o.color);
        this.key.intensity = o.intensity;
      }
    }
    // The world's own fog object, so the shared car materials don't switch programs between the
    // two scenes (the car is far nearer than the fog starts).
    this.scene.fog = world.fog as Fog | null;
  }

  /** Puts your car on the table: a new class drives up, a new paint or plate swaps in place. */
  show(cls: CarClass, paint: PaintDef, plate?: CarPlate): void {
    this.visible = true;
    const key = `${cls.id}|${paint.id}|${plate?.text}|${plate?.region}|${plate?.map}`;
    if (this.car?.key === key) return;
    const fresh = this.car?.cls.id !== cls.id;
    this.drop();
    const v = this.skin.car(cls, paint, plate);
    this.table.add(v.root);
    this.car = { v, key, cls };
    this.radius = tableRadius(cls);
    // Its nose starts at the rim: the table floats over the race, so there's nothing past it to drive on.
    this.from = this.radius - cls.size[1] * 0.4;
    if (fresh) {
      this.t = 0;
      this.angle = START_ANGLE;
    }
    this.place();
  }

  hide(): void {
    this.visible = false;
  }

  /** Where on screen the table goes (the menu's stage, in CSS px), and the view's size. */
  frame(box: Box, w: number, h: number): void {
    this.box = box;
    this.view = { w, h };
    this.camera.aspect = w / h;
  }

  update(dt: number): void {
    if (!this.visible || !this.car) return;
    this.t += dt;
    this.angle += TURN * dt;
    const { speed } = driveUp(this.t, this.from);
    this.spin += (speed / WHEEL) * dt;
    this.shown = this.shown ? this.shown + (this.radius - this.shown) * damp(5, dt) : this.radius;
    this.place();
    // Boost off the line, brakes into the stop, then parked.
    const u = this.t / DRIVE_UP;
    this.car.v.update(this.spin, 0, u > 0.55 && u < 1.3, u < 0.4, true, dt);
    if (this.box) {
      const f = frameStage(this.view.w, this.view.h, this.box, this.radius);
      // A new size of car eases the camera in or out rather than cutting.
      this.dist = this.dist ? this.dist + (f.dist - this.dist) * damp(5, dt) : f.dist;
      const lookY = this.car.cls.size[2] * 0.8;
      this.camera.position.set(0, lookY + Math.sin(ELEVATION) * this.dist, Math.cos(ELEVATION) * this.dist);
      this.camera.lookAt(0, lookY, 0);
      this.camera.setViewOffset(this.view.w, this.view.h, f.offX, f.offY, this.view.w, this.view.h);
    }
  }

  private place(): void {
    if (!this.car) return;
    this.table.rotation.y = this.angle;
    this.car.v.root.position.set(0, 0, -driveUp(this.t, this.from).back);
    const s = this.shown || this.radius;
    this.top.scale.set(s, 1, s);
    this.rim.scale.set(s, 1, s);
    this.top.rotation.y = this.rim.rotation.y = this.angle;
  }

  private drop(): void {
    if (!this.car) return;
    this.table.remove(this.car.v.root);
    this.car.v.dispose();
    this.car = null;
  }

  dispose(): void {
    this.drop();
    for (const m of [this.top, this.rim]) {
      m.geometry.dispose();
      (m.material as Material).dispose();
    }
  }
}
