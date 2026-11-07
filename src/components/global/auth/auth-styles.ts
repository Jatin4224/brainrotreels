/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_CTA_CLASS, AUTH_FIELD_CLASS,
 *   AUTH_LABEL_CLASS, AUTH_SOCIAL_BUTTON_CLASS, AUTH_LINK_CLASS,
 *   AUTH_DIVIDER_CLASS, AUTH_SURFACE, TOKENS_NOT_HEX, CTA_IS_LARGE_TEXT,
 *   SIXTEEN_PX_STOPS_IOS_ZOOM, TOUCH_TARGET_44
 *
 * WHAT:  The shared skins of the auth screens — the one loud primary button,
 *        the field, its label, a social button, the "or with email" rule and
 *        an inline link.
 *
 * WHY:   Four screens wear these (sign-in, sign-up, forgot password, reset
 *        password) and a fifth borrows them (accept invitation). Written into
 *        each form, the first restyle quietly leaves one of them behind —
 *        which is exactly how this flow ended up with a bordered invitation
 *        card in the middle of four bare ones. Class constants rather than
 *        five wrapper components because that is the pattern the landing page
 *        already uses for its one shared CTA skin (`PRIMARY_CTA` in
 *        src/app/(marketing)/page.tsx): the markup stays a real <Button> or
 *        <Input> that callers can pass props to, and nothing has to be
 *        re-exported through a barrel to be reused.
 *
 *        TOKENS_NOT_HEX throughout. `bg-brand`, `text-brand-foreground`,
 *        `bg-surface-raised` and `border-border` all resolve against
 *        `.marketing-canvas`, applied by AuthShell, so re-skinning every auth
 *        screen is still one edit in globals.css.
 *
 *        CTA_IS_LARGE_TEXT, and the reason the label is pinned at 18px/700
 *        rather than left to taste: white on the brand orange is about 3.1:1,
 *        which clears WCAG for LARGE text only (>=18.66px bold). Shrink this
 *        label and the button silently stops passing. auth-design.md §4 says
 *        the same thing; this is where it is enforced.
 *
 *        SIXTEEN_PX_STOPS_IOS_ZOOM: the field is `text-base` (16px) at every
 *        width, not `md:text-sm` like the product's default <Input>. Safari
 *        zooms the whole page when a focused field is under 16px, and on a
 *        sign-in screen that reflow lands mid-password.
 *
 *        TOUCH_TARGET_44: the field and both button skins are at least 44px
 *        tall (the CTA 56), so every control clears the minimum target size
 *        on a phone without each screen remembering to say so.
 *
 * WHERE: The Better Auth auth / forgot-password / reset-password forms and
 *        the accept-invitation screen. Compose with `cn()`.
 */

/**
 * The one loud action on the screen. 56px tall, brand-filled, large bold
 * label — see CTA_IS_LARGE_TEXT before changing the type size.
 */
export const AUTH_CTA_CLASS =
  "brutal-shadow-brand h-14 w-full gap-3 rounded-2xl bg-brand text-lg font-bold text-brand-foreground hover:bg-brand/90";

/** A text, email or password field. 50px tall, 16px text. */
export const AUTH_FIELD_CLASS =
  "h-[3.125rem] rounded-xl border-border bg-surface-raised px-4 text-base text-foreground placeholder:text-muted-foreground/70 md:text-base";

/** The visible label above a field. */
export const AUTH_LABEL_CLASS = "text-sm font-semibold text-foreground";

/** One of the OAuth buttons in the row above the divider. */
export const AUTH_SOCIAL_BUTTON_CLASS =
  "brutal-hover h-12 w-full gap-2.5 rounded-xl border-border bg-surface-raised text-base font-semibold text-foreground";

/** The "or with email" rule: a centred label with a hairline either side. */
export const AUTH_DIVIDER_CLASS =
  "flex items-center gap-4 text-sm text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border";

/** An inline link inside body copy — the cross-links and the legal line. */
export const AUTH_LINK_CLASS =
  "font-semibold text-foreground underline underline-offset-4 outline-none hover:text-brand-accent focus-visible:ring-3 focus-visible:ring-ring/50";
