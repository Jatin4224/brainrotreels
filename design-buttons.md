# design.md — Soft Tactile UI System

> Style: **Soft skeuomorphism / tactile UI** (aka "glossy-lite").
> Flat layout + subtle depth: vertical gradients, darker 1px borders, inner top highlight, soft tinted shadows, big radii, calm grid canvas.
> References: Linear, Raycast, Vercel, Arc, Cron.

---

## 1. Principles

1. **Depth is whispered, not shouted.** Every surface gets at most: 1 gradient, 1 border, 1 inner highlight, 1–2 soft shadows.
2. **Light comes from above.** Highlights on the top edge, shadows below. Never reverse.
3. **Borders are one step darker than the fill**, never gray on color.
4. **Shadows take the color of the element** (blue button → blue-tinted glow).
5. **Rounded everything.** Small controls 12px, cards 16–20px, nav bars full pill.
6. **One primary action per view.** Everything else is the neutral "secondary" style.

---

## 2. Design tokens

```css
:root {
  /* ---------- Color ---------- */
  --bg-canvas:        #FAFAFA;
  --bg-grid-line:     #EFEFEF;
  --surface:          #FFFFFF;
  --surface-muted:    #F7F7F7;

  --text-primary:     #111111;
  --text-secondary:   #6B6B6B;
  --text-on-primary:  #FFFFFF;

  --border-subtle:    #E8E8E8;
  --border-strong:    #DADADA;

  /* Primary — DERIVED from --brand (see section 10). Change one value, everything follows. */
  --brand:            #2F66F0;
  --primary-top:      color-mix(in oklch, var(--brand), white 22%);
  --primary-bottom:   var(--brand);
  --primary-border:   color-mix(in oklch, var(--brand), black 22%);
  --primary-hover-top:    color-mix(in oklch, var(--brand), white 30%);
  --primary-hover-bottom: color-mix(in oklch, var(--brand), white 8%);
  --primary-glow:     color-mix(in srgb, var(--brand) 28%, transparent);
  --primary-soft:     color-mix(in oklch, var(--brand) 10%, white);  /* tinted bg for badges, selected rows */
  --primary-text:     color-mix(in oklch, var(--brand), black 25%);  /* links / brand text on white */

  /* Secondary (neutral) */
  --secondary-top:    #FFFFFF;
  --secondary-bottom: #F4F4F4;
  --secondary-border: #DEDEDE;

  /* Focus */
  --focus-ring:       color-mix(in srgb, var(--brand) 35%, transparent);

  /* ---------- Radius ---------- */
  --radius-sm:   8px;
  --radius-md:   12px;   /* buttons, inputs */
  --radius-lg:   16px;   /* cards, popovers */
  --radius-xl:   20px;   /* banners, modals */
  --radius-pill: 999px;  /* nav bar, tags */

  /* ---------- Shadow ---------- */
  --shadow-xs:   0 1px 2px rgba(0,0,0,0.05);
  --shadow-sm:   0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.04);
  --shadow-md:   0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06);
  --shadow-lg:   0 4px 8px rgba(0,0,0,0.04), 0 16px 40px rgba(0,0,0,0.08);
  --highlight-top: inset 0 1px 0 rgba(255,255,255,0.35);
  --highlight-top-soft: inset 0 1px 0 rgba(255,255,255,0.9);

  /* ---------- Type ---------- */
  --font-sans: "Inter", "SF Pro Text", -apple-system, system-ui, sans-serif;
  --text-xs:  12px;
  --text-sm:  14px;
  --text-md:  15px;
  --text-lg:  17px;
  --text-xl:  20px;
  --text-2xl: 28px;
  --text-3xl: 40px;

  /* ---------- Spacing (4px scale) ---------- */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;

  /* ---------- Motion ---------- */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
}
```

### Typography rules
| Use | Size | Weight | Tracking |
|---|---|---|---|
| Hero title | 40–56px | 600 | -0.03em |
| Section title | 28px | 600 | -0.02em |
| Body | 15px | 400 | -0.01em |
| Button / nav | 15px | 500 | -0.01em |
| Caption / meta | 13px | 400 | 0 |

- Body line-height 1.5, headings 1.15.
- Secondary text uses `--text-secondary`; links inside it are the same color, underlined (`text-underline-offset: 3px`).

