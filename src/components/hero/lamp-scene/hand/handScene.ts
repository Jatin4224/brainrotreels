/**
 * SOURCE OF TRUTH KEYWORDS: HandScene, createHandScene, CAMERA_MATCHES_THE_CSS,
 *   hitTest, toPhone
 *
 * WHAT:  The three.js renderer for the hand: a camera built to agree with the
 *        CSS perspective exactly, the posed hand model with a knit sleeve over
 *        its cut wrist, lamp-matched lighting with real shadows on the glass,
 *        and the two hit-tests the scene's pointer routing needs.
 *
 * WHY:   CAMERA_MATCHES_THE_CSS. Half of this file exists because a WebGL hand
 *        has to sit on a phone that the BROWSER drew, and the two renderers
 *        have no shared notion of space. CSS `perspective: 1400px` from origin
 *        (280, 170) is a specific frustum, and `setViewOffset` is how a
 *        three.js camera is told to use the same off-centre principal point —
 *        without it the hand is correct at the middle of the panel and
 *        visibly sliding off the phone at the edges, which is exactly the
 *        failure a viewer reads as "pasted on".
 *
 *        The model is used as raw geometry rather than as a glTF scene on
 *        purpose: it has no skeleton, its node matrices carry an authoring
 *        orientation nobody needs, and the one thing the scene DOES need from
 *        it — the index fingertip — is found by searching vertices, so the rig
 *        can be positioned by its fingertip instead of its origin. Everything
 *        in this scene is aimed at the glass; the hand hangs off that point.
 * WHERE: Loaded lazily by HandCanvas.tsx once the scene is on screen and the
 *        browser is idle. Driven once a frame by LampScene's RAF loop.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import {
  GLASS_Z,
  ORIGIN_Y,
  PERSP,
  PHONE_LEFT,
  PHONE_SCALE,
  SCENE_H,
  SCENE_W,
  TABLE_Y,
  TILT,
  phonePoint as phonePoint2,
  type PhoneOffset,
  type PhonePoint,
} from "../lib/geometry";
import type { HandPose } from "../lib/reactions";

/** The table's normal, and "up the phone" — the basis the hand is aimed in. */
const N = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT)).normalize();
const UP = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT)).normalize();
const LEFT = new THREE.Vector3(-1, 0, 0);

/** geometry.ts states the maths; this only lifts it into a THREE.Vector3. */
function phonePoint(
  px: number,
  py: number,
  z: number = GLASS_Z,
  off?: PhoneOffset | null,
): THREE.Vector3 {
  const p = phonePoint2(px, py, z, off);
  return new THREE.Vector3(p.x, p.y, p.z);
}

export interface HandSceneOptions {
  /** Reduced motion: the hand is posed once and never swipes. */
  still?: boolean;
  onReady?: () => void;
  onError?: (err: unknown) => void;
  /** Where the fingertip rests, and where a full swipe ends, in phone px. */
  touch?: [number, number];
  end?: [number, number];
  scale?: number;
  yaw?: number;
  pitch?: number;
}

export interface LampState {
  dx: number;
}

export interface HandScene {
  update(pose: HandPose, lamp: LampState): void;
  hitTest(x: number, y: number): boolean;
  toPhone(x: number, y: number, off?: PhoneOffset | null): PhonePoint | null;
  dispose(): void;
  readonly ready: boolean;
}

/** A vertical rib pattern, as a bump map, so the cuff reads as knitwear. */
function sleeveTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  /* Survivable: without a 2D context the sleeve just loses its ribbing. */
  if (!g) return new THREE.CanvasTexture(c);
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 8) {
    const gr = g.createLinearGradient(x, 0, x + 8, 0);
    gr.addColorStop(0, "#5a5a5a");
    gr.addColorStop(0.5, "#b0b0b0");
    gr.addColorStop(1, "#5a5a5a");
    g.fillStyle = gr;
    g.fillRect(x, 0, 8, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3);
  return t;
}

