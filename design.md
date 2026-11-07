# design.md — BrainrotShorts landing page

> Source: https://www.brainrotshorts.com, inspected on 2026-11-07 at 1440×900 and 464px wide.
> The values below are computed styles and CSS variables read from the live page.
> Stack it was built with: **Next.js + Tailwind CSS v4 + shadcn/ui** (Radix accordion, lucide icons).
>
> Use this as a **style and structure reference**. Swap in your own brand name, logo, copy, videos and pricing. Don't reuse their trademarks, assets or copy word for word.

---

## 1. Design language at a glance

- **Dark mode first.** Near-black blue-tinted background (`#0b0d13`) and warm off-white text (`#f3f1ee`).
- **Two loud brand colors:** an orange **primary** (`#fa5f29`) for actions and a yellow **accent** (`#f2cf3b`) for highlights, eyebrows and badges.
- **"Soft brutalism":** 1px hairline borders, a 1px inset top highlight on cards, deep soft drop shadows, and a 1px lift on hover. Large radii (14–18px) and pill shapes everywhere.
- **Type pairing:** **DM Sans** for display headings (big, tight, leading ≈ 0.95) and **Geist** for UI and body. **Geist Mono** is used for durations and timecodes.
- **Atmosphere:** two fixed radial color washes on the body (orange top-right, yellow top-left) plus a blurred orange halo behind the hero.
- **Product as proof:** real 9:16 video thumbnails are the main imagery. There are no illustrations or stock photos.
- Sections are full width, separated by a **2px top border** (`border-t-2 border-border`). Content sits in a `max-w-7xl` container (1280px) with `px-6`.

---

## 2. Design tokens

### 2.1 Colors (dark theme, the one in use)

| Token | Hex | Use |
|---|---|---|
| `--background` | `#0b0d13` | Page background, inputs, FAQ items |
| `--foreground` | `#f3f1ee` | Primary text |
| `--card` | `#15171d` | Cards, input shell, FAQ/CTA section background |
| `--card-foreground` | `#f3f1ee` | |
| `--popover` | `#191c22` | |
| `--primary` | `#fa5f29` | CTAs, "Best Value", check icons, savings pills |
| `--primary-foreground` | `#ffffff` | |
| `--accent` | `#f2cf3b` | Eyebrow pills, H1 highlight bar, step numbers, active chip, section kicker text |
| `--accent-foreground` | `#0b0d13` | Text on yellow |
| `--secondary` | `#1e2026` | |
| `--muted` | `#212328` | "20% OFF" pill background |
| `--muted-foreground` | `#9b9891` | Subheads, nav links, secondary text |
| `--border` | `#ffffff14` (white 8%) | All hairlines |
| `--input` | `#ffffff1a` | |
| `--ring` | `#fa5f2973` | Focus ring |
| `--destructive` | `#d40924` | |

Category accents (for video type tags):

| Token | Hex |
|---|---|
| `--accent-video` | `#ad9dff` (lavender) |
| `--accent-audio` | `#00d6bb` (teal) |
| `--accent-character` | `#ff87d0` (pink) |
| `--accent-create` / `--accent-image` | `#ff9948` (orange) |

Light theme (defined but not used on the landing page): bg `#fcfaf6`, fg `#0d0d0d`, card `#fff`, primary `#f04a00`, accent `#f2cf3b`, muted-fg `#595855`, border `#0000001a`.

### 2.2 Body background

```css
body {
  background-color: var(--background);
  background-image:
    radial-gradient(1200px 600px at 80% -10%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%),
    radial-gradient(900px 500px at -10% 20%, color-mix(in oklab, var(--accent) 10%, transparent), transparent 60%);
  background-attachment: fixed;
}
```

Hero halo, placed behind the headline:

```html
<div class="halo-primary pointer-events-none absolute left-1/2 top-24 -z-10 h-[640px] w-[1000px] max-w-full -translate-x-1/2 opacity-40 blur-[60px]"></div>
```
```css
.halo-primary { background-image: radial-gradient(60% 60% at 50% 50%, color-mix(in oklab, var(--primary) 35%, transparent) 0%, transparent 70%); }
```

### 2.3 Typography