---

## 3. Background — grid canvas

```css
body {
  font-family: var(--font-sans);
  color: var(--text-primary);
  background-color: var(--bg-canvas);
  background-image:
    linear-gradient(var(--bg-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--bg-grid-line) 1px, transparent 1px);
  background-size: 110px 110px;
  -webkit-font-smoothing: antialiased;
}
```
Optional: fade the grid toward the edges with a mask:
```css
.grid-fade { mask-image: radial-gradient(ellipse at center, #000 40%, transparent 85%); }
```

---

## 4. Components

### 4.1 Primary button (the blue "Allow" / "Download for Mac")

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 40px; padding: 0 18px;
  font: 500 var(--text-md)/1 var(--font-sans);
  letter-spacing: -0.01em;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-base) var(--ease-out),
              background var(--dur-base) var(--ease-out);
  -webkit-tap-highlight-color: transparent;
}

.btn-primary {
  color: var(--text-on-primary);
  background: linear-gradient(180deg, var(--primary-top) 0%, var(--primary-bottom) 100%);
  border: 1px solid var(--primary-border);
  box-shadow:
    var(--highlight-top),                                              /* glossy top edge */
    0 1px 2px color-mix(in srgb, var(--primary-border) 30%, transparent), /* contact shadow */
    0 4px 12px var(--primary-glow);                                    /* colored glow */
  text-shadow: 0 1px 0 rgba(0,0,0,0.12);
}
.btn-primary:hover {
  background: linear-gradient(180deg, var(--primary-hover-top), var(--primary-hover-bottom));
  box-shadow: var(--highlight-top), 0 1px 2px color-mix(in srgb, var(--primary-border) 30%, transparent), 0 6px 18px var(--primary-glow);
}
.btn-primary:active {
  transform: translateY(1px);
  background: linear-gradient(180deg, var(--primary-bottom), var(--primary-top));
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.15);
}
```

### 4.2 Secondary button ("No thanks")

```css
.btn-secondary {
  color: var(--text-primary);
  background: linear-gradient(180deg, var(--secondary-top), var(--secondary-bottom));
  border: 1px solid var(--secondary-border);
  box-shadow: var(--highlight-top-soft), var(--shadow-xs);
}
.btn-secondary:hover  { background: linear-gradient(180deg, #FFFFFF, #EFEFEF); border-color: var(--border-strong); }
.btn-secondary:active { transform: translateY(1px); box-shadow: inset 0 1px 2px rgba(0,0,0,0.06); }
```

### 4.3 Ghost / text button ("Log in")

```css
.btn-ghost { background: transparent; border: 1px solid transparent; color: var(--text-primary); }
.btn-ghost:hover { background: var(--surface-muted); }
```

### 4.4 Sizes
| Size | Height | Padding-x | Font | Radius |
|---|---|---|---|---|
| sm | 32px | 12px | 14px | 10px |
| md | 40px | 18px | 15px | 12px |
| lg | 48px | 22px | 16px | 14px |

### 4.5 Focus (all interactive elements)
```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--focus-ring), var(--shadow-xs);
}
```

### 4.6 Card / banner (cookie consent box)

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
}
.card p      { font-size: var(--text-md); line-height: 1.5; margin: 0 0 var(--space-2); }
.card .meta  { color: var(--text-secondary); font-size: var(--text-sm); }
.card .actions { display: flex; gap: var(--space-2); margin-top: var(--space-5); }
```

### 4.7 Floating pill nav

```css
.nav {
  position: sticky; top: 16px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 8px 8px 20px;
  background: rgba(255,255,255,0.8);
  backdrop-filter: blur(12px) saturate(140%);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-sm);
}
.nav .btn { border-radius: var(--radius-pill); }
```
(Pill nav → use pill buttons inside it, or radius 14px+ so curves nest. Rule: **inner radius = outer radius − padding**.)

### 4.8 Input

```css
.input {
  height: 40px; padding: 0 14px; width: 100%;
  font: 400 var(--text-md) var(--font-sans);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.04);
}
.input:focus { outline: none; border-color: var(--primary-bottom); box-shadow: 0 0 0 3px var(--focus-ring); }
```

---

## 5. Example markup

