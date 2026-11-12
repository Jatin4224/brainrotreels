# rotreels — Auth Screen Upgrade: Design Spec

The design reference is the "Desktop · Sign in / Create account" artboard on the rotreels canvas:
https://claude.ai/artifact/Fcw4nJcgfSMhBn8SGQ2Hcf

**What changes:** the login form on the left stays as it is today. The static marketing text on the right is replaced with an **animated showcase**: a PDF slides down into an input bar, the "Make reels" button pulses, and five motion-graphics reels emerge from under the bar and fan out into a strip. It loops continuously, timed to the reference recording.

---

## 1. Page layout

```
┌──────────────────────────── 100vh, no page scroll ──────────────────────────┐
│ ┌──────── Left 50% ────────┐ ┌──────────────── Right 50% ────────────────┐ │
│ │ [r.] rotreels.           │ │ ┌──────── Showcase panel ──────────────┐ │ │
│ │                          │ │ │         [ PDF card ]  ↓ slides       │ │ │
│ │  Welcome back            │ │ │  ( 🔗 Drop a PDF or script… [Make reels] )│
│ │  Sign in to pick up…     │ │ │     ●   ●   ●   ●   ●  ← chips       │ │ │
│ │  [Sign in|Create acct]   │ │ │   ▯▯▯▯▯  5 touching reels + scores    │ │ │
│ │  [Google] [Apple]        │ │ │                                      │ │ │
│ │  ── or with email ──     │ │ │  One PDF in. [Five reels] out.       │ │ │
│ │  Email / Password        │ │ │  Drop a report, script or doc…       │ │ │
│ │  [ Sign in → ]           │ │ │  12,400+ creators · 38M views        │ │ │
│ │ Terms · Privacy          │ │ └──────────────────────────────────────┘ │ │
│ └──────────────────────────┘ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Root: `height: 100vh; overflow: hidden; display: flex`. The page never scrolls on desktop.
- Left column: `flex: 1 1 50%`, padding `28px 48px`, laid out as a column with `space-between` (logo · form · legal). The form is `max-width: 400px` and centered.
- Right column: `flex: 1 1 50%`, padding `28px`. It holds the showcase panel.
- Below 900px wide, hide the right column; only the form shows.

## 2. Tokens

```css
--bg:#0B0D13; --panel:#121419; --s1:#15171D; --s2:#1A1C22; --s3:#1D2028;
--line:#1F222A; --line-2:#2A2D36;
--fg:#F5F5F2; --fg-2:#D6D4CE; --mut:#9B9891; --ph:#6F6D68;
--hi:#F2CF3B; --hiT:#231B00;          /* yellow highlight */
--act:#FA5F29; --actT:#FFFFFF;        /* orange CTA */
```

Fonts:
- **Bricolage Grotesque** 800 for headlines and the reel titles.
- **Space Grotesk** 400, 500 and 700 for everything else.

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,800&family=Space+Grotesk:wght@400;500;700&display=swap">
```

Headline highlight (used for one word or phrase per headline):
```css
.hl{display:inline-block;background:var(--hi);color:var(--hiT);padding:0 12px;border-radius:12px;transform:rotate(-2deg)}
```

## 3. Left column (keep the current behavior; restyle only if it differs)

| Element | Spec |
|---|---|
| Logo | 40×40 tile, radius 12, bg `--s3`, a Bricolage 800 24px "r" with a 6px `--hi` square bottom-right. Wordmark "rotreels" (Bricolage 800 22px) followed by a `--hi` "." |
| Title | "Welcome back" / "Create your account", Bricolage 800 36px, tracking -0.8px |
| Sub | "Sign in to pick up your drafts." / "Start turning ideas into shorts.", 15px `--mut` |
| Mode tabs | Container `--s1`, 1px `--line`, radius 14, padding 4. Active tab: `--hi` bg, `--hiT` text, radius 10. Each tab is 42px tall |
| Social | Two columns: Google and Apple, 46px tall, `--s1`, 1px `--line-2`, radius 12. **Use the official brand marks** |
| Divider | 1px lines on both sides of "or with email" (13px `--mut`) |
| Inputs | 46px tall, `--s1`, 1px `--line-2`, radius 12, 15px text. Focus ring: 2px `--hi` outline, 2px offset. Labels 13/500 |
| Password | "Show"/"Hide" toggle button on the right (at least 44px hit area). "Forgot password?" link on sign-in only |
| Sign-up only | A "Creator name" field before Email |
| CTA | `--act`, white **18px/700** (large text keeps white-on-orange contrast acceptable), 52px tall, radius 14, trailing → |
| Legal | 12px `--mut`: "By continuing you agree to our Terms and Privacy Policy." |