| Role | Font | Size (mobile → md → lg) | Weight | Line height | Tracking |
|---|---|---|---|---|---|
| H1 | DM Sans | 48 → 60 → **72px** | 400–500 | 0.95 | -0.025em (tight) |
| H2 (section) | DM Sans | 30 → 36 → **48px** | 400–500 | 0.95–0.98 | tight |
| H2 (closing CTA) | DM Sans | 36 → 48 → **60px** | 400–500 | 0.95 | tight |
| Plan name | DM Sans | 18px | 800 | — | tight |
| Price | DM Sans | 36px | 900 | — | tight |
| Struck list price | DM Sans | 24px, muted, `line-through decoration-2` | 800 | — | |
| Hero sub / lead | Geist | 18 → **20px** | 400 | 1.625 (relaxed) | — |
| Body | Geist | 16px | 400 | 1.5 | — |
| Nav links | Geist | 14px | 500 | — | — |
| Step title | Geist | 20px | 800 | — | tight |
| Section kicker (eyebrow text) | Geist | 12px | 900 | — | **0.2em**, UPPERCASE, `text-accent` |
| Gallery heading | Geist | 14px | 900 | — | 0.14em, UPPERCASE |
| Micro pills | Geist | 10–11px | 900 | — | 0.12em, UPPERCASE |
| Timecodes | Geist Mono | 12px | 400 | — | `tabular-nums`, white/75 |

> Note: the site's `font-900` utility does not resolve, so headings actually render at **weight 400** in DM Sans. The big-but-light look is part of the style. Use 400–500 to match, or 800–900 if you want a heavier feel.

Load the fonts with Google Fonts or `next/font`: `Geist`, `Geist Mono`, `DM Sans` (variable, 400–900).

### 2.4 Radius

- Base `--radius: 0.875rem` (14px).
- `rounded-xl` → **18px** (buttons, chips, inputs, FAQ items, step badges)
- `rounded-2xl` → **16px** (cards, input shell, video player)
- `rounded-full` → pills (eyebrow, toggle, badges, nav CTA)

### 2.5 Shadows and borders (the "brutal" utilities)

```css
.brutal-border      { border: 1px solid var(--border); }
.brutal-border-thin { border: 1px solid color-mix(in oklab, var(--border) 70%, transparent); }

.brutal-shadow-sm { box-shadow: 0 1px 0 0 color-mix(in oklab, var(--foreground) 6%, transparent) inset,
                                0 1px 2px 0 #00000059; }
.brutal-shadow    { box-shadow: 0 1px 0 0 color-mix(in oklab, var(--foreground) 6%, transparent) inset,
                                0 8px 24px -12px #0000008c, 0 2px 6px -2px #00000059; }
.brutal-shadow-lg { box-shadow: 0 1px 0 0 color-mix(in oklab, var(--foreground) 8%, transparent) inset,
                                0 24px 60px -20px #000000a6, 0 6px 18px -6px #0006; }
.brutal-shadow-primary { box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary) 50%, transparent),
                                     0 12px 40px -10px color-mix(in oklab, var(--primary) 35%, transparent); }

.brutal-hover { transition: transform .2s, box-shadow .2s, border-color .2s; }
.brutal-hover:hover  { border-color: color-mix(in oklab, var(--foreground) 18%, transparent); transform: translateY(-1px); }
.brutal-hover:active { transform: translateY(0); }
```

### 2.6 Spacing and layout

- Container: `mx-auto max-w-7xl px-6` (1280px max, 24px gutters).
- Section vertical padding: `py-20 md:py-28` (80 → 112px) or `py-24 md:py-32` (96 → 128px) for pricing.
- Section separators: `border-t-2 border-border`.
- Section heading block: centered, `max-w-3xl`, kicker → H2 (`mb-4`) → lead paragraph (muted).
- Card grid gaps: 24px (`gap-6`). Two-column splits use `gap-12 lg:gap-16`.

### 2.7 Motion

- Hover: 1px lift plus a brighter border (`brutal-hover`), 200ms.
- FAQ: Radix accordion `accordion-down` / `accordion-up` height animations.
- Optional extras defined on the site: `v2-halo-pulse` (opacity .55→.9, scale 1→1.12, 3.2s loop) for the hero halo, and `skin-shimmer` for loading states.
- Respect `prefers-reduced-motion`.

---

## 3. Components

### Buttons
| Variant | Spec |
|---|---|
| **Primary (nav)** | Pill, h-36px, `px-4`, 14px/600, bg primary, white text, `brutal-shadow-primary` glow |
| **Primary (hero submit)** | h-48px, `px-6`, radius 18px, 16px/700, bg primary, `brutal-hover`, trailing arrow icon |
| **Primary (closing CTA)** | h-52px, `px-10`, radius 14px, 16px/700, bg primary, `brutal-shadow` |
| **Plan button** | Full width, pill, h-44px, 14px/600, bg card + `brutal-border`. On the featured plan, use bg primary |
| **Inverted** | Used on the white "Done for you" banner: bg background, fg text, h-48px, `px-7`, radius 14px |
| **Text link "More"** | 12px/700, muted, `underline underline-offset-4`, hover → foreground |

