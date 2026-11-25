# DESIGN.md: Lamp-lit Reels scene (hero right column)

> **For the coding agent.** Replace the **right column** of the existing hero with the scene described here. Leave the left column alone (copy, prompt box, CTAs, stats) and change nothing outside the hero.
> Stack: **Next.js (App Router) · TypeScript · Tailwind CSS · Motion (`motion/react`) · three.js**.
> Everything here is the spec. Use the exact sizes, colours, easings and timings. Where this file and the reference code disagree, this file wins.

---

## 0. What you are building

A single **560 × 760 px** "window" into a dark room:

- A **walnut table**, seen from above at a slant, lit only by a warm **pendant lamp** (glass globe on a black cord) that hangs at the top and sways.
- A **smartphone lies flat on the table** in perspective, playing an Instagram-style **Reels feed** (3 short "videos").
- A **realistic 3D hand** (three.js, from a `.glb`) in a cream knit sleeve **scrolls the Reels**: finger rests on the glass, drags up, the Reel follows the finger 1:1, it lets go and the feed flicks on to the next Reel.
- It's **interactive and has personality**: the lamp can be pulled and swung; hovering the hand makes it flinch; clicking the hand makes it swat or wag its finger; **touching the phone screen annoys it** and the reaction escalates (brushes your finger away, then drags the phone away, then taps impatiently).

The whole scene is drawn in a fixed 560 × 760 coordinate space and **scaled** to fit its column. All numbers below are in those scene pixels.

---

## 1. Files in this kit

```
DESIGN.md                      ← this spec
assets/hand-point.glb          ← 3D hand, fingers re-posed to point (4.6 MB, CC BY 4.0, see §12)
assets/walnut.webp             ← generated walnut tabletop texture, 1600×2000 (54 KB)
reference/Lamp.reference.html  ← working prototype of the full scene (HTML/CSS/JS). Port from it.
reference/hand-scene.ts        ← working three.js hand renderer (camera, lights, shadows, hit-test, poses)
reference/screens/*.png        ← screenshots of the expected result
```

Copy `assets/*` to `public/hero/`. `reference/` is for reading only; don't ship it.

---

## 2. File plan (create these)

```
components/hero/lamp-scene/
  LampScene.tsx        'use client'. Root: scaling wrapper, pointer routing, owns the single RAF loop
  Table.tsx            walnut plane (CSS 3D) + light pool + vignette
  Lamp.tsx             cord, fitting, globe, glow, swing button (rotated by the pendulum)
  Phone.tsx            3D phone body (layers + shadows) and the screen chrome
  ReelsFeed.tsx        4 stacked reels (A, B, C, A-copy) + per-reel overlays
  reels/OctopusReel.tsx  reels/AgentReel.tsx  reels/CatReel.tsx   (inline SVG "videos")
  HandCanvas.tsx       <canvas> that hosts the three.js hand (dynamic, client-only)
  hand/handScene.ts    three.js renderer (port of reference/hand-scene.ts)
  lib/geometry.ts      scene constants + phonePoint() + toPhone math
  lib/pendulum.ts      lamp physics
  lib/timeline.ts      scroll timeline (feed offset, finger pose, progress)
  lib/reactions.ts     swat / wag / nudge / pull / tap pose curves
  SpeechBubble.tsx     Motion-animated bubble
```

Mount it in the hero's right column:

```tsx
const LampScene = dynamic(() => import('@/components/hero/lamp-scene/LampScene'), { ssr: false, loading: () => <LampPoster /> });
```

`LampPoster` is a static `<img>` screenshot of the scene (use `reference/screens/rest.png`), so there's no layout shift while it loads.

---

## 3. Architecture rules (important)

1. **One `requestAnimationFrame` loop**, owned by `LampScene`. It advances the pendulum, the scroll timeline, the reactions and the hand renderer. **Never `setState` per frame.** Write per-frame values straight to DOM refs (`el.style.transform = …`) and to the three.js scene.
   React state is only for rare things: `glReady`, `bubbleText`.
