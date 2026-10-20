/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FIXTURES_BY_KIND, EXHAUSTIVE_BY_KIND, ProjectKind
 *
 * WHAT:  One fixture builder per project kind, keyed by kind.
 * WHY:   EXHAUSTIVE_BY_KIND. Typed as a full Record over ProjectKind, so adding
 *        a fifth format to PROJECT_KINDS fails to compile here until it has a
 *        fixture — which means the validation and render tests cover it from
 *        the day it exists rather than whenever someone remembers.
 * WHERE: The `every kind validates` test; the Phase 03 studio's composition
 *        list.
 */

import type { ProjectKind } from "@/lib/types/project";
import type { TimelineDoc } from "../schema";
import { motionFixture } from "./motion";
import { quizFixture } from "./quiz";
import { redditStoryFixture } from "./reddit-story";
import { voiceoverFixture } from "./voiceover";

export const FIXTURES_BY_KIND: Readonly<
  Record<ProjectKind, () => TimelineDoc>
> = {
  "reddit-story": redditStoryFixture,
  voiceover: voiceoverFixture,
  quiz: quizFixture,
  motion: motionFixture,
};