### Pills and badges
- **Eyebrow pill:** `inline-flex rounded-full bg-accent px-4 py-1.5 brutal-border brutal-shadow-sm`, text 14px/700, tracking tight, `text-accent-foreground`, optional leading sparkle icon.
- **Best Value badge:** absolutely centered on the card's top edge (`top-[-0.875rem]`), pill, bg primary, 12px/600, `px-3.5 py-1`, orange glow shadow.
- **"For professionals" badge:** same position. Pill, bg card, `border-2 border-foreground/35`.
- **Micro pills** (`20% OFF`, `SAVE $60…`, `15× LITE`): `rounded-full px-2.5 py-0.5 text-[10–11px] font-black uppercase tracking-[0.12em] brutal-border-thin`. Use bg primary for savings, bg accent for multipliers, bg muted for % off.

### Hero input card
```
┌ rounded-2xl bg-card p-2 brutal-border brutal-shadow-lg  (max-w-2xl, 672px) ┐
│ [ Idea* ][ Script ][ URL ][ Document ]   ← grid-cols-4 gap-1, h-44, rounded-xl
│                                             active = bg-accent text-accent-fg 14px/700
│ ┌ textarea min-h-88 rounded-xl bg-background brutal-border px-4 py-3 ┐ [Make my video →]
│ └ placeholder (muted): "How does a worker bee…" (rotating examples)  ┘
└──────────────────────────────────────────────────────────────────────────────┘
```
On `sm` and up the textarea and button sit in a row (`sm:flex-row sm:items-end`). On mobile they stack.

### Video card (9:16)
- `group relative block w-full overflow-hidden rounded-2xl bg-card brutal-border brutal-shadow brutal-hover`
- Inner: `aspect-[9/16] bg-black`, poster `<img>` with `object-cover`
- Top-left: type tag pill (e.g. `MOTION GRAPHICS`, uppercase micro type, colored by category)
- Bottom overlay: `bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-14`, with the title (white, semibold) on the left and the duration (Geist Mono 12px, white/75) on the right
- Optional: centered yellow circular play button on hover

### Check list item (pricing)
`flex items-start gap-2.5`. Icon: a `size-5` rounded-md square in bg primary with `brutal-border`, holding a lucide `check` (size-3, stroke-width 3, white).

### Step badge
`size-10 rounded-xl bg-accent text-accent-foreground text-lg font-black`, centered numeral.

### FAQ item
`rounded-xl bg-background brutal-border brutal-shadow-sm overflow-hidden`, trigger row ~57px tall with `px-5`, 16px/600 question text, chevron on the right that rotates 180° when open. Items are spaced `space-y-4` in a `max-w-3xl` (720px) centered column.

---

## 4. Page structure (top to bottom)

### 4.1 Sticky header
- `sticky top-0 z-40 border-b border-border/60 bg-background/55 backdrop-blur-xl`
- Inner nav: `max-w-7xl h-14 px-6 flex justify-between items-center`
- Left: logo mark (h-36px) + wordmark (DM Sans 16px/700)
- Center/right (`hidden md:flex gap-6`, 14px/500, muted → foreground on hover): Examples · How it works · Pricing · Done for you
- Right: primary pill CTA "Start creating"

### 4.2 Hero (`relative isolate overflow-hidden`)
- Container `pt-16 md:pt-24 pb-20`. Blurred orange halo behind.
- Centered column, `max-w-3xl`:
  1. Eyebrow pill (yellow): *"AI video creation, without the AI look"* (`mb-8`)
  2. **H1:** "Create content people **actually want to watch**". The second phrase sits on a **yellow highlighter bar**:
     ```html
     <span class="relative inline-block">
       <span class="relative z-10">actually want to watch</span>
       <span aria-hidden class="absolute -bottom-1 left-0 h-4 w-full -rotate-1 rounded-sm bg-accent"></span>
     </span>
     ```
  3. Lead paragraph (`mt-6 max-w-2xl text-lg md:text-xl text-muted-foreground leading-relaxed`)
  4. Input card (`mt-9`, see §3)
  5. Trust microcopy (14px, muted): "Every video on this page was made with the app. No mockups."
