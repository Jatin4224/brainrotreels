# Phase 15: Timeline editor: captions, overlays and regeneration

**Feature:** Feature 9 (part 2)
**Depends on:** phase 14

## Goal

The editor covers everything a user needs to finish a video by hand, and manual edits are never silently overwritten.

## Build

- Caption editing: change text, regroup words, restyle, reposition, per-caption overrides.
- Overlays: add text, images and uploaded clips; move, resize and reorder (z).
- Audio: per-item gain, music picker, ducking toggle.
- Edit a narration line in the editor -> `line.resynth` -> re-align -> patch the timeline.
- Insert media from the library into any track.
- Regeneration policy for manually edited projects: regenerate into a NEW version/branch of the project; never overwrite the edited timeline. Show this choice clearly in the UI.

## Data

- Add project versioning as needed for the branch policy (for example `timelines` history rows or a `parent_project_id`).

## Done when

- [ ] Editing a caption's text never breaks its sync.
- [ ] Changing one narration line updates audio, timings and captions for that line only.
- [ ] Regenerating an edited project leaves the edited version intact and creates a new one.

## Not in this phase

- Motion graphics scenes.
