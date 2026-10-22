/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GENERATORS, resolveGenerator, hasGenerator,
 *   generatorSkipsFor, THE_ONLY_EXTENSION_POINT, DOCUMENTED_GAP_NOT_A_STUB,
 *   GeneratorNotImplementedError
 *
 * WHAT:  The map from a project's `kind` to the generator that builds its
 *        document, and the lookup the pipeline uses.
 *
 * WHY:   THE_ONLY_EXTENSION_POINT, the same property src/remotion/registry.ts
 *        holds for components. Phase 12 adds the Reddit format by writing a
 *        generator and adding a key HERE; the workflow is not touched, because
 *        it asks this module which generator to run and which stages that kind
 *        skips. The moment a kind name appears inside
 *        src/inngest/functions/project-generate.ts, that property is gone and
 *        every later format pays for it.
 *
 *        DOCUMENTED_GAP_NOT_A_STUB: a `Partial<Record<…>>` rather than a full
 *        Record, which is the same decision RENDER_COMPONENTS made and for the
 *        same reason — a stub generator returning an empty document is
 *        indistinguishable from a working one at the type level and would
 *        produce a silent, black, paid-for video. The absence is the honest
 *        state, and `resolveGenerator` turns it into a named error the UI can
 *        put in front of a customer.
 *
 *        Note this is NOT the pattern FIXTURES_BY_KIND uses. A fixture must
 *        exist for every kind — that is what makes the validation tests cover a
 *        new format from the day it is declared — and a fixture is a hand-
 *        written example, which anyone can write. A generator is the real
 *        thing, and demanding one for every kind would mean declaring a format
 *        and building it in the same change.
 *
 *        `import 'server-only'` is deliberately absent even though a
 *        `GeneratorContext` carries a `DbClient`: every generator in here is a
 *        pure document builder, the type is erased at compile time, and
 *        marking the module server-only would stop Phase 15's editor from
 *        re-running a build client-side against a document it already holds.
 *        Nothing here opens a connection; the WORKFLOW supplies the client.
 * WHERE: Consumed by the `timeline` stage of
 *        src/inngest/functions/project-generate.ts and by
 *        src/services/pipeline.service.ts (for the skip list).
 */

import type { ProjectKind } from "@/lib/types/project";
import type { PipelineStageName } from "@/lib/types/pipeline";
import { GeneratorNotImplementedError, type Generator } from "./types";
import { voiceoverGenerator } from "./voiceover";

/**
 * SOURCE OF TRUTH KEYWORDS: GENERATORS
 *
 * Built in Phase 09:
 *   voiceover → narration over a styled background, captioned, optional music.
 *
 * Deliberately absent, each with the phase that adds it:
 *   reddit-story → Phase 12
 *   quiz         → Phase 13
 *   motion       → Phase 16
 *
 * Each of those kinds can already be CREATED (the create form offers all four,
 * from PROJECT_KINDS) and each already has a fixture and a renderable document
 * shape. What they do not have is a generator, so `projects.generate` refuses
 * them by name rather than running a pipeline that would fail at its last step.
 */
export const GENERATORS: Partial<Record<ProjectKind, Generator>> = {
  voiceover: voiceoverGenerator,
};

export function hasGenerator(kind: ProjectKind): boolean {
  return GENERATORS[kind] !== undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveGenerator, UNBUILT_KIND_IS_NAMED
 *
 * WHAT:  The generator for a kind, or a named error.
 * WHY:   Throws rather than returning null, because every caller has to refuse
 *        anyway and a nullable return would let one of them forget. The error
 *        carries the kind, so the message a customer reads says which format is
 *        not built yet.
 * WHERE: `projects.generate`'s pre-flight, and the `timeline` stage.
 */
export function resolveGenerator(kind: ProjectKind): Generator {
  const generator = GENERATORS[kind];
  if (generator === undefined) throw new GeneratorNotImplementedError(kind);
  return generator;
}

/**
 * SOURCE OF TRUTH KEYWORDS: generatorSkipsFor, SKIPS_LIVE_ON_THE_GENERATOR
 *
 * WHAT:  The stages a kind never runs.
 * WHY:   Never throws, unlike `resolveGenerator`. The workflow writes its
 *        `skipped` rows BEFORE it does anything else, so that the progress list
 *        is complete on the customer's first frame — including for a kind with
 *        no generator, whose run is about to fail with one honest message
 *        rather than a list of twelve pending stages that will never move.
 * WHERE: The workflow's stage seeding.
 */
export function generatorSkipsFor(
  kind: ProjectKind,
): readonly PipelineStageName[] {
  return GENERATORS[kind]?.skips ?? [];
}