## 4. Right column: the showcase panel

**Panel:** `flex: 1`, bg `--panel`, 1px `--line`, radius 28, padding `28px 36px 32px`, `overflow: hidden`. Content is a column: the stage (flex 1, centered), then the copy block.

### 4.1 Stage geometry (510px tall, full panel width; all positions absolute)

| Layer | Box | Notes |
|---|---|---|
| **Upper mask** | `top:0; left:0; right:0; height:182px; overflow:hidden` | Contains the PDF card. Clips it as it enters from above and as it slides under the bar |
| PDF card wrapper | `top:10px`, horizontally centered | Animated with `thumbLoop` |
| **Input bar** | `top:180px; left:50%; width:380px; margin-left:-190px; height:52px; z-index:3` | Sits above both masks |
| **Lower mask** | `top:252px; bottom:0; left:-36px; right:-36px; overflow:hidden` | Contains the reel strip. Extends under the panel padding so the right-hand exit isn't cut short |
| Reel strip | `top:40px`, flex row, centered, **gap 0** | Five reel wrappers, each 100px wide |

### 4.2 PDF card (source)
290×128, bg `--fg`, 2px `--hi` border, radius 14, padding 16, shadow `0 24px 50px rgba(0,0,0,.45)`.
- Left: a 52×66 `--act` tile with "PDF" (12/700 white, bottom-aligned).
- Right column:
  - `q3-growth-report.pdf` (14/700, ellipsis)
  - "12 pages · 2.4 MB" (12, `#5E5C57`)
  - three 6px skeleton lines (`#E2DFD8`) at 100%, 80% and 56% width

### 4.3 Input bar
- Pill, bg `--s2`, 1px `--line-2`, padding `6px 6px 6px 18px`, gap 10, shadow `0 10px 30px rgba(0,0,0,.5)`.
- Contents, left to right:
  - link icon (16px `--mut`)
  - "Drop a PDF or script and …" (14px `--fg-2`, ellipsis)
  - **"Make reels"** button: 40px tall, padding 0 16, `--act`, 14/700 white, pill. Animated with `btnPulse`
  - pointer-hand cursor icon (22px, white with a dark stroke), absolutely positioned `right:18px; top:30px`, `transform-origin: 30% 20%`. Animated with `handTap`

### 4.4 Reels (five, touching)

Each **wrapper** is 100px wide with `padding-top:12px` and `position:relative`. Its z-index is highest in the middle: `5 - |i-2|`, giving 3, 4, 5, 4, 3. It is animated with `c0`…`c4`.

