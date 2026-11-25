/**
 * SOURCE OF TRUTH KEYWORDS: LampScene, SCENE_W, SCENE_H, phonePoint,
 *   PHONE_OFFSET_REST, SCENE_IS_A_FIXED_COORDINATE_SPACE
 *
 * WHAT:  The one description of the lamp scene's geometry — the 560×760 pixel
 *        space every other module measures in, the CSS perspective constants
 *        the three.js camera has to agree with, and the plain-number maths for
 *        mapping a point on the phone's glass into that space.
 *
 * WHY:   SCENE_IS_A_FIXED_COORDINATE_SPACE. The scene is drawn once at
 *        560×760 and scaled to whatever column it lands in, so nothing inside
 *        it ever reasons about the real viewport: the CSS lays the phone out
 *        with `perspective: 1400px` from origin (280, 170) over a table tilted
 *        33°, and the three.js hand has to sit on the same imaginary glass.
 *        Two renderers agreeing about a plane is only possible if one file
 *        states the plane, which is this one. Change a constant here and the
 *        CSS, the camera and the hit-testing all move together; state them
 *        twice and the hand drifts off the phone.
 *
 *        The maths is deliberately dependency-free (no THREE import) so the
 *        pointer routing in LampScene can convert a click into phone
 *        coordinates whether or not WebGL ever loaded.
 * WHERE: Imported by every module under components/hero/lamp-scene, and
 *        mirrored — not re-derived — by hand/handScene.ts, which needs the
 *        same numbers as THREE.Vector3s.
 */

/** The scene's own pixel space. Everything inside is laid out against these. */
export const SCENE_W = 560;
export const SCENE_H = 760;

/** CSS `perspective` and `perspective-origin` of the table's 3D context. */
export const PERSP = 1400;
export const ORIGIN_X = 280;
export const ORIGIN_Y = 170;

/** The table's tilt, in radians. The CSS writes it as `rotateX(33deg)`. */
export const TILT = (33 * Math.PI) / 180;

/** Where the tilted table plane crosses the scene's untilted y axis. */
export const TABLE_Y = 458;

/** The phone's own coordinate space, before the 0.78 scale. */
export const PHONE_W = 250;
export const PHONE_H = 520;
export const PHONE_SCALE = 0.78;
/** The phone wrapper's offset inside the tilted table plane. */
export const PHONE_LEFT = 100;
/** Height of the glass above the table, in phone pixels. */
export const GLASS_Z = 9;

/** The rectangle of the glass that counts as "the screen" for a touch. */
export const SCREEN_MIN = 6;
export const SCREEN_MAX_X = 244;
export const SCREEN_MAX_Y = 514;

/** How far the finger travels down the glass in one swipe, in phone pixels. */
export const DRAG = 130;
/** One reel every 4s; three reels to a loop. */
export const SEGMENT_MS = 4000;
export const REEL_COUNT = 3;

/** Half the width the globe sweeps through at a full radian of lamp angle. */
export const LAMP_ARM = 214;

/** How the phone has been shoved about by a reaction. */
export interface PhoneOffset {
  dx: number;
  dy: number;
  rot: number;
}

export const PHONE_OFFSET_REST: PhoneOffset = { dx: 0, dy: 0, rot: 0 };

/** A point on the phone's glass, in the phone's own 250×520 space. */
export interface PhonePoint {
  px: number;
  py: number;
}

/** A point in the scene's 3D space, in scene pixels with y pointing UP. */
export interface ScenePoint3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Phone-local (px, py, z) → the scene's 3D space. The single source of truth
 * for where a point on the glass actually is; handScene.ts converts the result
 * to a THREE.Vector3 rather than repeating the arithmetic.
 */
export function phonePoint(
  px: number,
  py: number,
  z: number = GLASS_Z,
  off?: PhoneOffset | null,
): ScenePoint3 {
  let qx = px;
  let qy = py;

  /* The phone rotates about its own centre, so undo nothing here — rotate the
     requested point the same way the CSS rotates the panel it is printed on. */
  if (off?.rot) {
    const r = (off.rot * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const dx = px - PHONE_W / 2;
    const dy = py - PHONE_H / 2;
    qx = PHONE_W / 2 + dx * c - dy * s;
    qy = PHONE_H / 2 + dx * s + dy * c;
  }

  /* Into the untilted table plane: the wrapper's left offset, the drag, and
     the 0.78 scale, less the constants that put the plane's own origin where
     the CSS `perspective-origin` is. */
  const u = PHONE_LEFT + (off?.dx ?? 0) + PHONE_SCALE * qx - 198;
  const v = (off?.dy ?? 0) + PHONE_SCALE * qy - 206;

  /* Then tilt it: the plane pivots 33° about its own horizontal axis, which
     trades depth for height exactly as the CSS rotateX does. */
  const y = v * Math.cos(TILT) - z * Math.sin(TILT);
  const zz = v * Math.sin(TILT) + z * Math.cos(TILT);

  return {
    x: ORIGIN_X + u - ORIGIN_X,
    y: -(TABLE_Y + y - ORIGIN_Y),
    z: zz,
  };
}

/** True when a phone-local point lands on the screen rather than the bezel. */
export function isOnScreen(p: PhonePoint): boolean {
  return (
    p.px > SCREEN_MIN &&
    p.px < SCREEN_MAX_X &&
    p.py > SCREEN_MIN &&
    p.py < SCREEN_MAX_Y
  );
}

/**
 * A client coordinate → scene pixels. The scene is drawn at 560×760 and
 * scaled, so every pointer handler has to divide the scale back out before it
 * can compare against anything else in this file.
 */
export function toScene(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { x: number; y: number } {
  const s = rect.width / SCENE_W;
  return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
}

/**
 * The lamp's aim at a scene point, in degrees: how far the cord would have to
 * lean for the globe to point at it. Clamped away from the very top so a
 * cursor level with the fitting does not ask for an infinite angle.
 */
export function aimAngle(x: number, y: number): number {
  return (Math.atan2(x - ORIGIN_X, Math.max(y, 60)) * 180) / Math.PI;
}

/** The sideways travel of the globe at a given lamp angle, in scene pixels. */
export function lampShift(angleDeg: number): number {
  return Math.sin((angleDeg * Math.PI) / 180) * LAMP_ARM;
}

export const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;
