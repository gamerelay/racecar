// The car select's turntable (PLAN phase 4): your car on a slow turntable over the live race
// behind the lobby. It's in the world's own scene, as a small model (1:50) held just in front of
// the world's camera, so it's drawn by the same camera into the same depth buffer and lit by the
// same lights: the post pass (ink, reflections, grade, grain) and the weather treat it like
// everything else, and the preview looks like the game. Nothing in the world comes that close to
// the camera behind the lobby (a crane above the traffic), so nothing cuts through it. A new car
// drives up onto the table; a new paint or plate swaps in place. It's framed into a box on screen
// (the menu's stage), so the CSS decides where the car sits: beside the docked menu, or above it
// on a phone.

import { CylinderGeometry, Group, type Material, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera } from 'three';
import type { CarClass, PaintDef } from '../core/content';
import { damp } from '../core/math';
import type { CarPlate, CarVisual, Skin } from './skin';

/** A new car's drive-up: how long it takes (s). */
export const DRIVE_UP = 0.9;
/** The table's turn, rad/s. */
const TURN = 0.3;
/** Where the table is turned when a new car arrives: its nose toward the camera, a little left. */
const START_ANGLE = -0.6;
/** How far above level the car is seen from (rad). */
const ELEVATION = 0.2;
/** The model's scale: a meter of car is this many meters in the world, a hand's length from the lens. */
const SCALE = 0.02;
const FOV = 60;
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
 * the box's middle. The table spans the box's height, and never more than most of its width.
 */
export function frameStage(w: number, h: number, box: Box, r: number, fov = FOV): { dist: number; offX: number; offY: number } {
  const t = Math.tan((fov * Math.PI) / 360);
  // The table's radius on screen, in px.
  const px = Math.max(8, Math.min(box.height * 0.5, box.width * 0.36));
  return { dist: (r * h) / (2 * px * t), offX: w / 2 - (box.left + box.width / 2), offY: h / 2 - (box.top + box.height / 2) };
}

/** The table's radius for a car: room round its nose and tail. */
export const tableRadius = (cls: Pick<CarClass, 'size'>) => Math.max(2.6, cls.size[1] + 0.7);

export class Showroom {
  /** Goes in the world's scene; placed each frame in front of its camera. */
  readonly root = new Group();
  /** Drawn this frame: the lobby is up and you have a seat. */
  visible = false;
  private readonly table = new Group();
  private readonly top: Mesh;
  private readonly rim: Mesh;
  /** Where the car is seen from, in the table's own meters (what the world camera's view stands for). */
  private readonly eye = new PerspectiveCamera();
  private readonly m = new Matrix4();
  private readonly n = new Matrix4();
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
    this.root.add(this.top, this.rim, this.table);
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
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
    this.visible = this.root.visible = false;
  }

  /** Where on screen the table goes (the menu's stage, in CSS px), and the view's size. */
  frame(box: Box, w: number, h: number): void {
    this.box = box;
    this.view = { w, h };
  }

  /** Per frame, after the world camera has moved (its matrices current): the table in front of it. */
  update(dt: number, camera: PerspectiveCamera): void {
    this.root.visible = this.visible && !!this.car && !!this.box;
    if (!this.root.visible || !this.car || !this.box) return;
    this.t += dt;
    this.angle += TURN * dt;
    const { speed } = driveUp(this.t, this.from);
    this.spin += (speed / WHEEL) * dt;
    this.shown = this.shown ? this.shown + (this.radius - this.shown) * damp(5, dt) : this.radius;
    this.place();
    // Boost off the line, brakes into the stop, then parked.
    const u = this.t / DRIVE_UP;
    this.car.v.update(this.spin, 0, u > 0.55 && u < 1.3, u < 0.4, true, dt);
    const { w, h } = this.view;
    const f = frameStage(w, h, this.box, this.radius, camera.fov);
    // A new size of car eases the camera in or out rather than cutting.
    const d = (this.dist = this.dist ? this.dist + (f.dist - this.dist) * damp(5, dt) : f.dist);
    const lookY = this.car.cls.size[2] * 0.8;
    this.eye.position.set(0, lookY + Math.sin(ELEVATION) * d, Math.cos(ELEVATION) * d);
    this.eye.lookAt(0, lookY, 0);
    this.eye.updateMatrixWorld();
    // In the camera's frame: the table's look point d ahead, shifted to the box's middle on screen,
    // then shrunk to the model's scale. World = camera · scale · shift · (table as the eye sees it).
    const t = Math.tan((camera.fov * Math.PI) / 360);
    this.m.makeTranslation((-f.offX * 2 * d * t) / h, (f.offY * 2 * d * t) / h, 0);
    this.m.premultiply(this.n.makeScale(SCALE, SCALE, SCALE));
    this.m.premultiply(camera.matrixWorld);
    this.root.matrix.multiplyMatrices(this.m, this.eye.matrixWorldInverse);
    this.root.matrixWorldNeedsUpdate = true;
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
    this.root.removeFromParent();
    for (const m of [this.top, this.rim]) {
      m.geometry.dispose();
      (m.material as Material).dispose();
    }
  }
}
