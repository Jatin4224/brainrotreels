/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AssetPicker barrel, PickedAsset
 *
 * WHAT:  The media library picker's public surface.
 * WHY:   Named in the assets router's own notes as "the editor's asset picker
 *        in Phase 15" — this is it. Global because nothing in it is
 *        project-shaped: it takes the kinds a lane accepts and returns a
 *        choice, so any screen that needs a piece of the workspace's media can
 *        use it.
 * WHERE: The timeline editor's add-media control.
 */

export { AssetPicker } from "./asset-picker";
export type { AssetPickerProps, PickedAsset } from "./asset-picker";
