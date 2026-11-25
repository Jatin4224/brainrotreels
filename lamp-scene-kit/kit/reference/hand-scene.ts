import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Geometry of the CSS scene the hand sits in (560×760 panel, perspective 1400px at 280,170,
// table tilted 33°, phone at plane offset 100,0 scaled 0.78, screen 9px above the table).
const A = (33 * Math.PI) / 180, PERSP = 1400, OX = 280, OY = 170, W = 560, H = 760;
const N = new THREE.Vector3(0, Math.sin(A), Math.cos(A)).normalize();   // table normal
const UP = new THREE.Vector3(0, Math.cos(A), -Math.sin(A)).normalize(); // "up the phone"
const LEFT = new THREE.Vector3(-1, 0, 0);
function phonePoint(px, py, z = 9, off) {
  let qx = px, qy = py;
  if (off && off.rot) { const r = (off.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); const dx = px - 125, dy = py - 260; qx = 125 + dx * c - dy * s; qy = 260 + dx * s + dy * c; }
  const u = 100 + (off ? off.dx || 0 : 0) + 0.78 * qx - 198, v = (off ? off.dy || 0 : 0) + 0.78 * qy - 206;
  const y = v * Math.cos(A) - z * Math.sin(A), zz = v * Math.sin(A) + z * Math.cos(A);
  return new THREE.Vector3(280 + u - OX, -(458 + y - OY), zz);
}
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// One swipe, s = time since it started as a fraction of the 9s loop
function swipe(s) {
  if (s < 0 || s >= 0.36) return null;
  if (s < 0.05) return { k: 0, lift: -1.5 * ease(s / 0.05) };
  if (s < 0.18) return { k: ease((s - 0.05) / 0.13), lift: -1.5 };
  if (s < 0.26) { const e = ease((s - 0.18) / 0.08); return { k: 1 - 0.45 * e, lift: 34 * Math.sin((e * Math.PI) / 2) }; }
  const e = ease((s - 0.26) / 0.1); return { k: 0.55 * (1 - e), lift: 34 * (1 - e) };
}
export function poseAt(t) {
  for (const s0 of [0.24, 0.66]) {
    const p = swipe(t - s0) || swipe(t + 1 - s0);
    if (p) return p;
  }
  return { k: 0, lift: 1.2 * Math.sin(t * Math.PI * 4) };
}

function sleeveTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 8) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#5a5a5a'); gr.addColorStop(0.5, '#b0b0b0'); gr.addColorStop(1, '#5a5a5a'); g.fillStyle = gr; g.fillRect(x, 0, 8, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 3); return t;
}
function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.5, 'rgba(0,0,0,0.5)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

