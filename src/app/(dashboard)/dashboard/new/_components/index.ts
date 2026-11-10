/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: composer _components barrel, ComposerScreen,
 *   ComposerSettingPill, YourVideos, TRY_ONE_PROMPTS
 *
 * WHAT:  Public surface of the composer screen's own components.
 * WHY:   One import in the page, and the one place that says which of these
 *        are meant to be used from outside the folder. Route-local: the
 *        composer serves exactly one screen, while the FORMAT registry it
 *        reads is global (src/lib/config/formats.ts) because three surfaces
 *        need it.
 * WHERE: Imported as './_components' by
 *        src/app/(dashboard)/dashboard/new/page.tsx.
 */

export { ComposerScreen } from "./composer-screen";
export type { ComposerScreenProps } from "./composer-screen";
export { ComposerSettingPill } from "./composer-setting-pill";
export type {
  ComposerSettingPillProps,
  ComposerSettingOption,
} from "./composer-setting-pill";
export { YourVideos } from "./your-videos";
export { TRY_ONE_PROMPTS } from "./composer-content";
export { HowItWorksDialog } from "./how-it-works-dialog";
export type { HowItWorksDialogProps } from "./how-it-works-dialog";
export {
  HOW_IT_WORKS,
  HOW_IT_WORKS_STEPS,
  HOW_IT_WORKS_VIDEO,
} from "./how-it-works-content";
export type { HowItWorksVideo } from "./how-it-works-content";
