/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: useTimelineEditor, TimelineEditorState, SaveState,
 *   AUTOSAVE_IS_DEBOUNCED, ONE_SAVE_IN_FLIGHT, CONFLICT_IS_OFFERED_NOT_FORCED,
 *   KEYBOARD_IS_THE_EDITOR, OPS_ONLY, LOCAL_APPLY_THEN_SAVE
 *
 * WHAT:  The editor's client state: the session, the debounced autosave, the
 *        conflict answer, the playhead, the selection, and the shortcuts.
 *
 * WHY:   OPS_ONLY. `edit()` is the single way anything in this screen changes
 *        the document, and all it does is hand ops to `editSession`, which runs
 *        the SAME `apply()` the server runs. There is no other writer — no
 *        setState on a track, no splice on an items array — which is the
 *        property that makes the preview and the paid render agree. A second
 *        writer anywhere in this screen would break that silently, so every
 *        component below takes `edit` and nothing mutable.
 *
 *        LOCAL_APPLY_THEN_SAVE: the document is applied locally first so the
 *        player redraws on the same frame as the gesture, and the save follows
 *        on a timer. Waiting for the server would make dragging a clip edge
 *        feel like a form submission.
 *
 *        AUTOSAVE_IS_DEBOUNCED and ONE_SAVE_IN_FLIGHT together are what keep a
 *        drag from becoming forty requests and two requests from racing each
 *        other into a conflict of our own making. Ops made during a flight are
 *        kept by the session and sent by the next tick — QUEUE_SURVIVES_A_FLIGHT
 *        there.
 *
 *        CONFLICT_IS_OFFERED_NOT_FORCED: a conflict stops the autosave and
 *        raises a banner with a reload button. It does NOT reload by itself,
 *        because the customer's unsaved work is on this screen and throwing it
 *        away without asking is the one outcome the phase forbids.
 *
 *        KEYBOARD_IS_THE_EDITOR — the shortcuts live here rather than on the
 *        tracks panel so they work wherever focus is, and they stand down while
 *        a text field has focus so typing "s" into a caption does not split a
 *        clip.
 *
 * WHERE: Used by timeline-editor.tsx, which passes the parts of it down. The
 *        session itself is src/lib/timeline/session.ts.
 */

import * as React from "react";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import {
  canRedo,
  canUndo,
  confirmSession,
  documentLength,
  editSession,
  isDirty,
  openSession,
  pendingOps,
  redoSession,
  undoSession,
  type EditorSession,
  type Op,
  type TimelineDoc,
  type TimelineItemRef,
  iterateItems,
} from "@/lib/timeline";
import { TIMELINE_AUTOSAVE_MS, type TimelineWireError } from "@/lib/types";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/routers/_app";

/**
 * SOURCE OF TRUTH KEYWORDS: OpenTimelineData, NarrationLineSummary,
 *   DERIVED_FROM_THE_ROUTER
 *
 * WHAT:  The open query's payload, and one narration line out of it.
 * WHY:   DERIVED_FROM_THE_ROUTER, the same choice FeatureGatesData makes:
 *        adding a field to timelineEditor.open flows through to every consumer
 *        without a hand-written DTO that can drift from it. The line type is
 *        indexed out of the array rather than re-declared, so the inspector's
 *        props cannot describe a shape the server does not send.
 * WHERE: TimelineEditorState below; the inspector's props.
 */
export type OpenTimelineData =
  inferRouterOutputs<AppRouter>["timelineEditor"]["open"];

export type NarrationLineSummary = OpenTimelineData["lines"][number];

/**
 * SOURCE OF TRUTH KEYWORDS: SaveState, SAVING_IS_VISIBLE
 *
 * WHAT:  What the save indicator says.
 * WHY:   SAVING_IS_VISIBLE is the phase's step 5. Four states rather than a
 *        boolean, because "nothing to save" and "saved" read the same to a
 *        machine and completely differently to a person who just dragged
 *        something.
 * WHERE: The toolbar's indicator.
 */
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict";

export interface TimelineEditorState {
  /** Null while loading, or when the project has no timeline to edit. */
  session: EditorSession | null;
  doc: TimelineDoc | null;
  saveState: SaveState;
  /** What the server refused to store, or what the result still breaks. */
  documentErrors: readonly TimelineWireError[];
  /** The selected id, or null when the document no longer holds it. */
  selectedItemId: string | null;
  /** The selected item with its track, resolved against the live document. */
  selected: TimelineItemRef | null;
  playhead: number;
  length: number;
  canUndo: boolean;
  canRedo: boolean;
  ripple: boolean;
  isLoading: boolean;
  loadError: string | null;
  /** Non-null when the project has no document the editor can open. */
  emptyReason: "no-timeline" | "unreadable" | null;
  edit: (ops: readonly Op[]) => void;
  undo: () => void;
  redo: () => void;
  select: (itemId: string | null) => void;
  seek: (seconds: number) => void;
  setRipple: (ripple: boolean) => void;
  saveNow: () => void;
  reload: () => void;
  items: readonly TimelineItemRef[];
  /* The read-only half of the open query, passed through rather than fetched
   * twice: the shell needs the signed URLs and the composition, and a second
   * useQuery on the same key is a second thing that can disagree. */
  assets: OpenTimelineData["assets"];
  composition: OpenTimelineData["composition"];
  lines: OpenTimelineData["lines"];
}