2. **Motion (`motion/react`)** is for UI-level transitions only: the speech bubble (`AnimatePresence`), the panel shake (`useAnimate`) and the touch ripple. It is **not** for the per-frame physics or the feed.
3. **Tailwind** for static styles. Use arbitrary values for the exact specs (`w-[560px]`, `rounded-[30px]`, `bg-[#120c08]`). 3D transforms, `transform-style: preserve-3d` and gradients can live in a small `lamp-scene.module.css` or as inline `style`, whichever is cleaner. Keep the exact values.
4. **three.js is loaded lazily**: dynamic `import('three')` inside `HandCanvas`, after the scene is visible (`IntersectionObserver`) and the browser is idle (`requestIdleCallback`, falling back to `setTimeout(…, 300)`). Until it's ready, or if WebGL fails, show the **2D fallback hand** (see §8.6).
5. **Pause everything offscreen** (`IntersectionObserver` on the scene) and when `document.hidden`.
6. **Coordinate space.** The scene root is exactly 560 × 760 and is scaled with `transform: scale(s)` (`s = min(1, containerWidth / 560)`, `transform-origin: top center`). Its wrapper gets `height: 760 * s`. **All pointer maths converts client coordinates into scene pixels:** `x = (clientX − rect.left) / (rect.width / 560)`, and the same for y.

---

## 4. Design tokens

| Token | Value |
|---|---|
| Scene size | 560 × 760, `border-radius: 30px`, `overflow: hidden`, `isolation: isolate` |
| Scene ground | `#120c08`, ring `inset 0 0 0 1px rgba(255,255,255,0.08)` |
| Outer shadow (when placed in the hero) | `0 40px 100px rgba(0,0,0,0.7)` |
| Warm light | `#ffcf96` (lamp light), `rgba(255,178,104,·)` (pool), `#ffd9a0` (focus rings) |
| Bubble | bg `#f3eadb`, text `#17120c`, 600 14px, radius `14px 14px 14px 4px` |
| Phone UI font | **Inter** 400/500/600/700 (`next/font/google`) |
| Video caption font | **Bricolage Grotesque** 800 (`next/font/google`), white fill, `#1a1410` stroke 7, `paint-order: stroke` |
| Easing: UI press | `cubic-bezier(0.23, 1, 0.32, 1)` (strong ease-out) |
| Easing: on-screen move | `cubic-bezier(0.77, 0, 0.175, 1)` / JS `easeInOutCubic` |
| Press feedback | `scale(0.97)`, 160 ms, strong ease-out |

---

## 5. Layer stack (back to front, all `position:absolute` in the 560×760 root)

1. **Table** (§6)
2. **Light pool** (moves with the lamp)
3. **Vignette**
4. **Phone** (§7) inside its own 3D context
5. **Hand canvas** 560×760 `pointer-events:none` (§8), with the 2D fallback hand when there's no GL
6. **Keyboard-only buttons** (invisible, `pointer-events:none`, focus ring visible): "Poke the hand", "Touch the phone screen"
7. **Speech bubble**
8. **Lamp group** (§9), with its own real button ("Swing the lamp")

---

## 6. Table

### 6.1 Walnut plane (in perspective)
```html
<div class="absolute inset-0" style="perspective:1400px; perspective-origin:280px 170px; background:#120c08">
  <div class="walnut" style="position:absolute; left:-520px; top:-700px; width:1600px; height:1900px;
       transform-origin:800px 1158px; transform:rotateX(33deg)"></div>
</div>
```
```css
.walnut { background:url(/hero/walnut.webp) 0 0/1600px 2000px no-repeat; filter:brightness(.58) saturate(1.08); }
```
This plane is the **same geometric plane** as the phone's table (rotated 33° about the line y = 458), so the grain narrows toward the back.

### 6.2 Light pool (follows the lamp)
```
left:-120px; right:-120px; top:40px; height:700px; mix-blend-mode:screen;
transform:translateX(poolX px)                      // poolX = dx × 2.1 (dx in §9)
inner: radial-gradient(ellipse 40% 42% at 50% 50%, rgba(255,178,104,.46) 0%, rgba(214,120,56,.20) 40%, rgba(0,0,0,0) 74%)
```

### 6.3 Vignette
`radial-gradient(ellipse 78% 66% at 50% 46%, rgba(0,0,0,0) 40%, rgba(0,0,0,.8) 100%)`

---

## 7. Phone (CSS 3D)

