# Brainrot Shorts — Dashboard Design: Foundations

This spec is reverse-engineered from the screen recording (1894×886, ~49 s). It covers the shared app shell, design tokens and components used by every dashboard screen.

| File | Screen |
|---|---|
| `00-dashboard-foundations.md` | Tokens, app shell, sidebar, shared components (this file) |
| `01-home-what-are-you-making.md` | Home / format picker |
| `02-new-video-whats-it-about.md` | New video composer |
| `03-your-video-editor.md` | Script, voice, presenter, look and quality setup |
| `04-upgrade-modal.md` | "Unlock Motion Graphics" paywall |

> Colors were sampled from compressed video frames, so treat hex values as ±3. Snap them to your auth tokens (`auth-design.md`) where noted, so login and the app feel like one product.

---

## 1. Design tokens

### Color

```css
:root{
  /* surfaces */
  --bg:          #0E0F13;  /* main content background */
  --sidebar:     #131419;  /* left nav background */
  --s1:          #17181D;  /* search field, inputs, textarea */
  --s2:          #1B1B23;  /* cards, composer, hero card */
  --s3:          #24252A;  /* raised rows: "Add a presenter", segmented bg */
  --line:        #26272E;  /* card borders (1px), dividers */
  --line-strong: #34353D;  /* input / pill borders */

  /* text */
  --fg:    #F4F4F5;        /* headings, primary */
  --fg-2:  #B6B5BA;        /* body on cards, suggestion chips */
  --mut:   #8A8A92;        /* sub-copy, meta ("from a topic") */
  --mut-2: #5E5F66;        /* placeholder, disabled labels */

  /* brand / action */
  --act:        #E8603C;   /* primary CTA (orange) — auth uses #FA5F29 */
  --act-hover:  #F06D49;
  --act-dis:    #8E5A50;   /* CTA disabled (orange at ~45%) */
  --act-soft:   rgba(232,96,60,.14); /* "Beta" pill bg, selected plan glow */
  --on-act:     #FFFFFF;

  /* category accents (dots, eyebrow labels, "Everything else" avatars) */
  --cat-explain:   #5EC4B6;  /* teal */
  --cat-market:    #C084FC;  /* violet */
  --cat-entertain: #818CF8;  /* indigo */
  --cat-music:     #4ADE80;  /* green */

  /* misc */
  --chip-on-bg: #F4F4F5;  --chip-on-fg: #0E0F13;  /* active filter / tab pill */
  --badge-new:  #4FC3F7;  /* "All new" sticker */
  --success:    #22C55E;  /* grammar/ready dot in composer */
  --pro:        #C084FC;  /* "Best for" label on Max tier */
}
```

### Typography

The UI uses one geometric grotesk throughout; the recording looks like **DM Sans / Plus Jakarta Sans**. To match the landing and auth pages, use **Space Grotesk** for UI and **Bricolage Grotesque 800** for page titles only.

| Role | Size / weight | Line-height | Example |
|---|---|---|---|
| Page title (H1) | 32 / 700 | 1.15 | "What are you making?" |
| Card title L | 24 / 700 | 1.2 | "Motion Graphics" (hero card) |
| Section title | 15 / 600 | 1.3 | "Entertainment and music", "Your videos" |
| Card title | 16 / 700 | 1.3 | "Quiz Video" |
| Body | 14 / 400 | 1.5 | Card descriptions (3-line clamp) |
| Sub / meta | 13 / 400 | 1.4 | "from a topic", "Script ready, today" |
| Eyebrow | 11 / 600, uppercase, +0.08em | — | "EXPLAIN · MOST STARTED" |
| Sidebar item | 15 / 500 | — | "New video" |
| Composer placeholder | 22 / 400 | 1.4 | "Paste your script, or describe an idea." |

### Spacing, radius, elevation

- Spacing scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48
- Radius: `--r-xs 6` (count chips) · `--r-sm 10` (inputs, pills, buttons) · `--r-md 14` (cards, composer) · `--r-lg 18` (hero card, modal panels) · `--r-pill 999`
- Elevation: flat cards with a 1px `--line` border; the modal uses `0 30px 80px rgba(0,0,0,.6)` over a `rgba(0,0,0,.6)` scrim.

---

## 2. App shell

```
┌───────────────┬────────────────────────────────────────────────────┐
│  SIDEBAR      │  MAIN (scrolls)                                    │
│  248px fixed  │  padding 24px 44px; content max-width ≈ 945px      │
│  --sidebar    │  --bg                                              │
│               │                                                    │
│ Brainrot Shorts                                                    │
│               │                                                    │
│ ▸ New video   │                                                    │
│   Search  ⌘K  │                                                    │
│   Creations   │                                                    │
│               │                                                    │
│ Recent        │                                                    │
│   …×3         │                                                    │
│               │                                                    │
│ Your tools    │                                                    │
│   More tools ›│                                                    │
│               │                                                    │
│ Free  220 cr  │                                                    │
│ ▬▬───────     │                                       ( 💬 help )  │
│ Upgrade       │                                                    │
│ (J) Jatin  ▢  │                                                    │
└───────────────┴────────────────────────────────────────────────────┘
```