export function useTimelineEditor(projectId: string): TimelineEditorState {
  const organizationId = useActiveOrganizationId();
  const enabled = organizationId !== undefined;
  const input = { organizationId: organizationId ?? "", projectId };

  const utils = trpc.useUtils();
  const query = trpc.timelineEditor.open.useQuery(input, {
    enabled,
    retry: false,
    /* The editor owns the document once it is open: a refetch that replaced it
     * mid-edit would discard unsaved work and the undo stack with it. Reloading
     * is a deliberate act — see `reload`. */
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  const [session, setSession] = React.useState<EditorSession | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [documentErrors, setDocumentErrors] = React.useState<
    readonly TimelineWireError[]
  >([]);
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(
    null,
  );
  const [playhead, setPlayhead] = React.useState(0);
  const [ripple, setRipple] = React.useState(false);

  /* The query's document, adopted once. Keyed on the revision so a reload
   * genuinely re-opens while an ordinary re-render does not. */
  const loadedRevision = React.useRef<number | null>(null);
  React.useEffect(() => {
    const data = query.data;
    if (data?.doc === undefined || data.doc === null) return;
    if (loadedRevision.current === data.revision) return;

    loadedRevision.current = data.revision;
    setSession(openSession(data.doc, data.revision));
    setSaveState("idle");
    setDocumentErrors([]);
  }, [query.data]);

  const applyOps = trpc.timelineEditor.applyOps.useMutation();

  /* ONE_SAVE_IN_FLIGHT. A ref rather than state: the flush reads it on the
   * same tick it sets it, and a state update would not have landed yet. */
  const inFlight = React.useRef(false);

  /* The session as the flush sees it. A ref because the mutation must be
   * started from a handler or a timer, never from inside a setState updater —
   * React may run an updater twice, and a mutation fired from one would post
   * the same ops twice. Synced in an effect rather than during render, and
   * that is safe here because every reader is at least one debounce interval
   * later than the render that set it. */
  const sessionRef = React.useRef<EditorSession | null>(null);
  React.useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * SOURCE OF TRUTH KEYWORDS: flush, ONE_SAVE_IN_FLIGHT, SERVER_IS_THE_TRUTH
   *
   * Posts the queued ops and folds the answer back in.
   */
  const flush = React.useCallback(() => {
    const current = sessionRef.current;
    if (inFlight.current || current === null || !isDirty(current)) return;

    const ops = pendingOps(current);
    inFlight.current = true;
    setSaveState("saving");

    applyOps.mutate(
      {
        organizationId: organizationId ?? "",
        projectId,
        revision: current.revision,
        ops: [...ops],
      },
      {
        onSuccess: (result) => {
          inFlight.current = false;

          if (result.status === "conflict") {
            setSaveState("conflict");
            return;
          }
          if (result.status === "rejected") {
            /* The document the server would have stored breaks an invariant.
             * The local state KEEPS the edit so it can be fixed or undone —
             * silently reverting the screen would look like the gesture never
             * registered. */
            setSaveState("dirty");
            setDocumentErrors(result.errors);
            return;
          }

          setDocumentErrors(result.errors);
          setSession((latest) =>
            latest === null
              ? latest
              : confirmSession(latest, result.doc, result.revision, ops.length),
          );
          setSaveState((latest) => (latest === "conflict" ? latest : "saved"));
        },
        onError: (error) => {
          inFlight.current = false;
          /* Left dirty on purpose: the queue is intact, so the next tick
           * retries. The toast is the only way the customer learns that their
           * last minute of work is not on the server yet. */
          setSaveState("dirty");
          toast.error(`Could not save: ${error.message}`);
        },
      },
    );
    /* `applyOps` is stable across renders; depending on the primitives keeps
     * this callback from changing on every keystroke. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, projectId]);

  /* AUTOSAVE_IS_DEBOUNCED. The timer restarts on every edit, so a drag is one
   * request; it is cleared on unmount, and the `dirty` state is what a
   * beforeunload guard reads. */
  const dirty = session !== null && isDirty(session);
  React.useEffect(() => {
    if (!dirty || saveState === "conflict") return;

    const timer = window.setTimeout(flush, TIMELINE_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, saveState, flush, session]);

  /**
   * SOURCE OF TRUTH KEYWORDS: UNSAVED_WORK_IS_GUARDED
   *
   * The browser's own "leave site?" prompt while something is unsaved. The
   * autosave window is short, but a closed tab inside it loses work that the
   * customer has every reason to think is safe.
   */
  React.useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = React.useCallback((ops: readonly Op[]) => {
    if (ops.length === 0) return;

    setSession((current) => {
      if (current === null) return current;

      const next = editSession(current, ops);
      /* A refused gesture reports itself and changes nothing else — the
       * message is the op's own, which is why ops.ts writes them as sentences
       * rather than codes. */
      if (next === current || next.doc === current.doc) {
        const first = next.errors[0];
        if (first !== undefined) toast.error(first.message);
        return next;
      }

      setSaveState((latest) => (latest === "conflict" ? latest : "dirty"));
      setDocumentErrors([]);
      return next;
    });
  }, []);

  const undo = React.useCallback(() => {
    setSession((current) => {
      if (current === null || !canUndo(current)) return current;
      setSaveState((latest) => (latest === "conflict" ? latest : "dirty"));
      setDocumentErrors([]);
      return undoSession(current);
    });
  }, []);

  const redo = React.useCallback(() => {
    setSession((current) => {
      if (current === null || !canRedo(current)) return current;
      setSaveState((latest) => (latest === "conflict" ? latest : "dirty"));
      setDocumentErrors([]);
      return redoSession(current);
    });
  }, []);

  /**
   * SOURCE OF TRUTH KEYWORDS: reload, CONFLICT_IS_OFFERED_NOT_FORCED
   *
   * Takes the server's document and starts over. Called by the conflict
   * banner's button and by nothing automatic — see the file header.
   */
  const reload = React.useCallback(() => {
    loadedRevision.current = null;
    setSession(null);
    setSaveState("idle");
    setDocumentErrors([]);
    setSelectedItemId(null);
    void utils.timelineEditor.open.invalidate(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, projectId]);

  /**
   * SOURCE OF TRUTH KEYWORDS: KEYBOARD_IS_THE_EDITOR
   *
   * Undo, redo, split at the playhead, delete the selection. Stands down while
   * a text field or a contenteditable has focus, so editing caption text does
   * not fire the editor's single-letter shortcuts.
   */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (
          target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        )
          return;
      }

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === "s") {
        /* The customer asking for a save they already have. Prevented so the
         * browser does not offer to save the page as a file. */
        event.preventDefault();
        flush();
        return;
      }
      if (mod) return;

      if (key === "s" && selectedItemId !== null) {
        event.preventDefault();
        edit([{ type: "split", itemId: selectedItemId, at: playhead }]);
        return;
      }
      if (
        (key === "delete" || key === "backspace") &&
        selectedItemId !== null
      ) {
        event.preventDefault();
        edit([{ type: "delete", itemId: selectedItemId, ripple }]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [edit, undo, redo, flush, selectedItemId, playhead, ripple]);

  const doc = session?.doc ?? null;
  const items = React.useMemo(
    () => (doc === null ? [] : iterateItems(doc)),
    [doc],
  );
  const length = doc === null ? 0 : documentLength(doc);

  /**
   * SOURCE OF TRUTH KEYWORDS: SELECTION_IS_DERIVED
   *
   * A selection the last edit deleted resolves to nothing rather than being
   * cleared by an effect. DERIVED, not synchronised: the id in state is a
   * request and the document is the authority, so an item that no longer
   * exists is simply not selected — and there is no render in between where an
   * inspector could be bound to a missing item.
   */
  const selected = React.useMemo(
    () =>
      selectedItemId === null
        ? null
        : (items.find((ref) => ref.item.id === selectedItemId) ?? null),
    [items, selectedItemId],
  );

  const emptyReason: TimelineEditorState["emptyReason"] =
    query.data === undefined || query.data.doc !== null
      ? null
      : query.data.timelineErrors.length > 0
        ? "unreadable"
        : "no-timeline";

  return {
    session,
    doc,
    saveState: dirty && saveState === "saved" ? "dirty" : saveState,
    documentErrors,
    selectedItemId: selected?.item.id ?? null,
    selected,
    playhead,
    length,
    canUndo: session !== null && canUndo(session),
    canRedo: session !== null && canRedo(session),
    ripple,
    isLoading: !enabled || (query.isPending && query.data === undefined),
    loadError: query.error?.message ?? null,
    emptyReason,
    edit,
    undo,
    redo,
    select: setSelectedItemId,
    seek: setPlayhead,
    setRipple,
    saveNow: flush,
    reload,
    items,
    assets: query.data?.assets ?? {},
    composition: query.data?.composition ?? null,
    lines: query.data?.lines ?? [],
  };
}