```html
<nav class="nav">
  <strong>Editrolls</strong>
  <div style="display:flex;gap:8px">
    <button class="btn btn-ghost">Log in</button>
    <button class="btn btn-primary"> Download for Mac</button>
  </div>
</nav>

<div class="card" style="max-width:420px">
  <p>Can we use a cookie to count return visits? It helps us improve Editrolls. No ads, nothing sold.</p>
  <p class="meta">Details in the <a href="/privacy" style="color:inherit">privacy policy</a>.</p>
  <div class="actions">
    <button class="btn btn-primary">Allow</button>
    <button class="btn btn-secondary">No thanks</button>
  </div>
</div>
```

---

## 6. Tailwind version

`tailwind.config.js` — colors point at the CSS variables, so the dynamic theme (section 10) works in Tailwind too.
```js
theme: {
  extend: {
    fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    colors: {
      primary: {
        top: 'var(--primary-top)', DEFAULT: 'var(--primary-bottom)',
        border: 'var(--primary-border)', soft: 'var(--primary-soft)', text: 'var(--primary-text)',
      },
      canvas: 'var(--bg-canvas)',
    },
    borderRadius: { xl: '12px', '2xl': '16px', '3xl': '20px' },
    boxShadow: {
      'btn-primary': 'var(--highlight-top), 0 1px 2px color-mix(in srgb, var(--primary-border) 30%, transparent), 0 4px 12px var(--primary-glow)',
      'btn-secondary': 'inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(0,0,0,.05)',
      card: '0 2px 4px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)',
    },
  },
}
```

```html
<!-- Primary -->
<button class="h-10 px-[18px] rounded-xl border border-primary-border text-white font-medium
  bg-gradient-to-b from-primary-top to-primary shadow-btn-primary
  hover:brightness-105 active:translate-y-px transition">Allow</button>

<!-- Secondary -->
<button class="h-10 px-[18px] rounded-xl border border-neutral-200 text-neutral-900 font-medium
  bg-gradient-to-b from-white to-neutral-100 shadow-btn-secondary
  hover:border-neutral-300 active:translate-y-px transition">No thanks</button>

<!-- Card -->
<div class="bg-white border border-neutral-200 rounded-3xl shadow-card p-6">…</div>
```

---

## 7. Dark mode (optional)

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-canvas: #0B0B0C; --bg-grid-line: #17171A;
    --surface: #141416;   --surface-muted: #1C1C1F;
    --text-primary: #F2F2F2; --text-secondary: #9A9AA0;
    --border-subtle: #26262A; --border-strong: #303035;
    --secondary-top: #222225; --secondary-bottom: #1A1A1D; --secondary-border: #333338;
    --highlight-top-soft: inset 0 1px 0 rgba(255,255,255,0.06);
  }
}
```

---

## 8. Do / Don't

**Do**
- Keep gradients short in range (≈ 10–15% lightness difference top→bottom).
- Tint shadows with the element's color.
- Use `translateY(1px)` + inset shadow for a "pressed" feel.
- Leave lots of whitespace; let the grid canvas breathe.

**Don't**
- Stack more than 2 outer shadows.
- Use pure black (`#000`) for shadows at high opacity.
- Mix sharp (≤4px) and soft (≥12px) corners on the same screen.
- Put two primary (blue) buttons next to each other.

---

## 9. Upgrade checklist for your product

- [ ] Add tokens (section 2) to your global CSS and set `--brand` to your product color (section 10)
- [ ] Switch font to Inter (`@import url('https://rsms.me/inter/inter.css')`)
- [ ] Replace flat buttons with `.btn-primary` / `.btn-secondary`
- [ ] Set radius: buttons 12px, cards 16–20px, nav pill
- [ ] Swap harsh shadows for `--shadow-sm/md`
- [ ] Add `:focus-visible` ring everywhere
- [ ] Apply grid canvas on marketing pages (keep app screens plain `--bg-canvas`)
- [ ] Check contrast: white on `#2F66F0` ≈ 4.6:1 ✅

---

## 10. Dynamic brand colors

Every brand-colored value (gradient top/bottom, border, hover, glow, focus ring, tinted backgrounds, link text) is **calculated from one variable: `--brand`**. Set it to your product's color and the whole UI re-themes.