### 7.1 Placement
```
3D context: absolute inset-0; perspective:1400px; perspective-origin:280px 170px
Table plane: left:82px; top:252px; 396×412; transform:rotateX(33deg); transform-style:preserve-3d
Phone wrapper (ref = phoneEl): left:100px; top:0; 250×520; transform-origin:0 0; transform-style:preserve-3d
  transform (per frame) = translate(dx px, dy px) scale(0.78) translate(125px,260px) rotate(rot deg) translate(-125px,-260px)
  at rest {dx:0, dy:0, rot:0}; the "pull" reaction moves it (§10.4)
```

### 7.2 Body layers (inside the wrapper, back to front)
| Layer | Style |
|---|---|
| Cast shadow | `inset:-14px -10px -40px -10px; radius:60px; rgba(0,0,0,.62); blur(26px); translate3d(shadowX px, 30px, .4px)` · `shadowX = −dx × 0.18` |
| Contact shadow | `inset:2px; radius:46px; rgba(0,0,0,.92); blur(5px); translate3d(0, 6px, .5px)` |
| Back | `inset:0; radius:46px; #0b0a09; translateZ(2px)` |
| Side band | `radius:46px; linear-gradient(90deg,#6a6156 0%,#2b2620 18%,#141210 50%,#2b2620 82%,#5e564c 100%); translateZ(6px)` |
| Front frame | `radius:46px; padding:6px; linear-gradient(180deg,#8a7e70 0%,#3a342e 6%,#1a1714 30%,#0f0e0c 70%,#24201c 100%); box-shadow: inset 0 0 0 1px rgba(255,230,195,.35), inset 0 0 0 2.5px #000; translateZ(9px)` |
| Side buttons | 3px wide, `linear-gradient(#5e554b,#2a2622)`, translateZ(5px): left top 104 h30 · left top 150 h50 · right top 160 h74 |
| Screen | inside the frame: `radius:40px; overflow:hidden; background:#000` (238 × 508 px) |

### 7.3 Screen chrome (fixed; the reels scroll underneath)
- **Status bar** h40, padding `0 22px 0 26px`, 13px/600: `9:41` · signal · Wi-Fi · battery (SVGs in the reference).
- **Dynamic Island** 84×24 at top 9, centred, `#000`, lens dot 10px `radial-gradient(circle at 35% 35%, #2b3a55, #0a0d14 70%)`.
- **Header** at top 46: "Reels" 21px/700 with a chevron, camera icon on the right.
- **Progress bar** 2px at bottom 50, track `rgba(255,255,255,.25)`, fill `#fff`, `transform-origin: left`, `scaleX(progress)` (ref).
- **Tab bar** h50, `#000`, icons Home · Search · New · Reels (active, filled) · avatar 24 `#f06a35`, plus a home indicator 96×4.
- **Film grain** over the video (SVG `feTurbulence` 1.1, opacity .16, `mix-blend-mode: overlay`).
- **Glass**: `linear-gradient(180deg, rgba(255,255,255,.06), transparent 30%)` + a lamp **glare** spot `200×160`, `top:-40px`, `left: glareX px` (`glareX = 24 + dx × 0.55`), `radial-gradient(closest-side, rgba(255,236,206,.40), rgba(255,220,170,.10) 60%, transparent)`, `mix-blend-mode:screen`.
- **Touch ripple** (ref): 44px circle `rgba(255,255,255,.42)` + `0 0 0 1px rgba(255,255,255,.6)`, opacity 0; see §10.

### 7.4 Reels feed (`ReelsFeed`)
A column `height: 400%` (4 reels × 25%) with ref `feedEl`; its `transform: translateY(px)` is written by the timeline (§8.3).
Order **A, B, C, A-copy** so the loop is seamless.

Each reel = SVG "video" (`viewBox 0 0 252 522`, `preserveAspectRatio="xMidYMid slice"`, fills the reel) + **its own overlay**:
- top gradient h120 `rgba(0,0,0,.45)→0`, bottom gradient h230 `rgba(0,0,0,.66)→0`
- **right rail** at `right:9px; bottom:74px`, gap 16, 11.5px/600: heart, comment, send (outline 1.8 stroke) with counts, ⋯, a 26px audio thumbnail (radius 7, white 2px ring)
- **creator block** at `left:13px; right:56px; bottom:64px`: avatar 30 with an IG gradient ring (`#feda75,#fa7e1e,#d62976,#962fbf`), handle 13/600, "Follow" pill; caption 12.5px with hashtags at 80% and "… more" at 65%; audio line 11.5px with a ♫ icon

