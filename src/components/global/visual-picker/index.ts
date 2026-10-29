/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: visual-picker barrel, VisualPicker,
 *   VisualPickerProps
 *
 * WHAT:  Public surface of the per-paragraph visual chooser.
 * WHY:   One import surface, as every other global component has, so the
 *        internal split between the list, the row and the swap drawer stays
 *        free to change — Phase 15's editor will want the row and the drawer in
 *        a different arrangement, and a caller that imported the file directly
 *        would pin it.
 * WHERE: Imported as '@/components/global/visual-picker'.
 */

export { VisualPicker, type VisualPickerProps } from "./visual-picker";
