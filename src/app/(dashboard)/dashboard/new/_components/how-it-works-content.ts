/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: HOW_IT_WORKS, HOW_IT_WORKS_STEPS,
 *   HOW_IT_WORKS_VIDEO, HowItWorksVideo, PAGE_OWNED_COPY,
 *   NO_LINK_WITHOUT_A_DESTINATION
 *
 * WHAT:  The copy of the "How it works" explainer — its title, its three
 *        steps, the footnote about Max quality, and the demo video it offers
 *        to play.
 *
 * WHY:   PAGE_OWNED_COPY, held apart from the dialog for the reason
 *        `landing-content.ts` is: this is the product's own explanation of
 *        itself, the paragraph most likely to be rewritten by somebody who is
 *        not an engineer, and it should be a diff they can read.
 *
 *        NO_LINK_WITHOUT_A_DESTINATION is why `HOW_IT_WORKS_VIDEO` is `null`
 *        rather than a placeholder URL. The design shows a
 *        "Watch a real build (2:36)" button; there is no such recording yet.
 *        A button that opens nothing — or worse, a 404 — is a worse first
 *        impression than no button, so the dialog renders it ONLY when this
 *        is filled in. Supplying a `{ src, duration }` here is the entire
 *        change needed to light it up; nothing in the component has to move.
 *
 * WHERE: ./how-it-works-dialog.tsx.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: HowItWorksVideo
 *
 * WHAT:  The demo recording, when there is one.
 * WHY:   `duration` is stored as the string the button prints rather than as
 *        seconds: it is display copy on a button, not a measurement anything
 *        computes with, and formatting it in the component would be a second
 *        place for "2:36" to be wrong.
 */
export interface HowItWorksVideo {
  /** Where the recording plays. A route or an absolute URL. */
  src: string;
  /** As it reads on the button, e.g. "2:36". */
  duration: string;
}

/** Set this to show the "Watch a real build" button. See the file header. */
export const HOW_IT_WORKS_VIDEO: HowItWorksVideo | null = null;

export const HOW_IT_WORKS = {
  title: "You don't need to be an editor",
  lead: "Say what you want to say. The AI turns it into a fully animated video.",
  /* Shown in the tinted panel under the steps. It explains a behaviour that
   * only applies on the top quality tier, which is why it is a footnote and
   * not a fourth step — it is not part of the path everybody takes.
   * "Max" is the top QUALITY tier in the editor design, not a plan name.
   * It is referenced here before that screen exists, which is the one
   * forward-looking string in this file — if the tier is ever renamed, this
   * sentence is what goes stale. */
  note: "On Max quality it plans the visuals itself from your script. If something must appear or must be avoided, add a note. Totally optional.",
  dismiss: "Got it, let's create",
  watch: "Watch a real build",
} as const;

/**
 * SOURCE OF TRUTH KEYWORDS: HOW_IT_WORKS_STEPS
 *
 * WHAT:  The three numbered steps, in order.
 * WHY:   A list rather than three hand-written blocks, so the numbering comes
 *        from the position and cannot end up as 1, 2, 2 after an edit.
 * WHERE: The dialog's body.
 */
export const HOW_IT_WORKS_STEPS: readonly {
  title: string;
  body: string;
}[] = [
  {
    title: "Pick who's talking",
    body: "One narrator, or two people in conversation — one explains, one asks the questions you'd ask.",
  },
  {
    title: "Give them the words",
    body: "Paste a script, or tell the AI the topic and it writes it. You hear every voice before anything is animated.",
  },
  {
    title: "The AI does the rest",
    body: "It analyzes the words and decides the visuals, motion, assets, and pacing on its own. Every frame is reviewed before your video reaches you.",
  },
];