| Reel | Video | Handle | Caption | Likes | Comments | Shares |
|---|---|---|---|---|---|---|
| A | Pink octopus underwater, "3 hearts?!" | deepsea.facts | why octopuses have three hearts 🐙 #science | 48.2K | 1,203 | 9.8K |
| B | Cartoon character in a field, "great agent!" | mindrot | he finally built it 🤯 #ai #agents | 12.1K | 1,874 | 92K |
| C | Orange cat with headphones in a cosy room, "vibes only" | meme.kitten | just a happy cat 🎧 #lofi | 284K | 4.2K | 52K |

> The handles and counts are placeholder content. Swap them for your own examples.

The in-video motion is CSS keyframes (these are video content, so they loop):
`.bob` translateY −6px, 2.4s alternate · `.wave` translateY −5px, 1.1s alternate · `.sway` rotate ±3°, 3.2s alternate, `transform-box:fill-box; transform-origin:50% 100%`.
Copy the three SVG scenes **verbatim** from `reference/Lamp.reference.html`.

---

## 8. The hand (three.js)

Port `reference/hand-scene.ts` into `hand/handScene.ts` with typed options. Key facts:

### 8.1 Camera that matches the CSS perspective exactly
The canvas is 560×760 and transparent. The three.js world uses **CSS pixels**, with x right, **y up** (`y = −(cssY − 170)`) and z toward the viewer.
```ts
const PERSP = 1400, OX = 280, OY = 170, W = 560, H = 760, A = 33 * Math.PI / 180;
const fullH = 2 * (H - OY);                                    // 1180
camera = new PerspectiveCamera(2 * Math.atan(fullH / 2 / PERSP) * 180 / Math.PI, W / fullH, 10, 6000);
camera.position.set(0, 0, PERSP); camera.lookAt(0, 0, 0);
camera.setViewOffset(W, fullH, 0, fullH / 2 - OY, W, H);      // principal point at (280,170) like the CSS
const N  = new Vector3(0, Math.sin(A),  Math.cos(A));          // table normal
const UP = new Vector3(0, Math.cos(A), -Math.sin(A));          // "up the phone"
```

### 8.2 Phone-local point → 3D (the single source of truth; reuse it in TS)
```ts
// px, py in the phone's own 250×520 space; z = 9 is the glass; off = phone drag offset
function phonePoint(px, py, z = 9, off?: { dx: number; dy: number; rot: number }) {
  let qx = px, qy = py;
  if (off?.rot) { const r = off.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const dx = px - 125, dy = py - 260; qx = 125 + dx * c - dy * s; qy = 260 + dx * s + dy * c; }
  const u = 100 + (off?.dx ?? 0) + 0.78 * qx - 198, v = (off?.dy ?? 0) + 0.78 * qy - 206;
  const y = v * Math.cos(A) - z * Math.sin(A), zz = v * Math.sin(A) + z * Math.cos(A);
  return new Vector3(280 + u - OX, -(458 + y - OY), zz);
}
```
`toPhone(x, y, off)` is the inverse: raycast the scene pixel onto the glass plane and undo the transform. See the reference. It's used for touch ripples and to aim at the user's touch.

### 8.3 Pose → transform
- Model: `hand-point.glb`, one mesh, **no skeleton**. Build `new Mesh(geometry, material)` directly (ignore the glTF node matrices). In mesh space the **length axis is +z**, the **palm side is +y** and the **thumb side is −x**.
- **Fingertip** = the vertex with the largest z among vertices with x < −0.65, then `z -= 0.08; y += 0.12` (the pad).
- Orientation per frame:
  ```ts
  yaw = 32° + pose.yawOff;  pitch = 17° − 4°·k + pose.pitchOff
  d = normalize(UP·cos(yaw) + LEFT·sin(yaw))         // LEFT = (−1,0,0)
  f = normalize(d·cos(pitch) − N·sin(pitch))         // finger direction (mesh +z)
  p = normalize(−N − f·dot(−N,f))                    // palm direction (mesh +y)
  x = p × f                                          // mesh +x
  rig.quaternion = fromBasis(x, p, f); then pre-multiply roll (pose.roll) about f
  rig.scale = 66
  q = lerp(phonePoint(168,330,9,off), phonePoint(158,200,9,off), k)
  if (pose.aim) q = lerp(q, phonePoint(aim.px, aim.py, 9, off), aim.w)
  q += N·lift
  rig.position = q − rotate(tipLocal·66) − f·back + x̂·lateral   // (lateral is along −LEFT)
  ```