/** The soft contact blob under the fingertip. */
function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) return new THREE.CanvasTexture(c);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(0,0,0,1)");
  r.addColorStop(0.5, "rgba(0,0,0,0.5)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * The model's vertices → the canonical mesh space the posing code assumes
 * (length axis +z, palm +y, thumb −x, roughly unit-scaled).
 *
 * The uncompressed model stores that space directly and hangs it under a
 * chain of Sketchfab exporter rotations that are meant to be ignored. The
 * COMPRESSED one cannot: `KHR_mesh_quantization` stores positions as
 * normalized int16 and expresses the dequantization as a node scale, so the
 * node transform is no longer decoration — drop it and the hand renders at
 * a third of its size, in the wrong orientation, which is exactly the "only
 * the sleeve is visible" failure this function fixes.
 *
 * So the node transform is baked in, into float positions (applying a matrix
 * straight onto an int16 attribute would truncate it), and the net 90° of
 * exporter rotation that baking drags along is taken back out. The result is
 * byte-for-byte the same space for both files, so everything downstream —
 * the fingertip search, scale 66, the +z finger axis — is unchanged.
 */
function bakeToMeshSpace(
  mesh: THREE.Mesh,
  root: THREE.Object3D,
): THREE.BufferGeometry {
  root.updateMatrixWorld(true);

  const geo = mesh.geometry.clone();
  const src = geo.attributes["position"];
  if (!src) return geo;

  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const out = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    /* fromBufferAttribute denormalizes an int16 attribute for us. */
    v.fromBufferAttribute(src, i).applyMatrix4(m);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(out, 3));

  /* Carry the authored normals across rather than recomputing them: the
     model's smoothing is the artist's, and `computeVertexNormals` would
     average it into something subtly flatter across the knuckles. */
  const srcN = geo.attributes["normal"];
  if (srcN) {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const outN = new Float32Array(srcN.count * 3);
    for (let i = 0; i < srcN.count; i++) {
      v.fromBufferAttribute(srcN, i).applyMatrix3(nm).normalize();
      outN[i * 3] = v.x;
      outN[i * 3 + 1] = v.y;
      outN[i * 3 + 2] = v.z;
    }
    geo.setAttribute("normal", new THREE.BufferAttribute(outN, 3));
  }

  /* Undo the exporter's rotation that matrixWorld just folded in. The source
     file's chain is RotX(−90)·RotX(+90)·RotX(−90) = RotX(−90) net, so the
     inverse is a quarter turn the other way. */
  geo.rotateX(Math.PI / 2);

  if (!geo.attributes["normal"]) geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function createHandScene(
  canvas: HTMLCanvasElement,
  url: string,
  opts: HandSceneOptions = {},
): HandScene {
  const T0 = opts.touch ?? [168, 330];
  const E0 = opts.end ?? [158, 200];

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(SCENE_W, SCENE_H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  /* The spec asks for PCFSoft, which three deprecated in r186 — it now just
     warns on every boot and falls back to this anyway. Naming the real
     constant keeps the console clean; the softness the scene actually wants
     comes from the key light's `shadow.radius` below, not from the type. */
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();

  /* The CSS frustum, restated for three.js. A browser's `perspective` is a
     camera `PERSP` away from the z=0 plane whose principal point sits at
     `perspective-origin` — so the camera is built for the FULL height that
     would centre that origin, then `setViewOffset` crops the 560×760 panel
     back out of it. */
  const fullH = 2 * (SCENE_H - ORIGIN_Y);
  const camera = new THREE.PerspectiveCamera(
    (2 * Math.atan(fullH / 2 / PERSP) * 180) / Math.PI,
    SCENE_W / fullH,
    10,
    6000,
  );
  camera.position.set(0, 0, PERSP);
  camera.lookAt(0, 0, 0);
  camera.setViewOffset(SCENE_W, fullH, 0, fullH / 2 - ORIGIN_Y, SCENE_W, SCENE_H);

  scene.add(new THREE.HemisphereLight(0xffdcb4, 0x120a06, 0.55));

  /* The key light IS the pendant lamp: same colour, same place above the top
     of the phone, and it slides with the globe when the lamp swings. */
  const key = new THREE.PointLight(0xffcf96, 2.6, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 3000;
  key.shadow.bias = -0.002;
  key.shadow.radius = 6;
  scene.add(key);
  const lampBase = phonePoint(125, 70, 0).addScaledVector(N, 380);

  /* An invisible plane lying on the glass that catches the hand's shadow and
     shows nothing else — the shadow has to fall on CSS pixels that three.js
     cannot see, so it falls on a stand-in at the same depth instead. */
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.ShadowMaterial({ opacity: 0.42 }),
  );
  catcher.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), N);
  catcher.position.copy(phonePoint(125, 260, GLASS_Z)).addScaledVector(N, 0.3);
  catcher.receiveShadow = true;
  scene.add(catcher);

  const fill = new THREE.DirectionalLight(0xff9c5c, 0.35);
  fill.position.set(400, -300, 300);
  scene.add(fill);
  /* Light coming back UP off the phone's own screen. Small, but it is what
     stops the underside of the finger going black against a lit display. */
  const bounce = new THREE.DirectionalLight(0xffe0c0, 0.25);
  bounce.position.set(0, -1, -0.2);
  scene.add(bounce);

  const rig = new THREE.Group();
  scene.add(rig);

  const blob = blobTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: blob,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    }),
  );
  shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), N);
  scene.add(shadow);

  let tipLocal: THREE.Vector3 | null = null;
  const scale = opts.scale ?? 66;
  let ready = false;
  let disposed = false;
  const owned: Array<{ dispose(): void }> = [];

  /* THE_MODEL_IS_COMPRESSED. The shipped glb is run through glTF-Transform,
     which takes it from 4.6MB to ~190KB — and leaves
     `EXT_meshopt_compression` in `extensionsRequired`, so a loader without
     this decoder does not degrade, it REFUSES the file outright and the
     scene silently falls back to the drawn hand. The decoder is ~29KB and
     rides in the same lazy chunk as three.js itself, so it costs the initial
     bundle nothing. `KHR_mesh_quantization` and `EXT_texture_webp`, the other
     two the optimizer adds, three.js already handles natively. */
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    url,
    (gltf) => {
      if (disposed) return;
      let src: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
      });
      if (!src) {
        opts.onError?.(new Error("no mesh in hand model"));
        return;
      }

      const found: THREE.Mesh = src;
      const geo = bakeToMeshSpace(found, gltf.scene);
      const mat = found.material as THREE.MeshStandardMaterial;
      mat.roughness = 0.62;
      if (mat.metalness !== undefined) mat.metalness = 0;

      /* Built from the geometry directly: the glTF's node transforms carry an
         authoring pose this scene has no use for, and the rig below sets the
         orientation from scratch every frame anyway. */
      const hand = new THREE.Mesh(geo, mat);
      hand.castShadow = true;
      rig.add(hand);

      /* The fingertip, found rather than hard-coded: the farthest-forward
         vertex on the thumb-side half (x < −0.65) is the tip of the pointing
         index finger, and the whole rig is then placed BY that point. */
      const pos = geo.attributes["position"];
      if (!pos) {
        opts.onError?.(new Error("hand model has no positions"));
        return;
      }
      let best = -1e9;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        if (x < -0.65 && z > best) {
          best = z;
          tipLocal = new THREE.Vector3(x, pos.getY(i), z);
        }
      }
      if (!tipLocal) tipLocal = new THREE.Vector3(-0.7, 0, 1);
      tipLocal.z -= 0.08; // the pad, just behind the very tip
      tipLocal.y += 0.12;

      /* A knit sleeve, because the model is cut off at the wrist and a scene
         this lit has nowhere to hide the seam. */
      const sleeveGeo = new THREE.CylinderGeometry(1, 1.12, 4.8, 40, 1, false);
      sleeveGeo.rotateX(Math.PI / 2);
      sleeveGeo.translate(0, 0, -2.55);
      const bump = sleeveTexture();
      const knit = new THREE.MeshStandardMaterial({
        color: 0xf1e7d8,
        roughness: 0.95,
        bumpMap: bump,
        bumpScale: 2.2,
      });
      const sleeve = new THREE.Mesh(sleeveGeo, knit);
      sleeve.scale.set(1.22, 0.92, 1);
      sleeve.position.set(-0.08, -0.28, 0);
      const cuffGeo = new THREE.TorusGeometry(1.02, 0.2, 16, 48);
      const cuff = new THREE.Mesh(cuffGeo, knit);
      cuff.scale.set(1.22, 0.92, 1);
      cuff.position.set(-0.08, -0.28, -0.2);
      sleeve.castShadow = cuff.castShadow = true;
      rig.add(sleeve, cuff);
      owned.push(geo, mat, sleeveGeo, cuffGeo, knit, bump);

      ready = true;

      /* READY_MEANS_DRAWN. `onReady` is what uncovers the scene, so it must
         not fire until the very next thing a viewer sees is the FINISHED
         hand. Parsing the glb is not enough: the standard material's shader
         is still uncompiled and the textures are not on the GPU, so the
         first rendered frame would otherwise land after the reveal and show
         as a hitch. Compile, draw one real frame at the rest pose, and only
         then say ready. */
      renderer.compile(scene, camera);
      update({ k: 0, lift: 0 }, { dx: 0 });

      opts.onReady?.();
    },
    undefined,
    (err) => opts.onError?.(err),
  );

  const m = new THREE.Matrix4();
  const vx = new THREE.Vector3();
  const vp = new THREE.Vector3();
  const vf = new THREE.Vector3();
  const vd = new THREE.Vector3();
  const roll = new THREE.Quaternion();
  const q = new THREE.Vector3();
  const tipOff = new THREE.Vector3();
  const sp = new THREE.Vector3();

  function update(given: HandPose, lamp: LampState): void {
    if (!ready || !tipLocal || disposed) return;
    const pose: HandPose = opts.still ? { k: 0, lift: 0 } : given;

    /* Orientation. The hand is aimed by building its basis from the table
       rather than by Euler angles: `f` is the finger's direction, `p` the
       palm, and the cross of the two is the rest — which keeps the hand flat
       to the glass at every yaw instead of drifting as angles compound. */
    const yaw = THREE.MathUtils.degToRad(
      (opts.yaw ?? 32) + (pose.yawOff ?? 0),
    );
    const pitch = THREE.MathUtils.degToRad(
      (opts.pitch ?? 17) - 4 * pose.k + (pose.pitchOff ?? 0),
    );

    vd.copy(UP).multiplyScalar(Math.cos(yaw)).addScaledVector(LEFT, Math.sin(yaw)).normalize();
    vf.copy(vd).multiplyScalar(Math.cos(pitch)).addScaledVector(N, -Math.sin(pitch)).normalize();
    vp.copy(N).negate();
    vp.addScaledVector(vf, -vp.dot(vf)).normalize();
    vx.crossVectors(vp, vf).normalize();
    m.makeBasis(vx, vp, vf);
    rig.quaternion.setFromRotationMatrix(m);
    if (pose.roll) {
      roll.setFromAxisAngle(vf, THREE.MathUtils.degToRad(pose.roll));
      rig.quaternion.premultiply(roll);
    }
    rig.scale.setScalar(scale);

    /* Position. The fingertip goes where the swipe says, THEN the rig is
       offset so that its own tip lands there — the hand hangs off the
       contact point, which is why it stays glued through a phone drag. */
    const off = pose.phone ?? null;
    const touch = phonePoint(T0[0], T0[1], GLASS_Z, off);
    const end = phonePoint(E0[0], E0[1], GLASS_Z, off);
    q.copy(touch).lerp(end, pose.k);
    if (pose.aim && pose.aim.w) {
      q.lerp(phonePoint(pose.aim.px, pose.aim.py, GLASS_Z, off), pose.aim.w);
    }
    q.addScaledVector(N, pose.lift);

    tipOff.copy(tipLocal).multiplyScalar(scale).applyQuaternion(rig.quaternion);
    rig.position.copy(q).sub(tipOff);
    if (pose.back) rig.position.addScaledVector(vf, -pose.back);
    if (pose.lateral) rig.position.addScaledVector(LEFT, -pose.lateral);

    /* The contact blob: down on the glass under the fingertip, spreading and
       fading as the finger lifts, which is the cue that reads as "touching". */
    sp.copy(q)
      .addScaledVector(N, -pose.lift + 0.6)
      .add(
        new THREE.Vector3(14 + pose.lift * 0.5, -10 - pose.lift * 0.4, 0),
      );
    shadow.position.copy(sp);
    const sz = 46 + Math.max(pose.lift, 0) * 1.2;
    shadow.scale.set(sz, sz * 0.7, 1);
    shadow.material.opacity =
      0.35 * (1 - Math.min(Math.max(pose.lift, 0) / 50, 0.7));

    key.position.copy(lampBase);
    if (lamp.dx) key.position.x += lamp.dx * 1.6;

    renderer.render(scene, camera);
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /** Is the hand under this scene pixel? Drives hover flinch and poking. */
  function hitTest(x: number, y: number): boolean {
    if (!ready || disposed) return false;
    ndc.set((x / SCENE_W) * 2 - 1, -((y / SCENE_H) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(rig, true).length > 0;
  }

  const surf = new THREE.Plane();
  const hit = new THREE.Vector3();

  /** The inverse of phonePoint: a scene pixel → where it lands on the glass. */
  function toPhone(
    x: number,
    y: number,
    off?: PhoneOffset | null,
  ): PhonePoint | null {
    if (disposed) return null;
    surf.setFromNormalAndCoplanarPoint(N, phonePoint(125, 260, GLASS_Z, off));
    ndc.set((x / SCENE_W) * 2 - 1, -((y / SCENE_H) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(surf, hit)) return null;

    const u = hit.x;
    const yp = -hit.y + ORIGIN_Y - TABLE_Y;
    const v = yp * Math.cos(TILT) + hit.z * Math.sin(TILT);

    const X = u + 198 - PHONE_LEFT - (off?.dx ?? 0);
    const Y = v + 206 - (off?.dy ?? 0);
    let px = X / PHONE_SCALE;
    let py = Y / PHONE_SCALE;

    if (off?.rot) {
      const r = (-off.rot * Math.PI) / 180;
      const cs = Math.cos(r);
      const sn = Math.sin(r);
      const dx = px - 125;
      const dy = py - 260;
      px = 125 + dx * cs - dy * sn;
      py = 260 + dx * sn + dy * cs;
    }
    return { px, py };
  }

  return {
    update,
    hitTest,
    toPhone,
    dispose() {
      disposed = true;
      ready = false;
      for (const o of owned) o.dispose();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      blob.dispose();
      catcher.geometry.dispose();
      (catcher.material as THREE.Material).dispose();
      renderer.dispose();
    },
    get ready() {
      return ready;
    },
  };
}
