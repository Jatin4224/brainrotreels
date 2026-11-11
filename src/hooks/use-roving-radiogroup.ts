"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: useRovingRadioGroup, RovingRadioGroup,
 *   ROVING_TABINDEX, ACTIVE_FOLLOWS_SELECTION, RADIOGROUP_NOT_A_LIST_OF_BUTTONS,
 *   columnCount, CLAMPED_NOT_WRAPPED, BackgroundPicker, PricingCard
 *
 * WHAT:  The keyboard half of a `radiogroup`: which option owns the single tab
 *        stop, and how the arrow keys move between them in a grid whose column
 *        count is only known once the browser has laid it out.
 *
 * WHY:   A group of options is a `radiogroup` of `radio`s, not a list of
 *        buttons — a screen reader should say "2 of 5", and Tab should land on
 *        the current choice and then leave the group rather than walking every
 *        tile. That behaviour is ~70 lines of fiddly measurement and index
 *        arithmetic, and it was written once for the background picker. The
 *        pricing grid needed exactly the same thing, so it is extracted here
 *        rather than copied: two radiogroups, one implementation, and a fix to
 *        the arrow-key maths lands in both.
 *
 *        ACTIVE_FOLLOWS_SELECTION. The active option is DERIVED, not
 *        synchronised: until somebody moves within the group it is whichever
 *        option is checked, so tabbing in lands on the current choice, and an
 *        external change (a server write, another tab) moves the tab stop with
 *        it. An effect mirroring `selectedId` into state would do the same
 *        thing one render later and cost a cascading render.
 *
 *        COLUMN COUNT IS MEASURED, NOT CONFIGURED. The grids these drive are
 *        responsive, so the number of options on a row cannot be a constant,
 *        and `offsetTop` is the one thing that knows where the browser
 *        actually put them. Falls back to 1, which degrades Up/Down to
 *        Left/Right rather than to nothing.
 *
 *        CLAMPED_NOT_WRAPPED. Pressing Right on the last option of a row stays
 *        put instead of jumping to the next row. Wrapping is what a LIST does;
 *        these are grids, and somebody at the edge of one expects to stop.
 *
 * WHERE: src/components/global/background-picker/background-picker.tsx and the
 *        pricing grid in src/components/global/upgrade-modal/upgrade-content.tsx.
 *        The consumer owns the markup — this hook only answers "is this one
 *        tabbable", "give me a ref for it" and "handle this keydown".
 */

import * as React from "react";

export interface RovingRadioGroup<TId extends string> {
  /** The option the arrow keys are on, and the only tab stop. Undefined only
   * while the group is empty. */
  activeId: TId | undefined;
  /** Ref callback for the option's element, so the hook can focus and measure it. */
  registerRef: (id: TId) => (element: HTMLElement | null) => void;
  /** Attach to the element carrying `role="radiogroup"`. */
  handleKeyDown: (event: React.KeyboardEvent) => void;
}

export function useRovingRadioGroup<TId extends string>({
  ids,
  selectedId,
}: {
  /** Every option, in the order they are rendered. */
  ids: readonly TId[];
  /** The checked option, or null before anything is selected — a group whose
   * options are still loading still has to render. */
  selectedId: TId | null | undefined;
}): RovingRadioGroup<TId> {
  const [movedTo, setMovedTo] = React.useState<TId | null>(null);

  /* Falls back to the first option so an unselected group is still
     reachable: with no tab stop at all, Tab would skip the group entirely. */
  const activeId: TId | undefined =
    movedTo !== null && ids.includes(movedTo)
      ? movedTo
      : (selectedId ?? ids[0]);

  const elements = React.useRef(new Map<TId, HTMLElement>());

  const registerRef = React.useCallback(
    (id: TId) => (element: HTMLElement | null) => {
      if (element === null) elements.current.delete(id);
      else elements.current.set(id, element);
    },
    [],
  );

  function focusOption(id: TId) {
    setMovedTo(id);
    elements.current.get(id)?.focus();
  }

  /* See COLUMN COUNT IS MEASURED above. */
  function columnCount(): number {
    const first = ids[0];
    const firstEl = first === undefined ? undefined : elements.current.get(first);
    if (firstEl === undefined) return 1;

    for (const [index, id] of ids.entries()) {
      const element = elements.current.get(id);
      if (element !== undefined && element.offsetTop !== firstEl.offsetTop) {
        return Math.max(1, index);
      }
    }
    return Math.max(1, ids.length);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (activeId === undefined) return;
    const index = ids.indexOf(activeId);
    if (index < 0) return;

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = ids[event.key === "Home" ? 0 : ids.length - 1];
      if (target !== undefined) focusOption(target);
      return;
    }

    const columns = columnCount();
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };

    const delta = moves[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    /* CLAMPED_NOT_WRAPPED — see the note above. */
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) focusOption(next);
  }

  return { activeId, registerRef, handleKeyDown };
}