- **Sleeve** (hides the cut wrist): `CylinderGeometry(1, 1.12, 4.8, 40)` rotated to z, translated to z −2.55, scaled (1.22, 0.92, 1), offset (−0.08, −0.28). Cuff: `TorusGeometry(1.02, 0.2)`, same scale, z −0.2. Material `#f1e7d8`, roughness .95, with a ribbed **bumpMap** (vertical stripes from a canvas, bumpScale 2.2).
- **Skin material**: from the glTF, with `roughness .62`, `metalness 0`.
- **Renderer**: `alpha:true, antialias:true`, `pixelRatio = min(dpr, 2)`, `SRGBColorSpace`, `ACESFilmicToneMapping`, exposure 1.05, **`shadowMap` PCFSoft**.
- **Lights**:
  - `HemisphereLight(#ffdcb4, #120a06, .55)`
  - key `PointLight(#ffcf96, 2.6, 0, 0)` with `castShadow`, map 1024, bias −0.002, at `phonePoint(125,70,0) + N·380`, x += lampDx × 1.6
  - fill `DirectionalLight(#ff9c5c, .35)` from (400, −300, 300)
  - screen bounce `DirectionalLight(#ffe0c0, .25)` from (0, −1, −.2)
- **Shadows**: the hand and sleeve `castShadow`. A `PlaneGeometry(1400, 1400)` with `ShadowMaterial({ opacity: .42 })` lies on the glass (normal N, through `phonePoint(125,260,9)`) to catch them. There's also a soft contact blob (radial canvas texture) under the fingertip that grows and fades as it lifts.
- **`hitTest(x, y)`**: raycast from the scene pixel against the rig. Used for hover and click.

### 8.4 Scroll timeline (drives the feed, the finger and the progress bar together)
One Reel every **4000 ms**; three per loop (12 s). For `s ∈ [0,1)` within a segment, with `DRAG = 130` (phone px the finger travels) and `reelH = feedEl.offsetHeight / 4`:

| s | Finger `k`, `lift` | Feed offset `off` |
|---|---|---|
| 0 – .55 rest | k 0, lift `1.2·sin(12s)` (tiny idle) | 0 |
| .55 – .60 press | k 0, lift → −1.5 | 0 |
| .60 – .78 **drag** | k = easeInOutCubic, lift −1.5 | **DRAG·k** (moves 1:1 with the finger) |
| .78 – .88 **release** | k 1 → .55, lift → 34 | **DRAG → reelH** with easeOutCubic (the flick) |
| .88 – 1 return | k .55 → 0, lift 34 → 0 | reelH |

`feedEl.style.transform = translateY(−(idx·reelH + off) px)`, where `idx = floor(cycle / 4000)` (0..2).
Progress = `s/.78` until .78, then 1, then 0 after .88.

### 8.5 Pause and resume
While a reaction runs (§10), **freeze the timeline** at the reaction's start time. When it ends, add its duration to the timeline origin (`t0 += dur`) so scrolling continues exactly where it stopped. If a new reaction interrupts one that's running: `t0 += now − current.t0`, then start the new one.

### 8.6 Fallback hand (no WebGL or not loaded yet)
A 2D SVG cartoon hand with a cream sleeve, anchored at the fingertip (314, 505). It's driven by the same timeline: `translate(−9k + .35·lift, −97k − .5·lift) scale(1 − .045k)`. SVG source is in the reference.

---

## 9. Lamp (pendulum physics)

Lamp group: `absolute; left:0; right:0; top:0; h:330px; transform-origin:280px 0; transform:rotate(−a deg)`

