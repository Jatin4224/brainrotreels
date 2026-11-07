# Brainrot Shorts — Auth Design Spec

The design for sign-in, sign-up and email verification. It uses the same visual language as the landing hero (`brainrot-shorts-hero-swipe.html`).

Canvas: https://claude.ai/artifact/Fcw4nJcgfSMhBn8SGQ2Hcf

---

## 1. Screens

| # | Screen | Size | Purpose |
|---|--------|------|---------|
| 1 | Desktop · Sign in / Create account | Fluid, designed at 1440×900 | One page with a mode toggle between sign-in and sign-up |
| 2 | Mobile · Create account | 390×844 | Sign-up for mobile |
| 3 | Mobile · Verify email | 390×844 | Enter the 6-digit code after sign-up or magic link |

### Flow

```
Landing "Start creating"
        │
        ▼
 ┌──────────────┐  toggle  ┌──────────────────┐
 │   Sign in    │ ◀──────▶ │  Create account  │
 └──────┬───────┘          └────────┬─────────┘
        │ magic link                │ submit
        ▼                           ▼
            ┌──────────────────────┐
            │  Verify email (OTP)  │
            └──────────┬───────────┘
                       ▼
                 App / Dashboard
```

---

## 2. Design tokens

These are taken from the hero's **Original** theme. Keep them as CSS variables so the hero's theme switcher also reskins auth.

```css
:root{
  --bg:   #0B0D13;  /* page background */
  --s1:   #15171D;  /* surface: cards, inputs (mobile) */
  --s2:   #1D2028;  /* raised surface: social buttons */
  --line: #1F222A;  /* dividers, card borders */
  --line-2:#2A2D36; /* input & button borders */
  --fg:   #F5F5F2;  /* primary text */
  --mut:  #9B9891;  /* secondary text */
  --ph:   #6F6D68;  /* placeholder text */
  --hi:   #F2CF3B;  /* highlight: badge, active tab, tilted word */
  --hiT:  #231B00;  /* text on --hi */
  --act:  #FA5F29;  /* action: primary CTA */
  --actT: #FFFFFF;  /* text on --act */
}
```

### Alternate themes (hi / act)

| Theme | --hi | --act |
|---|---|---|
| Original | `#F2CF3B` | `#FA5F29` |
| Hot sauce | `#FFC145` | `#FF3B1F` |
| Cobalt and lemon | `#F7E35A` | `#3D6BFF` |
| Emerald and gold | `#F2CF3B` | `#19C37D` |
| Bubblegum and lime | `#C8F560` | `#FF5FA2` |
| Tangerine and teal | `#FF9F43` | `#12B5A6` |
| Arctic and flame | `#A9E4FF` | `#FF6A3D` |
| Pure volt | `#FFD60A` | `#FFD60A` |

Each hero theme also sets its own `--bg/--s1/--s2/--line/--fg/--mut/--hiT/--actT`. Reuse the full set from the hero script rather than these two values alone.

### Radius

| Token | Value | Used on |
|---|---|---|
| `--r-pill` | 999px | Badges, tags, nav button |
| `--r-xl` | 32px | Desktop showcase panel |
| `--r-lg` | 22px | Auth card |
| `--r-md` | 14–16px | Primary CTA, tabs, OTP boxes |
| `--r-sm` | 12px | Inputs, social buttons |

### Spacing

Base unit 4px. Common steps: 8 / 14 / 20 / 28 / 48. Desktop page padding is 48px 32px; mobile padding is 56px 24px 28px.

---

## 3. Typography

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,800&family=Space+Grotesk:wght@400;500;700&display=swap">
```

| Role | Font | Size / weight | Line-height | Tracking |
|---|---|---|---|---|
| Display H1 (desktop) | Bricolage Grotesque | 60 / 800 | 1.0 | -1.6px |
| Display H1 (mobile) | Bricolage Grotesque | 44 / 800 | 1.0 | -1.2px |
| Verify title | Bricolage Grotesque | 38 / 800 | 1.02 | -1px |
| Body | Space Grotesk | 15–16 / 400 | 1.6 | 0 |
| Label | Space Grotesk | 13 / 500 | — | 0 |
| Primary CTA | Space Grotesk | 18 / 700 | — | 0 |
| Small / legal | Space Grotesk | 12–13 / 400 | 1.5 | 0 |

**Signature move:** one word in each headline sits on a `--hi` pill, rotated `-2deg`. This matches the hero's "actually".

```css
.hl{display:inline-block;background:var(--hi);color:var(--hiT);
    padding:0 12px;border-radius:12px;transform:rotate(-2deg)}
```

---

## 4. Components

### Badge
Background `--hi`, text `--hiT`, 14/500, padding 7×16, pill. It has a leading ▶ triangle drawn in SVG or with a CSS border.

### Mode tabs (segmented)
- Container: `--s1`, 1px `--line`, radius 22, padding 8.
- Two equal columns, 4px gap, each at least 44px tall.
- Active tab: background `--hi`, text `--hiT`. Inactive: transparent, text `--mut`.
- Use `role="tablist"` on the container, with `role="tab"` and `aria-selected` on each tab.

### Social buttons
Two-column grid, each 48px tall, `--s2` background, 1px `--line-2` border, radius 12, label 15/500 and an 18px icon.
> ⚠️ The design uses placeholder glyphs. **Use the official Google and Apple sign-in marks**, following each provider's brand guidelines.

### Divider
`1px --line` rule – "or with email" (13px, `--mut`) – `1px --line` rule.

### Text input
- 50px tall, radius 12, padding 0 16px, 1px `--line-2` border.
- Background: `--bg` inside the desktop card, `--s1` on mobile.
- Text 15px desktop / **16px mobile**. 16px stops iOS from zooming in on focus.
- Placeholder `--ph`. Focus: `2px solid --hi` outline, 2px offset.
- Always pair with a visible `<label for>`.

### Password field
Same as a text input, with right padding of 70px for the **Show/Hide** toggle. The toggle is a `<button>` at least 44×60 with an `aria-label` of "Show password" or "Hide password".
Autocomplete: `current-password` (sign-in), `new-password` (sign-up).

### Primary CTA
`--act` background, `--actT` text, **18px / 700**, at least 54px tall (56 on mobile), radius 14–16, trailing → arrow icon.
> Contrast note: white on `#FA5F29` is about 3.1:1. That passes WCAG only for *large* text (≥18.66px bold or ≥24px). Keep the label at 18px/700 or larger, or switch `--actT` to a dark color.

