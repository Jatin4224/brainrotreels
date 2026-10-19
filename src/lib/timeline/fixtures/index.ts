/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: timeline fixtures, redditStoryFixture,
 *   voiceoverFixture, quizFixture, motionFixture, legacyV1Fixture,
 *   FIXTURES_BY_KIND, buildWords, FIXTURES_ARE_PRODUCTION_DATA
 *
 * WHAT:  One valid v4 document per project kind, plus a v1 document for the
 *        migration path.
 * WHY:   FIXTURES_ARE_PRODUCTION_DATA, which is why they live in src/ and not
 *        in a test folder. Phase 03's Remotion studio renders them as its
 *        development compositions, Phase 06's generators are written against
 *        their shape, and the tests assert on them — three consumers, one set,
 *        so a format change cannot pass the tests while breaking the studio.
 *        They are deliberately SMALL but complete: every one exercises its
 *        kind's distinctive track layout rather than being a minimal document
 *        that would validate without proving anything.
 *        Each is produced by a FUNCTION, not exported as a shared object: the
 *        ops are pure and the tests assert that they do not mutate their input,
 *        which a shared mutable fixture would quietly undermine.
 * WHERE: Imported by the tests in src/lib/timeline/, by the Remotion
 *        compositions in Phase 03, and by the generator tests in Phase 06.
 */

export { buildWords } from './words'
export { redditStoryFixture } from './reddit-story'
export { voiceoverFixture } from './voiceover'
export { quizFixture } from './quiz'
export { motionFixture } from './motion'
export { legacyV1Fixture } from './legacy-v1'
export { FIXTURES_BY_KIND } from './by-kind'