| Part | Spec |
|---|---|
| Halo | 300×300 at (130,70), `radial-gradient(closest-side, rgba(255,214,160,.30), rgba(255,180,110,.10) 55%, transparent)` |
| Cord | 2px `#050505`, x 279, h 172 |
| Fitting | 18×24 at (271,164), radius `3px 3px 2px 2px`, `linear-gradient(90deg,#0a0a0a,#3b3835 40%,#111 70%,#050505)`; cap 14×8 ellipse `#2b2926` at (273,160) |
| Globe | 88×88 at (236,170), `radial-gradient(circle at 50% 60%, #fffcf4 0%, #fdf1dc 28%, #efd9b6 62%, #c9a983 100%)`, `box-shadow: 0 0 34px 10px rgba(255,222,170,.40), 0 0 120px 40px rgba(255,186,110,.16)` |
| Swing button | real `<button aria-label="Swing the lamp">` 108×118 at (226,150), transparent, `cursor:grab`, `touch-action:none` |

Physics (angle `a` in degrees, `w` in deg/s; `dt = min(frame, 1/30)`):
```ts
k = held ? 140 : 15
c = held ? 20 : hover ? 2.4 : 0.42          // reduced motion: c = max(c, 9)
w += (−k·(a − target) − c·w)·dt;  a += w·dt
start: a = 7 (it swings into place; 0 if reduced motion)
aim(px,py) = atan2(px − 280, max(py, 60)) in degrees
hover over scene: target = clamp(aim × .35, ±7) · leave: target 0
grab globe (pointerdown → window pointermove/up): target = clamp(aim, ±24); release: free, target 0
click/Enter on the globe (not a drag): w += ±38 (alternating; ±12 with reduced motion)
dx = sin(a)·214 → poolX = 2.1·dx, shadowX = −.18·dx, glareX = 24 + .55·dx, hand key light x += 1.6·dx
```

---

## 10. Interactions and reactions

All pointer events go through **one `onPointerDown` on the scene root** (ignore events from the swing button):
1. `hand.hitTest(x,y)` is true → **poke the hand** (§10.1)
2. else `toPhone(x,y,phoneOffset)` falls inside the screen (6 < px < 244, 6 < py < 514) → **touch the screen** (§10.2)

**Hover**: on `pointermove`, if `hitTest` turns true → **flinch** for 380 ms: `lift += 14·sin(πe)`, `back += 12·sin(πe)`, `roll += 7·sin(3πe)(1−e)`.

**Speech bubble** (Motion `AnimatePresence`): at (368, 408), enter `{opacity:0, y:6, scale:.9} → {1, 0, 1}` over 220 ms with ease `[0.23,1,0.32,1]`, `transform-origin` bottom-left; **exit instantly**. Use `role="status"`. With reduced motion, opacity only.

**Panel shake** (Motion `useAnimate` on the root): `x: [0,−5,4,−2,0]`, 320 ms ease-out. Swat only, none with reduced motion.

**Ripple** (Motion or WAAPI) at the touched phone point (screen-local = px−6, py−6): `scale .35→1.5`, `opacity .6→0`, 520 ms, `[0.23,1,0.32,1]`. With reduced motion, opacity only.

Every reaction returns pose deltas `{lift, back, lateral, yawOff, pitchOff, roll, aim?, phone}`. `amp = reduced ? .35 : 1` multiplies every movement. Each one eases the phone back to rest from wherever it was (`settle` = phone offset lerped to 0 over the first 60%).

### 10.1 Poke the hand: alternates swat / wag
| Type | Dur | Bubble | Curve (e = 0..1) |
|---|---|---|---|
| **swat** | 1150 ms | "hey! I'm scrolling" | 0–.15 yank back (back 70, lift 70, yaw −22, pitch 14) → .15–.30 swing **fast** (`e³`) to yaw +58, lateral −60, back 15, lift 30 → .30–.55 small wobble `yaw 58 + 6 sin(4πc)(1−c)` → .55–1 settle to 0. Shake the panel at e ≈ .28 |
| **wag** | 1400 ms | "uh-uh, my reel" | up = ease(0–.18)·(1 − ease(.72–1)); back 8·up, lift 95·up, lateral −30·up, pitch −42·up, yaw (6 + 20·sin(6π·w))·up |

### 10.2 Touch the screen: escalating annoyance
Count touches; reset if more than **6000 ms** since the last one. Always show the ripple and pause the Reel.