export function create(canvas, url, opts = {}) {
  const T0 = opts.touch || [168, 330], E0 = opts.end || [158, 200];
  let touch = phonePoint(T0[0], T0[1]), end = phonePoint(E0[0], E0[1]);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const fullH = 2 * (H - OY);
  const camera = new THREE.PerspectiveCamera((2 * Math.atan(fullH / 2 / PERSP) * 180) / Math.PI, W / fullH, 10, 6000);
  camera.position.set(0, 0, PERSP); camera.lookAt(0, 0, 0);
  camera.setViewOffset(W, fullH, 0, fullH / 2 - OY, W, H);

  scene.add(new THREE.HemisphereLight(0xffdcb4, 0x120a06, 0.55));
  const key = new THREE.PointLight(0xffcf96, 2.6, 0, 0); scene.add(key);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 20; key.shadow.camera.far = 3000; key.shadow.bias = -0.002; key.shadow.radius = 6;
  // the lamp hangs above the top of the phone
  const lampBase = phonePoint(125, 70, 0).addScaledVector(N, 380);
  // an invisible surface on the glass/table that only shows shadows
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.ShadowMaterial({ opacity: 0.42 }));
  catcher.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), N);
  catcher.position.copy(phonePoint(125, 260, 9)).addScaledVector(N, 0.3);
  catcher.receiveShadow = true; scene.add(catcher);
  const fill = new THREE.DirectionalLight(0xff9c5c, 0.35); fill.position.set(400, -300, 300); scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xffe0c0, 0.25); bounce.position.set(0, -1, -0.2); scene.add(bounce); // light off the phone screen

  const rig = new THREE.Group(); scene.add(rig);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 }));
  shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), N);
  scene.add(shadow);

  let tipLocal = null, scale = opts.scale ?? 66, ready = false;
  new GLTFLoader().load(url, (gltf) => {
    let src = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry, mat = src.material;
    mat.roughness = 0.62; if (mat.metalness !== undefined) mat.metalness = 0;
    const hand = new THREE.Mesh(geo, mat); hand.castShadow = true;
    rig.add(hand);
    // fingertip: the farthest point of the index finger (local x < -0.65)
    const pos = geo.attributes.position; let best = -1e9;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (x < -0.65 && z > best) { best = z; tipLocal = new THREE.Vector3(x, pos.getY(i), z); }
    }
    tipLocal.z -= 0.08; // the pad, just behind the very tip
    tipLocal.y += 0.12;
    // knit sleeve over the cut wrist
    const sleeveGeo = new THREE.CylinderGeometry(1, 1.12, 4.8, 40, 1, false);
    sleeveGeo.rotateX(Math.PI / 2); sleeveGeo.translate(0, 0, -2.55);
    const knit = new THREE.MeshStandardMaterial({ color: 0xf1e7d8, roughness: 0.95, bumpMap: sleeveTexture(), bumpScale: 2.2 });
    const sleeve = new THREE.Mesh(sleeveGeo, knit); sleeve.scale.set(1.22, 0.92, 1); sleeve.position.set(-0.08, -0.28, 0);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.2, 16, 48), knit); cuff.scale.set(1.22, 0.92, 1); cuff.position.set(-0.08, -0.28, -0.2);
    sleeve.castShadow = cuff.castShadow = true;
    rig.add(sleeve, cuff);
    ready = true;
    opts.onReady && opts.onReady();
  }, undefined, (err) => opts.onError && opts.onError(err));

  const m = new THREE.Matrix4(), x = new THREE.Vector3(), p = new THREE.Vector3(), f = new THREE.Vector3(), d = new THREE.Vector3();
  function update(t, lamp, given) {
    if (!ready) return;
    const pose = opts.still ? { k: 0, lift: 0 } : given || poseAt(((t % 1) + 1) % 1);
    const yaw = THREE.MathUtils.degToRad((opts.yaw ?? 32) + (pose.yawOff || 0)), pitch = THREE.MathUtils.degToRad((opts.pitch ?? 17) - 4 * pose.k + (pose.pitchOff || 0));
    d.copy(UP).multiplyScalar(Math.cos(yaw)).addScaledVector(LEFT, Math.sin(yaw)).normalize();
    f.copy(d).multiplyScalar(Math.cos(pitch)).addScaledVector(N, -Math.sin(pitch)).normalize();
    p.copy(N).negate(); p.addScaledVector(f, -p.dot(f)).normalize();
    x.crossVectors(p, f).normalize();
    m.makeBasis(x, p, f);
    rig.quaternion.setFromRotationMatrix(m);
    if (pose.roll) rig.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(f, THREE.MathUtils.degToRad(pose.roll)));
    rig.scale.setScalar(scale);
    const off = pose.phone || null;
    touch = phonePoint(T0[0], T0[1], 9, off); end = phonePoint(E0[0], E0[1], 9, off);
    const q = touch.clone().lerp(end, pose.k);
    if (pose.aim && pose.aim.w) q.lerp(phonePoint(pose.aim.px, pose.aim.py, 9, off), pose.aim.w);
    q.addScaledVector(N, pose.lift);
    const tipOff = tipLocal.clone().multiplyScalar(scale).applyQuaternion(rig.quaternion);
    rig.position.copy(q).sub(tipOff);
    if (pose.back) rig.position.addScaledVector(f, -pose.back);
    if (pose.lateral) rig.position.addScaledVector(LEFT, -pose.lateral);
    // shadow on the glass, a little below-right of the fingertip, softer as the finger lifts
    const sp = q.clone().addScaledVector(N, -pose.lift).addScaledVector(N, 0.6).add(new THREE.Vector3(14 + pose.lift * 0.5, -10 - pose.lift * 0.4, 0));
    shadow.position.copy(sp);
    const sz = 46 + Math.max(pose.lift, 0) * 1.2; shadow.scale.set(sz, sz * 0.7, 1);
    shadow.material.opacity = 0.35 * (1 - Math.min(Math.max(pose.lift, 0) / 50, 0.7));
    key.position.copy(lampBase); if (lamp && lamp.dx) key.position.x += lamp.dx * 1.6;
    renderer.render(scene, camera);
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hitTest(x, y) { // x, y in the 560×760 panel's own pixels
    if (!ready) return false;
    ndc.set((x / W) * 2 - 1, -((y / H) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(rig, true).length > 0;
  }
  const surf = new THREE.Plane();
  function toPhone(x, y, off) {
    const c = phonePoint(125, 260, 9, off);
    surf.setFromNormalAndCoplanarPoint(N, c);
    ndc.set((x / W) * 2 - 1, -((y / H) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const w = new THREE.Vector3();
    if (!ray.ray.intersectPlane(surf, w)) return null;
    const u = w.x, yp = -w.y + OY - 458, z = w.z;
    const v = yp * Math.cos(A) + z * Math.sin(A);
    let X = u + 198 - 100 - (off ? off.dx || 0 : 0), Y = v + 206 - (off ? off.dy || 0 : 0);
    let px = X / 0.78, py = Y / 0.78;
    if (off && off.rot) { const r = (-off.rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r); const dx = px - 125, dy = py - 260; px = 125 + dx * cs - dy * sn; py = 260 + dx * sn + dy * cs; }
    return { px, py };
  }
  return { update, hitTest, toPhone, dispose() { renderer.dispose(); }, get ready() { return ready; } };
}
window.HandScene = { create, poseAt };