### Secondary / magic link
Transparent background, **dashed** 1px `--line-2` border, radius 12, 48px tall, mail icon. Shown on sign-in only.

### OTP input
- 6-column grid, 8px gap, each box 60px tall, radius 14, `--s1` background.
- Digits in Bricolage 26/800.
- States: empty `1px --line-2` · filled `1px #3A3D46` · focused `2px --hi`.
- `inputmode="numeric"`, `maxlength="1"`, `autocomplete="one-time-code"` on the first box, `aria-label="Digit n of 6"`, all wrapped in a `<fieldset>` with a visually hidden legend.
- Support paste of the full code, auto-advance, and backspace to the previous box.

### Tilted tags (decor)
- "● Ready to post in 41s": `--fg` background, `--bg` text, `rotate(-4deg)`.
- "They can't stop scrolling": `--hi` background, `--hiT` text, `rotate(4deg)`.
- Both are taken straight from the hero.

---

## 5. Screen details

### 5.1 Desktop — Sign in / Create account
**Layout:** nav bar, then `main` (max-width 1240) as a wrapping flex row:
- **Form column:** `flex: 1 1 420px; max-width: 500px`
- **Showcase panel:** `flex: 999 1 520px`, at least 640px tall. It wraps below the form on narrow screens.

**Nav:** logo on the left. On the right, a prompt and an outline pill button that toggles the mode.

| | Sign in | Create account |
|---|---|---|
| Nav prompt | New here? → **Create account** | Already creating? → **Sign in** |
| Badge | Welcome back, creator | Your first short is on us |
| H1 | Your feed missed **you** | Start making shorts that **stick** |
| Sub | Sign in to pick up your drafts and keep shipping shorts. | Create an account and turn any idea into a finished short. |
| Extra field | — | Creator name |
| Password hint | Your password + "Forgot password?" | At least 8 characters |
| CTA | Sign in → | Create account → |
| Below CTA | Email me a magic link instead | Terms & Privacy line |

**Showcase panel:** the two tilted tags, then three 9:16 example cards fanned at -6° / 0° / +6° (`--s2`, `--hi`, `--act`), then the hero's prompt box ("Why octopuses have three hearts… / Generate →"), then the social-proof line (avatar stack · "12,400+ creators · 38M views generated").

### 5.2 Mobile — Create account
From top to bottom: logo and a "● 41s to post" tag, then the H1 "Make shorts people **actually** watch", social buttons, divider, email and password fields, a flexible spacer, the CTA pinned to the bottom, "Already creating? Sign in", and the legal line.

### 5.3 Mobile — Verify email
From top to bottom: a 44px back button, a mail illustration (a `--hi` square rotated -6° with an "1 new" `--act` pill), "Check your inbox", "We sent a 6-digit code to **email**", the OTP row, "Didn't get it? Resend code in 0:24", a spacer, the CTA "Verify and start creating →", and "Wrong email? Change it".

---

## 6. States and validation

| State | Treatment |
|---|---|
| Field error | Border `#FF5A5A` (or a theme-safe red) plus a 13px message below the field. Set `aria-invalid="true"` and `aria-describedby` |
| Form error (bad credentials) | Inline banner above the CTA: `--s2` background, 1px red border, radius 12 |
| Loading | CTA keeps its width, label becomes a spinner plus "Signing in…", `aria-busy="true"`, disabled |
| Disabled CTA | 40% opacity; keep it focusable only if you explain why it's disabled |
| Resend cooldown | Countdown in `--mut`; the "Resend code" button is disabled until it reaches 0:00 |
| Success (verify) | Boxes turn `--hi` border, then go to the app |

Rules: validate email format on blur, and password length (≥ 8) on sign-up. Never reveal whether an email exists on "Forgot password"; always show "If an account exists, we've sent a link."

---

## 7. Accessibility checklist

- [ ] Real `<button>`, `<a href>`, `<input>` + `<label>`; no clickable divs
- [ ] Touch targets ≥ 44×44
- [ ] Visible focus: `2px --hi` outline on inputs, buttons and links
- [ ] Body text contrast ≥ 4.5:1 (`--fg` and `--mut` on `--bg` both pass)
- [ ] CTA label kept large (see the contrast note above)
- [ ] Decorative SVGs `aria-hidden="true"`; icon-only buttons have `aria-label`
- [ ] Correct `autocomplete` values: `email`, `name`, `current-password`, `new-password`, `one-time-code`
- [ ] Respect `prefers-reduced-motion` for any added transitions

---

## 8. Implementation notes

- Reuse the hero's theme array and `pick()` function, and store the chosen theme in `localStorage` so auth matches the landing page.
- Desktop and mobile can share one responsive component. The mobile artboards show how the desktop page collapses: the showcase panel hides below about 900px and the CTA pins to the bottom.
- Toggling between modes should update the URL (`/login` ↔ `/signup`) so each can be linked directly.
- Replace the placeholder copy, example card titles and stats with real values before launch.