| Touch # | Type | Dur | Bubble | What happens |
|---|---|---|---|---|
| 1 | **nudge** | 1500 | "excuse me?" | lift 26, glance (yaw 8) → move the fingertip **to your touch point** (aim.w 0→1, lift 26→6) → brush it away (lateral 70, yaw 34, lift 18) → return |
| 2 | **pull** | 3600 | "get your own phone" | finger down on its own spot (lift −2) → **drag the phone** to `{dx:58, dy:34, rot:11°}` over .12–.32 (the finger stays on the glass because the touch point moves with the phone), pitch −5 → hold with two light presses → .75–1 slide the phone back to 0 |
| 3–4 | **tap** | 1800 | "seriously?!" | impatient taps `lift = 16·|sin(6π·t)|` for 0–.62 → frustrated shake `yaw = 10·sin(8π·sh)(1−sh)`, roll .6× that → settle |
| 5+ | tap | 1800 | "okay. STOP." | same |

Touching during a reaction escalates straight away (§8.5).

---

## 11. Accessibility, motion and performance

- The whole scene is decorative: `aria-hidden` on the visuals. Keep **three real buttons**, reachable by keyboard with a visible focus ring (`outline: 2px solid #ffd9a0`):
  - "Swing the lamp" (visible hit area on the globe)
  - "Poke the hand" (`pointer-events:none`; Enter triggers the poke)
  - "Touch the phone screen" (`pointer-events:none`; Enter triggers a touch at phone point (90, 260))
- **`prefers-reduced-motion`** (`useReducedMotion()` from Motion):
  - no scrolling: Reel A stays on screen at progress .4
  - the hand rests and doesn't swipe
  - pendulum heavily damped, no starting swing
  - reactions at 35% amplitude
  - no shake, ripple fades only, bubble fades only
  - in-video loops off
- Hover effects only under `@media (hover:hover) and (pointer:fine)`. Press states use `scale(.97)`.
- **Performance**:
  - lazy-load three.js and the glb (§3.4)
  - `pixelRatio ≤ 2`
  - pause when offscreen or the tab is hidden
  - don't re-render React per frame
  - compress the glb for production: `npx gltf-transform optimize assets/hand-point.glb public/hero/hand-point.glb --texture-compress webp` (target < 1 MB)
- **Responsive**: scale the 560×760 root down (§3.6). Below 560px wide it simply gets smaller. Pointer maths already accounts for the scale.

---

## 12. Licence (required)

The hand model is **"Hand" by dagtholander** (https://sketchfab.com/3d-models/hand-94b9ea65c31b421ba6e0daf7479f5013), licensed **CC BY 4.0**. Its fingers were re-posed to point. **Credit it on the live site** (footer or credits page), for example:
`3D hand: "Hand" by dagtholander, CC BY 4.0, modified.`

---

## 13. Build steps for the agent

1. Copy the assets to `public/hero/`. Add Inter + Bricolage Grotesque via `next/font/google` (scoped CSS variables).
2. Build the static layers (Table, Phone body + chrome, ReelsFeed with the 3 SVG reels, Lamp) from §5–§9. Check them against `reference/screens/rest.png` before adding any motion.
3. Add `LampScene`'s single RAF loop: pendulum (§9) → timeline (§8.4) → writes to `feedEl`, `progressEl`, `phoneEl`, the lamp group, pool, shadow and glare.
4. Add `HandCanvas` + `handScene.ts` (lazy). Wire `update(pose, lampDx)` into the loop. Add the 2D fallback.
5. Add pointer routing, hover flinch, reactions (§10), bubble, ripple and shake with Motion.
6. Add reduced motion, offscreen pausing, keyboard buttons and the licence credit.
7. Swap it into the hero's right column. Match the hero's left column vertically (`items-center`) and keep the left column untouched.

### Acceptance checklist
- [ ] At rest, it matches `reference/screens/rest.png` (lamp, globe glow, walnut with perspective, phone shadows, hand on the glass).
- [ ] The Reel follows the finger 1:1 during the drag, flicks to the next Reel on release, and the loop A → B → C → A is seamless.
- [ ] The lamp swings in on load, leans toward the cursor, can be grabbed and thrown, and the light pool, phone shadow and screen glare move with it.
- [ ] Hand: flinch on hover; swat/wag on click; touches on the screen escalate nudge → pull (the phone really moves and the hand stays on it) → tap, and calm down after 6 s.
- [ ] No per-frame React re-renders (check with the React Profiler). 60 fps on a mid laptop. three.js isn't in the initial JS bundle.
- [ ] Reduced motion respected. Keyboard can trigger all three interactions. No layout shift while loading.
