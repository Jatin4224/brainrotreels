/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: background-picker barrel, BackgroundPicker,
 *   BackgroundPickerProps
 *
 * WHAT:  Public surface of the background chooser.
 * WHY:   One import path, so the internal split stays free to change — the same
 *        reason the media-upload barrel exists. The tile is deliberately NOT
 *        exported: it is an option inside a radiogroup and means nothing on its
 *        own, so a caller that reached for it would be building a second,
 *        inaccessible grid (RADIOGROUP_NOT_A_LIST_OF_BUTTONS).
 * WHERE: Imported as '@/components/global/background-picker'.
 */

export {
  BackgroundPicker,
  type BackgroundPickerProps,
} from "./background-picker";