### Sidebar (248px, full height, does not scroll with main)

| Block | Spec |
|---|---|
| Wordmark | "Brainrot Shorts", 15/700, `--fg`, padding 20px 22px |
| Primary nav | `New video` (active: `--fg`, 500, bg `--s1`, radius 8), `Search` + `⌘K` hint right-aligned in `--mut`, `Creations`. Rows 40px tall, 22px left padding |
| Group label | "Recent", "Your tools": 13/400, `--mut`, 28px top margin |
| Recent items | Last 3 projects by title, 14/400, `--fg-2`, single-line ellipsis |
| More tools | Row with a `›` chevron, opens the tools flyout |
| Plan meter | "Free" (14/600) ↔ "220 credits" (13, `--mut`), then a 4px progress bar (track `#2A2B31`, fill `--fg-2`, radius 2) |
| Upgrade | 14/600 `--fg` text link → opens `04-upgrade-modal` |
| User row | 32px avatar circle (initial on `#16A34A`), name 14/500, feedback icon button on the right |

### Floating help button
56px circle, bottom-right 16px inset, `#2563EB` fill with a white chat glyph, `z-index` above content and below the modal.

---

## 3. Shared components

### Filter chip (category tabs)
- Height 36, padding 0 16, radius pill, 14/500.
- **Active:** bg `--chip-on-bg`, text `--chip-on-fg`.
- **Inactive:** transparent, text `--fg-2`, with an 8px square color dot (category token, radius 2) before the label.

### Search field
Width 300, height 40, bg `--s1`, 1px `--line`, radius 10, magnifier icon, placeholder "Search formats, tools, creations" in `--mut`, `⌘K` kbd hint on the right.

### Primary button
bg `--act`, text white 15/600, height 44, padding 0 18, radius 10. Disabled: bg `--act-dis`, text `rgba(255,255,255,.45)`. A credit cost is appended after a thin space: "Write it for me · 100 credits".

### Ghost button / text button
No background, `--fg` 15/500 ("This is my script", "Maybe later"). Hover adds bg `--s3`.

### Dropdown pill
Height 36, padding 0 12, bg `--s1` (or transparent inside the composer), 14/400 `--fg-2`, trailing chevron ⌄.

### Segmented control
Container bg `--s3`, radius 12, padding 4. Item height 36, radius 10, 14/500. Active item: bg `--chip-on-bg` / text dark (editor tabs), **or** bg `--s2` / text `--fg` (composer tabs).

### Format card (horizontal)
- 2 columns × N rows on a 3-col grid, gap 16. Card height ~210, bg `--s2`, 1px `--line`, radius 14, overflow hidden.
- Left: 100px media column (gameplay thumbnail, or an icon on a tinted gradient of the category color at 25%), with an optional ▶ 28px play badge at bottom-left.
- Right (padding 20): eyebrow (category color) → title 16/700 → description 14/400 `--mut` with a 3-line clamp → CTA link "Start from a topic →" 14/600 `--fg`, pinned to the bottom.

### Tool row (Everything else)
- 32px circle avatar with a letter, colored per tool.
- Title 15/600 and sub 13 `--mut` ("from a document").
- Arrow `→` in `--mut-2` on the right; it brightens on hover. Row height 64.

### Video tile (Your videos)
Fixed 168×240 tile, bg `--s2`, radius 12. It shows the script's first lines (14/400 `--fg-2`, fading at the bottom), or "No words yet" centered in `--mut`. A "Draft" label sits bottom-right (12/500 `--fg-2`). Under the tile: title 14/600 with ellipsis, and meta 13 `--mut` ("Script ready, today").

### Promo banner
Full-width row, no card background. Three tiny phone thumbnails (40×64, radius 8, stacked with an 8px gap), then a violet dot, title 16/600, sub 14 `--mut` (2 lines), a CTA "Explore Marketing Studio →" 16/700 right-aligned, and a dismiss ✕.

---

## 4. Interaction and motion

- Hover on cards: border to `--line-strong`, bg +2% lightness, 120ms ease.
- Clicking a format card's CTA pushes the composer screen (`02`) with the format preselected.
- Paid actions on the Free plan open the upgrade modal (`04`). The script is autosaved first, as the modal copy says "Your script is saved".
- Respect `prefers-reduced-motion`: no autoplay on example thumbnails.

## 5. Responsive

| Breakpoint | Change |
|---|---|
| ≥ 1280 | Layout as described |
| 1024–1279 | Format grid becomes 2 columns; editor right column narrows to 360 |
| 768–1023 | Sidebar collapses to a 64px icon rail; the editor stacks (right column below) |
| < 768 | Sidebar becomes a bottom sheet behind a menu button; the composer CTA row stacks full-width; the modal goes full-screen and hides its preview panel |
