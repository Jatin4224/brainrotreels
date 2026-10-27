/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listScriptBlocks, findScriptBlock, replaceScript,
 *   updateBlockText, insertBlock, deleteBlock, reorderBlocks,
 *   TENANT_SCOPED_QUERY, REPLACE_IS_ATOMIC, POSITION_IS_DENSE,
 *   BYTE_IDENTICAL_NEIGHBOURS, DbClient
 *
 * WHAT:  Every read and write of the `script_block` table.
 *
 * WHY:   TENANT_SCOPED_QUERY, as in every other service here: each function
 *        takes `organizationId` and puts it in the WHERE clause even when it
 *        also has a primary key. The procedure factory proves the CALLER
 *        belongs to the org they named; it says nothing about the row.
 *
 *        BYTE_IDENTICAL_NEIGHBOURS is the property the phase asks for by name
 *        — "regenerating the hook leaves every other block byte-identical" —
 *        and it is why this file has NO function that rewrites the whole
 *        script in place. `updateBlockText` touches one row by id.
 *        `replaceScript` deletes and recreates, and is used only when a whole
 *        script is generated afresh. There is deliberately no
 *        `upsertAllBlocks`, because that is the shape that quietly rewrites
 *        text somebody edited by hand.
 *
 *        POSITION_IS_DENSE: positions are 0..n-1 with no gaps, rewritten
 *        whenever the set changes. The alternative — sparse positions with
 *        gaps to insert into — avoids a renumber but makes every read depend
 *        on a sort whose keys drift apart, and eventually two blocks collide
 *        anyway. A script is at most a few dozen rows, so renumbering is
 *        cheap and leaves the data obvious to anybody reading it in SQL.
 *
 *        Business rules — what a script costs, whether the plan allows it,
 *        what the model is asked — live in the router and src/lib/script.
 *        This file moves rows.
 * WHERE: src/trpc/routers/scripts.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { type DbClient } from "@/lib/config/prisma";
import {
  estimateSpokenSeconds,
  type ScriptBlockDraft,
  type SectionType,
} from "@/lib/types/script";

/**
 * SOURCE OF TRUTH KEYWORDS: SCRIPT_BLOCK_SELECT, ScriptBlockRow
 *
 * WHAT:  The columns the editor renders.
 * WHY:   Explicit rather than a bare `findMany`, matching every other list in
 *        this codebase. `organizationId` is omitted from the payload — the
 *        caller already knows it (it had to, to make the query) and shipping a
 *        tenancy identifier to the browser invites client code to start making
 *        decisions with it.
 * WHERE: listScriptBlocks; the script editor.
 */
export const SCRIPT_BLOCK_SELECT = {
  id: true,
  projectId: true,
  position: true,
  sectionType: true,
  narrationText: true,
  durationEstimate: true,
  speakerTag: true,
  updatedAt: true,
} as const satisfies Prisma.ScriptBlockSelect;