- **Thumbnail strip** below: 5 video cards in a row (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6`), each 9:16 (~217×385 at desktop), alternating Motion Graphics / Explainer tags.

### 4.3 Real outputs / featured player (`#examples`, `border-t-2`)
- Centered header: kicker `REAL OUTPUTS` (yellow) → H2 "Watch a few all the way through" → muted lead.
- `mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]`
  - **Left:** large player `rounded-2xl bg-black brutal-border brutal-shadow-lg` (~828×646). The vertical video is centered and letterboxed, with a big yellow circular play button. Bottom bar: title (white, semibold) + one-line description (muted) on the left and a yellow category pill on the right.
  - **Right (380px):** playlist panel (bg card, rounded-2xl, brutal-border). Grouped lists with headers (`MOTION GRAPHICS` / `EXPLAINER VIDEOS`, 14px/900 uppercase 0.14em, plus a "More" link). Rows: small square thumbnail (~40px, rounded-lg), title 14px/600, duration in mono on the right. The active row is highlighted (bg muted). Rows are `flex flex-col gap-1`.

### 4.4 How it works (`#how-it-works`, `border-t-2`)
- `grid lg:grid-cols-2 gap-12 lg:gap-16`, `py-20 md:py-28`
- **Left:** kicker `HOW IT WORKS` → H2 "From what you have to a finished video" → `<ol class="mt-10 flex flex-col gap-8">`, 3 steps, each `flex gap-5` with a yellow step badge, a 20px/800 title and a muted description.
  1. Give it what you have
  2. It makes the whole video
  3. Watch it, change it, post it
- **Right:** "Handled for you" card (`self-start rounded-2xl bg-card p-7 brutal-border brutal-shadow`). Small uppercase heading, then `<ul class="mt-5 divide-y divide-border">`. Each `li` is `flex gap-4 py-3.5` with a fixed-width label (`w-24 font-extrabold`) and a muted one-liner. Rows: Script · Design · Animation · Voice · Sound · Captions · Editing.

### 4.5 Pricing (`#pricing`, `border-t-2`, `py-24 md:py-32`)
- Centered header: kicker "Simple pricing" → H2 "Pick your plan" → muted lead.
- **Billing toggle** (`mt-8`): pill track `bg-card p-1 brutal-border brutal-shadow-sm`. The segments are pills (`px-4 py-2 text-sm font-bold`). The active one is bg primary + white. Each segment holds an inline "SAVE x%" micro pill. Options: Monthly · Every 3 Months (SAVE 20%) · Yearly (SAVE UP TO 48%).
- **Promo banner** below: yellow pill "Save 20% — up to $180 every 3 months" plus a muted 14px line about bonus credits.
- **Plan grid:** `mt-12 grid items-stretch gap-6 sm:grid-cols-2 xl:grid-cols-4`. Card = `relative flex h-full flex-col gap-5 rounded-2xl p-5 bg-card brutal-border brutal-shadow`.
  - Order on the page: Growth · **Pro (featured)** · Creator · Lite.
  - **Featured card:** `border-primary/60 brutal-shadow-primary ring-1 ring-primary/30 ring-offset-2 ring-offset-background lg:-translate-y-2`, with a "Best Value" badge on its top edge. It moves to `order-1` on mobile so it shows first.
  - Card anatomy, top to bottom:
    1. Plan name (DM Sans 18/800) + 1–2 line muted description
    2. Price row (`flex items-baseline gap-2`): struck list price (24px muted) · **current price** (36px) · `/mo` (muted) · `20% OFF` pill
    3. "Billed $X every 3 months" (13px muted) + `SAVE $X…` primary micro pill
    4. Credits box (inner rounded-xl bg-background brutal-border p-3): "30,000 credits / month" + yellow `15× LITE` pill. Optional value note ("≈ $0.08 per core video").
    5. Gift line "+2,000 bonus credits at signup" (accent-tinted)
    6. Uppercase muted divider label: "EVERYTHING IN CREATOR, PLUS:"
    7. Check list (see §3)
    8. Optional upsell note (13px muted, dashed top border)
    9. Plan button pinned to the bottom (`mt-auto`)
- Footnote (12px muted, centered) on fair use, with a link to the terms.
- **"Done for you" banner** (`mt-14`): an inverted `<aside>` with `rounded-2xl bg-foreground text-background p-7 sm:p-9 lg:flex-row lg:items-center lg:justify-between`. Left side: kicker "FULL-SERVICE PRODUCTION", DM Sans 28px/700 headline, short paragraph. Right side: dark "Start a project" button.

### 4.6 FAQ (`border-t-2 bg-card`)
- Centered H2 "Got questions?" + muted sub ("We've got answers…").
- Accordion column `max-w-3xl space-y-4`, 10 items (see §3 for styling).

### 4.7 Closing CTA (`border-t-2 bg-card`)
- `max-w-4xl text-center py-24 md:py-28`
- H2 "Your next video starts with one sentence" (largest H2, up to 60px) → muted lead → primary button "Start creating" (h-52).

### 4.8 Footer (`border-t-2`)
- `max-w-7xl`, `grid gap-12 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8 mb-12`
- Column 1: logo + wordmark, tagline (muted), then a wrap of "Featured on" badge images (h-36 to 54px).
- Columns 2–5: uppercase 12px/900 tracked headings (PRODUCT · VIDEO GENERATORS · TOOLS · DEVELOPERS + COMPANY), links 14px muted → foreground on hover, `space-y-2.5`.
- Bottom bar: `border-t border-border pt-8 flex justify-between`, 13px muted: "© 2026 Brand. All rights reserved." and "Built for creators who move fast. 🚀"

---

## 5. Responsive behavior

| Breakpoint | Changes |
|---|---|
| < 640 | Single column. Nav links hidden (logo + CTA only). Hero input button stacks under the textarea. Thumbnail strip is 2 columns or a horizontal scroll. Featured plan shows first. |
| ≥ 640 `sm` | Input row goes horizontal. Pricing goes to 2 columns. |
| ≥ 768 `md` | Nav links show. Type steps up (H1 60px, H2 36–48px). |
| ≥ 1024 `lg` | How it works and the player go to 2 columns. Featured plan lifts `-translate-y-2`. Footer goes to 5 columns. H1 72px. |
| ≥ 1280 `xl` | Pricing goes to 4 columns. |

---

## 6. Tailwind v4 starter (`globals.css`)

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root, .dark {
  --background:#0b0d13; --foreground:#f3f1ee;
  --card:#15171d; --card-foreground:#f3f1ee;
  --popover:#191c22; --popover-foreground:#f3f1ee;
  --primary:#fa5f29; --primary-foreground:#fff;
  --secondary:#1e2026; --secondary-foreground:#f3f1ee;
  --muted:#212328; --muted-foreground:#9b9891;
  --accent:#f2cf3b; --accent-foreground:#0b0d13;
  --destructive:#d40924;
  --border:#ffffff14; --input:#ffffff1a; --ring:#fa5f2973;
  --radius:.875rem;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-ring: var(--ring);
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
  --font-display: "DM Sans", ui-sans-serif, sans-serif;
  --radius-xl: calc(var(--radius) + 4px);   /* 18px */
  --radius-2xl: calc(var(--radius) + 2px);  /* 16px */
}

body {
  @apply bg-background text-foreground font-sans antialiased;
  background-image:
    radial-gradient(1200px 600px at 80% -10%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%),
    radial-gradient(900px 500px at -10% 20%, color-mix(in oklab, var(--accent) 10%, transparent), transparent 60%);
  background-attachment: fixed;
}

/* paste the .brutal-* and .halo-primary utilities from §2.5 / §2.2 here */
```

---

## 7. Build checklist

- [ ] Fonts loaded (Geist, Geist Mono, DM Sans) and display font wired to `font-display`
- [ ] Tokens + body gradient + brutal utilities in global CSS
- [ ] Sticky blurred header
- [ ] Hero: eyebrow pill, H1 with yellow highlighter bar, lead, tabbed input card, trust line, 5-card 9:16 strip
- [ ] Featured player + 380px playlist sidebar, with click-to-play and sound
- [ ] How it works: 3 numbered steps + "Handled for you" card
- [ ] Pricing: segmented billing toggle that updates prices, promo pill, 4 plan cards with a featured card, footnote, inverted "Done for you" banner
- [ ] FAQ accordion (Radix / shadcn `Accordion`)
- [ ] Closing CTA
- [ ] 5-column footer with badges and bottom bar
- [ ] Anchor links (`#examples`, `#how-it-works`, `#pricing`) with `scroll-mt-20` so the sticky header doesn't cover headings
- [ ] Focus rings (`ring-2 ring-accent` on inputs, `ring-ring/50` on buttons), alt text, reduced-motion fallback
- [ ] Lazy-load posters. Load video `src` only after a click.