### 10.1 Set your brand color
```css
:root { --brand: #7C3AED; }   /* your product color */
```

### 10.2 How the colors are calculated
| Token | Formula | Purpose |
|---|---|---|
| `--primary-top` | brand + 22% white | gradient top (lighter) |
| `--primary-bottom` | brand | gradient bottom |
| `--primary-border` | brand + 22% black | 1px edge, one step darker |
| `--primary-hover-*` | brand lifted ~8–30% | hover state |
| `--primary-glow` | brand at 28% opacity | colored shadow |
| `--focus-ring` | brand at 35% opacity | keyboard focus |
| `--primary-soft` | brand at 10% on white | badges, selected rows, pills |
| `--primary-text` | brand + 25% black | links / brand text on white |

Mixing happens in **OKLCH**, so the lighter and darker shades keep the same hue and don't turn gray or muddy (a problem with plain RGB mixing).

### 10.3 Ready-made presets
```css
[data-theme="blue"]    { --brand: #2F66F0; }
[data-theme="violet"]  { --brand: #7C3AED; }
[data-theme="indigo"]  { --brand: #4F46E5; }
[data-theme="green"]   { --brand: #16A34A; }
[data-theme="teal"]    { --brand: #0D9488; }
[data-theme="orange"]  { --brand: #EA580C; }
[data-theme="rose"]    { --brand: #E11D48; }
[data-theme="graphite"]{ --brand: #27272A; }  /* monochrome, Vercel-like */
```
```html
<html data-theme="violet">
```
You can also theme a single section: `<section data-theme="green">…</section>`, and everything inside it uses that color.

### 10.4 Change the color at runtime (user picks a color, per-workspace theme, etc.)
```js
// Set a brand color from anywhere: a color picker, a user setting, an API
export function setBrand(hex, el = document.documentElement) {
  el.style.setProperty('--brand', hex);
  el.style.setProperty('--text-on-primary', textOn(hex)); // keeps text readable
  localStorage.setItem('brand', hex);
}

// Pick white or near-black text depending on how light the brand color is
function textOn(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? '#111111' : '#FFFFFF';
}

// Restore the saved color on page load
const saved = localStorage.getItem('brand');
if (saved) setBrand(saved);
```
```html
<input type="color" value="#2F66F0" oninput="setBrand(this.value)">
```

> **Light brand colors** (yellow, lime, cyan): `textOn()` switches the button text to dark automatically. You can also darken the border a little more:
> `--primary-border: color-mix(in oklch, var(--brand), black 30%);`

### 10.5 Optional: tint the neutrals toward the brand
This makes the canvas and borders feel related to your brand color while staying close to gray:
```css
:root {
  --bg-canvas:     color-mix(in oklch, var(--brand) 2%, #FAFAFA);
  --bg-grid-line:  color-mix(in oklch, var(--brand) 4%, #EFEFEF);
  --border-subtle: color-mix(in oklch, var(--brand) 4%, #E8E8E8);
}
```

### 10.6 Dark mode with a dynamic brand color
In dark mode, lift the brand color slightly so it stands out against dark backgrounds:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --primary-bottom: color-mix(in oklch, var(--brand), white 8%);
    --primary-top:    color-mix(in oklch, var(--brand), white 28%);
    --primary-soft:   color-mix(in oklch, var(--brand) 18%, #141416);
    --primary-text:   color-mix(in oklch, var(--brand), white 35%);
    --primary-glow:   color-mix(in srgb, var(--brand) 40%, transparent);
  }
}
```

### 10.7 Browser support & fallback
`color-mix()` works in Chrome/Edge 111+, Safari 16.2+ and Firefox 113+, which covers about 95% of users. For older browsers, add plain hex fallbacks *before* the dynamic values:
```css
.btn-primary {
  background: linear-gradient(180deg, #5B8DFF, #2F66F0);                       /* fallback */
  background: linear-gradient(180deg, var(--primary-top), var(--primary-bottom)); /* dynamic */
}
```

### 10.8 Accessibility check
After choosing a brand color, check that the button text has **≥ 4.5:1 contrast** against `--primary-bottom` (use webaim.org/resources/contrastchecker). If it doesn't, either darken the brand color by ~10% or let `textOn()` switch the text to dark.