export type ScriptBlockRow = Prisma.ScriptBlockGetPayload<{
  select: typeof SCRIPT_BLOCK_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: listScriptBlocks, POSITION_IS_DENSE
 *
 * WHAT:  A project's script, in order.
 * WHY:   Ordered by `position` then `createdAt`. The tiebreak matters because
 *        `position` is not unique (see the note on the model): a duplicate
 *        from a concurrent insert produces a stable order rather than one that
 *        changes between reads.
 * WHERE: `scripts.list`, and every write that needs the current order.
 */
export async function listScriptBlocks(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<ScriptBlockRow[]> {
  return db.scriptBlock.findMany({
    where: { organizationId, projectId },
    select: SCRIPT_BLOCK_SELECT,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: findScriptBlock, TENANT_SCOPED_QUERY
 *
 * WHAT:  One block, by id, only if this workspace owns it.
 * WHY:   Returns null rather than throwing so the caller answers NOT_FOUND —
 *        distinguishing "no such block" from "not yours" with different status
 *        codes tells an attacker which ids are real.
 * WHERE: Every single-block mutation.
 */
export async function findScriptBlock(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<ScriptBlockRow | null> {
  return db.scriptBlock.findFirst({
    where: { id, organizationId },
    select: SCRIPT_BLOCK_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: replaceScript, REPLACE_IS_ATOMIC,
 *   GENERATION_REPLACES_EVERYTHING
 *
 * WHAT:  Swaps a project's entire script for a freshly generated one.
 *
 * WHY:   REPLACE_IS_ATOMIC — the delete and the inserts are one transaction,
 *        because the halfway state is a project with NO script. A customer
 *        whose generation failed between the two would open the editor to an
 *        empty page and reasonably conclude their work was destroyed.
 *
 *        GENERATION_REPLACES_EVERYTHING, and it is a product decision worth
 *        stating: generating a script DISCARDS whatever was there, including
 *        hand edits. It is not a merge. A merge has no correct answer — there
 *        is no way to tell which of the new blocks "corresponds to" an edited
 *        old one — and guessing would silently keep stale text in a script the
 *        customer asked to be rewritten. The UI is responsible for confirming
 *        before calling this; `scripts.regenerateBlock` is the non-destructive
 *        path for changing part of a script.
 *
 *        Positions are assigned HERE from the array order, never taken from
 *        the model (MODEL_OUTPUT_SCHEMA has no position field). Asking a model
 *        for indices invites gaps and duplicates that then need repairing.
 * WHERE: The `scripts.generate` handler, inside its transaction.
 */
export async function replaceScript(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    /**
     * SOURCE OF TRUTH KEYWORDS: SPEAKER_TAG_IS_OPTIONAL
     *
     * Phase 12 widened this from `ScriptBlockDraft`. A block may now name the
     * SPEAKER that says it, which is what makes a multi-voice format possible
     * — and it is optional rather than required because a single-narrator
     * script genuinely has no cast to choose from. An absent tag is defaulted
     * to `narrator` by `splitScriptIntoLines`, so nothing downstream needs to
     * know which kind of script it is looking at.
     */
    blocks: readonly (ScriptBlockDraft & { speakerTag?: string | undefined })[];
  },
): Promise<number> {
  await db.scriptBlock.deleteMany({
    where: { organizationId: args.organizationId, projectId: args.projectId },
  });

  if (args.blocks.length === 0) return 0;

  const result = await db.scriptBlock.createMany({
    data: args.blocks.map((block, index) => ({
      organizationId: args.organizationId,
      projectId: args.projectId,
      position: index,
      sectionType: block.sectionType,
      narrationText: block.narrationText,
      /* Derived here rather than taken from the caller, so the stored duration
       * is always the one implied by the stored text — they cannot drift. */
      durationEstimate: estimateSpokenSeconds(block.narrationText),
      /* Omitted rather than written as null when absent, so the column keeps
       * whatever default it has and `exactOptionalPropertyTypes` is satisfied
       * without a cast. */
      ...(block.speakerTag !== undefined && block.speakerTag.length > 0
        ? { speakerTag: block.speakerTag }
        : {}),
    })),
  });

  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: updateBlockText, BYTE_IDENTICAL_NEIGHBOURS
 *
 * WHAT:  Changes one block's words, and nothing else.
 * WHY:   BYTE_IDENTICAL_NEIGHBOURS — a single-row update by id, so no other
 *        block is written at all. This is the function behind both an inline
 *        edit and a per-block regenerate, which is why the duration is
 *        recomputed from the new text here rather than passed in: the two
 *        callers must not be able to disagree about it.
 *
 *        Scoped by `organizationId` as well as id, so a guessed id from
 *        another workspace matches nothing.
 * WHERE: `scripts.updateBlock` and `scripts.regenerateBlock`.
 */
export async function updateBlockText(
  db: DbClient,
  organizationId: string,
  id: string,
  narrationText: string,
): Promise<number> {
  const result = await db.scriptBlock.updateMany({
    where: { id, organizationId },
    data: {
      narrationText,
      durationEstimate: estimateSpokenSeconds(narrationText),
    },
  });
  return result.count;
}

/**
 * SOURCE OF TRUTH KEYWORDS: insertBlock, POSITION_IS_DENSE
 *
 * WHAT:  Adds an empty block, optionally after a given one.
 * WHY:   The new block's text is empty and that is deliberate — an "add block"
 *        button that generated text would be a billed model call behind a
 *        control that does not look like one. The customer types, or presses
 *        regenerate.
 *
 *        Everything after the insertion point is shifted in the same
 *        transaction, keeping positions dense. `increment` rather than a
 *        read-then-write so two concurrent inserts cannot both read the same
 *        positions and collide.
 * WHERE: `scripts.addBlock`.
 */
export async function insertBlock(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    sectionType: SectionType;
    afterPosition: number | null;
  },
): Promise<ScriptBlockRow> {
  const position =
    args.afterPosition === null
      ? await nextPosition(db, args)
      : args.afterPosition + 1;

  if (args.afterPosition !== null) {
    await db.scriptBlock.updateMany({
      where: {
        organizationId: args.organizationId,
        projectId: args.projectId,
        position: { gte: position },
      },
      data: { position: { increment: 1 } },
    });
  }

  return db.scriptBlock.create({
    data: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      position,
      sectionType: args.sectionType,
      narrationText: "",
      durationEstimate: 0,
    },
    select: SCRIPT_BLOCK_SELECT,
  });
}

async function nextPosition(
  db: DbClient,
  args: { organizationId: string; projectId: string },
): Promise<number> {
  const last = await db.scriptBlock.findFirst({
    where: { organizationId: args.organizationId, projectId: args.projectId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last === null ? 0 : last.position + 1;
}

/**
 * SOURCE OF TRUTH KEYWORDS: deleteBlock, POSITION_IS_DENSE
 *
 * WHAT:  Removes one block and closes the gap it leaves.
 * WHY:   The renumber is in the same transaction as the delete. Without it,
 *        positions develop holes — harmless on its own, but `insertBlock`
 *        computes an insertion point from them, so a gap eventually places a
 *        new block somewhere nobody asked for.
 * WHERE: `scripts.deleteBlock`.
 */
export async function deleteBlock(
  db: DbClient,
  organizationId: string,
  block: { id: string; projectId: string; position: number },
): Promise<void> {
  await db.scriptBlock.deleteMany({ where: { id: block.id, organizationId } });

  await db.scriptBlock.updateMany({
    where: {
      organizationId,
      projectId: block.projectId,
      position: { gt: block.position },
    },
    data: { position: { decrement: 1 } },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: reorderBlocks, ORDER_IS_SENT_WHOLE
 *
 * WHAT:  Applies a new order to a project's blocks.
 *
 * WHY:   ORDER_IS_SENT_WHOLE. The caller sends the complete ordered list of
 *        ids, not a from/to pair, and this writes each row's new index. A move
 *        pair is smaller on the wire and wrong under concurrency: two drags
 *        that each describe a move relative to a list they saw produce an
 *        order neither person chose, while two whole orders produce the second
 *        one — last write wins, which is at least an order somebody picked.
 *
 *        Ids not belonging to this project are IGNORED rather than rejected.
 *        The update is scoped by `organizationId` and `projectId`, so a forged
 *        id matches no row — refusing the whole reorder over one stale id
 *        would instead break the editor for anybody whose list was slightly
 *        behind.
 * WHERE: `scripts.reorder`.
 */
export async function reorderBlocks(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    orderedIds: readonly string[];
  },
): Promise<number> {
  let updated = 0;

  for (const [index, id] of args.orderedIds.entries()) {
    const result = await db.scriptBlock.updateMany({
      where: {
        id,
        organizationId: args.organizationId,
        projectId: args.projectId,
      },
      data: { position: index },
    });
    updated += result.count;
  }

  return updated;
}

/**
 * SOURCE OF TRUTH KEYWORDS: countScriptBlocks
 *
 * WHAT:  How many blocks a project's script has.
 * WHY:   A count rather than a list, for the one caller that needs to know
 *        whether a script EXISTS — the project screen's "generate" versus
 *        "edit" state. Loading every block's text to learn that is a page
 *        load's worth of narration for a boolean.
 * WHERE: The projects list and the generation form's confirm step.
 */
export async function countScriptBlocks(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<number> {
  return db.scriptBlock.count({ where: { organizationId, projectId } });
}