- **Platform chip:** a 24px circle centered on the top edge (`top:0`), bg `--fg`, 2px `--panel` border, 8/700 dark text. Labels: YT, IG, in, TT, X.
- **Card:**
  - 100×178, padding `12px 10px 52px`, column `space-between`, overflow hidden.
  - Corner radius only on the outer ends: card 0 is `12px 0 0 12px`, card 4 is `0 12px 12px 0`, the middle cards are square.
  - Contents: a kicker pill (9/700, +0.08em, 1.5px border in the card's text color), the title (Bricolage 800 19px, line-height .95), and a caption (10/500, 80% opacity).
- **Score badge:** absolutely positioned `bottom:8px`, centered, 42px wide, bg `rgba(11,13,19,.88)`, radius 6. It shows "Score" (8px `#B4B2AB`) above the number (14/700 `--act`).

| # | Background | Text | Kicker | Title | Caption | Score |
|---|---|---|---|---|---|---|
| 0 | `#F5F5F2` | `#0B0D13` | PART 1 | Q3 in 60 seconds | the short version | 98 |
| 1 | `#0E2A33` | `#F5F5F2` | PART 2 | +38% revenue | where it came from | 96 |
| 2 | `#F2CF3B` | `#231B00` | PART 3 | 3 big wins | and why they worked | 99 |
| 3 | `#221A33` | `#F5F5F2` | PART 4 | What broke | the honest bit | 94 |
| 4 | `#FA5F29` | `#FFFFFF` | PART 5 | What's next | our Q4 bets | 97 |

### 4.5 Copy block (under the stage)
- H2: "One PDF in. <span class="hl">Five reels</span> out.", Bricolage 800 42px, line-height 1, tracking -1.2px.
- Description (15px `--mut`, 12px top margin): "Drop a report, script or doc. Get motion-graphics reels with voice, captions and editing handled."
- Proof line (14px `--mut`, 8px top margin): "**12,400+ creators** (bold, `--fg`) · 38M views generated".

The whole stage is decorative, so mark it `aria-hidden="true"`. The copy block stays readable to screen readers.

---

## 5. Animation

### 5.1 Timeline (one loop = **1.17s**, `linear infinite`; every layer shares the same duration so they stay in sync)

| % of loop | PDF card | Button and cursor | Reels |
|---|---|---|---|
| 0 → 43% | Slides down from −175px (hidden above the mask) to rest at 0, decelerating | Idle | 0 → 23%: a one-card-wide stack slides down from under the bar (y −65 → 0) and fans out into the touching strip |
| 43 → 66% | Rests | Idle | Hold as a full strip |
| 66 → 100% | Sinks behind the bar (0 → +180px), accelerating; the mask hides it as it passes the bar | 66–89%: button scales to 1.25 and back; cursor taps (scale .85) at 69% | 66–83%: the strip slides right (+130, +252, +383px) and fades. 86%: jumps behind the bar, hidden. 89 → 100%: the stack emerges from under the bar (y −155 → −65) |

These keyframes were measured frame by frame from the reference video, so use the values exactly. They are written for linear interpolation between stops.

### 5.2 Keyframes (copy verbatim)

```css
@keyframes thumbLoop{0.0%{transform:translateY(-175px)}5.7%{transform:translateY(-140px)}11.4%{transform:translateY(-110px)}17.1%{transform:translateY(-100px)}22.9%{transform:translateY(-63px)}28.6%{transform:translateY(-43px)}31.4%{transform:translateY(-16px)}37.1%{transform:translateY(-2px)}42.9%{transform:translateY(0px)}65.7%{transform:translateY(0px)}68.6%{transform:translateY(4px)}71.4%{transform:translateY(15px)}77.1%{transform:translateY(36px)}82.9%{transform:translateY(72px)}88.6%{transform:translateY(106px)}91.4%{transform:translateY(124px)}94.3%{transform:translateY(155px)}100.0%{transform:translateY(180px)}}
@keyframes btnPulse{0%,65.7%{transform:scale(1)}68.6%{transform:scale(1.21)}71.4%{transform:scale(1.25)}77.1%{transform:scale(1.17)}82.9%{transform:scale(1.04)}88.6%,100%{transform:scale(1)}}
@keyframes handTap{0%,65.7%{transform:scale(1)}68.6%{transform:scale(.85)}74.3%,100%{transform:scale(1)}}
@keyframes c0{0.0%{opacity:1;transform:translate(185px,-65px)}5.7%{opacity:1;transform:translate(130px,-40px)}11.4%{opacity:1;transform:translate(48px,-12px)}17.1%{opacity:1;transform:translate(30px,-7px)}22.9%{opacity:1;transform:translate(0px,0px)}65.7%{opacity:1;transform:translate(0,0)}68.6%{opacity:1;transform:translate(130px,0)}71.4%{opacity:1;transform:translate(252px,0)}77.1%{opacity:1;transform:translate(383px,0)}82.9%{opacity:0;transform:translate(520px,0)}85.7%{opacity:0;transform:translate(200px,-230px)}88.6%{opacity:1;transform:translate(200px,-155px)}94.3%{opacity:1;transform:translate(194px,-120px)}100%{opacity:1;transform:translate(185px,-65px)}}
@keyframes c1{0.0%{opacity:1;transform:translate(93px,-65px)}5.7%{opacity:1;transform:translate(65px,-40px)}11.4%{opacity:1;transform:translate(24px,-12px)}17.1%{opacity:1;transform:translate(15px,-7px)}22.9%{opacity:1;transform:translate(0px,0px)}65.7%{opacity:1;transform:translate(0,0)}68.6%{opacity:1;transform:translate(130px,0)}71.4%{opacity:1;transform:translate(252px,0)}77.1%{opacity:1;transform:translate(383px,0)}82.9%{opacity:0;transform:translate(520px,0)}85.7%{opacity:0;transform:translate(100px,-230px)}88.6%{opacity:1;transform:translate(100px,-155px)}94.3%{opacity:1;transform:translate(97px,-120px)}100%{opacity:1;transform:translate(93px,-65px)}}
@keyframes c2{0.0%{opacity:1;transform:translate(0px,-65px)}5.7%{opacity:1;transform:translate(0px,-40px)}11.4%{opacity:1;transform:translate(0px,-12px)}17.1%{opacity:1;transform:translate(0px,-7px)}22.9%{opacity:1;transform:translate(0px,0px)}65.7%{opacity:1;transform:translate(0,0)}68.6%{opacity:1;transform:translate(130px,0)}71.4%{opacity:1;transform:translate(252px,0)}77.1%{opacity:1;transform:translate(383px,0)}82.9%{opacity:0;transform:translate(520px,0)}85.7%{opacity:0;transform:translate(0px,-230px)}88.6%{opacity:1;transform:translate(0px,-155px)}94.3%{opacity:1;transform:translate(0px,-120px)}100%{opacity:1;transform:translate(0px,-65px)}}
@keyframes c3{0.0%{opacity:1;transform:translate(-93px,-65px)}5.7%{opacity:1;transform:translate(-65px,-40px)}11.4%{opacity:1;transform:translate(-24px,-12px)}17.1%{opacity:1;transform:translate(-15px,-7px)}22.9%{opacity:1;transform:translate(0px,0px)}65.7%{opacity:1;transform:translate(0,0)}68.6%{opacity:1;transform:translate(130px,0)}71.4%{opacity:1;transform:translate(252px,0)}77.1%{opacity:1;transform:translate(383px,0)}82.9%{opacity:0;transform:translate(520px,0)}85.7%{opacity:0;transform:translate(-100px,-230px)}88.6%{opacity:1;transform:translate(-100px,-155px)}94.3%{opacity:1;transform:translate(-97px,-120px)}100%{opacity:1;transform:translate(-93px,-65px)}}
@keyframes c4{0.0%{opacity:1;transform:translate(-185px,-65px)}5.7%{opacity:1;transform:translate(-130px,-40px)}11.4%{opacity:1;transform:translate(-48px,-12px)}17.1%{opacity:1;transform:translate(-30px,-7px)}22.9%{opacity:1;transform:translate(0px,0px)}65.7%{opacity:1;transform:translate(0,0)}68.6%{opacity:1;transform:translate(130px,0)}71.4%{opacity:1;transform:translate(252px,0)}77.1%{opacity:1;transform:translate(383px,0)}82.9%{opacity:0;transform:translate(520px,0)}85.7%{opacity:0;transform:translate(-200px,-230px)}88.6%{opacity:1;transform:translate(-200px,-155px)}94.3%{opacity:1;transform:translate(-194px,-120px)}100%{opacity:1;transform:translate(-185px,-65px)}}

.anim-thumb{animation:thumbLoop var(--loop,1.17s) linear infinite}
.anim-btn{animation:btnPulse var(--loop,1.17s) linear infinite}
.anim-hand{animation:handTap var(--loop,1.17s) linear infinite;transform-origin:30% 20%}
.anim-c0{animation:c0 var(--loop,1.17s) linear infinite}
.anim-c1{animation:c1 var(--loop,1.17s) linear infinite}
.anim-c2{animation:c2 var(--loop,1.17s) linear infinite}
.anim-c3{animation:c3 var(--loop,1.17s) linear infinite}
.anim-c4{animation:c4 var(--loop,1.17s) linear infinite}

@media (prefers-reduced-motion: reduce){
  .anim-thumb,.anim-btn,.anim-hand,.anim-c0,.anim-c1,.anim-c2,.anim-c3,.anim-c4{animation:none}
}
```

- The `c*` x offsets assume **100px-wide reels with gap 0** (offset = (i−2)×100). If you change the reel width, scale every x value in `c0`–`c4` by `newWidth / 100`.
- The `thumbLoop` y values assume the mask and bar positions in §4.1. If you move the bar, scale them by `(barTop − cardTop) / 170`.
- To slow the loop, set `--loop` on the stage (e.g. `--loop: 2.4s`). The shape of the motion stays the same.
- **Reduced motion:** with animations off, each element shows its base state: the PDF at rest, the bar, and the full strip of five reels.
- Pause the animation when the panel is off-screen or the tab is hidden: `animation-play-state: paused` via an IntersectionObserver and `visibilitychange`.

---

## 6. Accessibility
- The showcase stage gets `aria-hidden="true"` and contains no focusable elements. The fake "Make reels" button is a `<span>`, not a `<button>`.
- Every form control has a visible `<label>`. The mode tabs use `role="tablist"`, with `role="tab"` and `aria-selected` on each tab.
- Contrast: body text `--fg` and `--mut` on `--bg` pass AA. Keep the CTA label at 18px bold or larger.
- Autocomplete values: `email`, `name`, `current-password` (sign-in) and `new-password` (sign-up).

## 7. Acceptance checklist
- [ ] At 1440×900 and 1280×800 the page fits the screen with **no scrollbar**.
- [ ] Below 900px wide the right column is hidden and the form is centered.
- [ ] The PDF enters from above, rests, sinks behind the bar, and is never visible below the bar.
- [ ] The reels are never visible above the lower mask, and only peek out from under the bar.
- [ ] The five reels touch, with no gap, and only the strip's two outer ends are rounded.
- [ ] The button pulses at the moment the PDF starts sinking.
- [ ] The loop is seamless, with no visible jump at 100% → 0%.
- [ ] With reduced motion on, the panel is static and complete.
- [ ] Existing sign-in and sign-up logic, validation and routing are untouched.
