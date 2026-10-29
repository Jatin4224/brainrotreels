/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: visuals barrel, pickBestStockResult,
 *   orderStockResults, scoreStockResult, VISUALS_STAY_PURE
 *
 * WHAT:  The one import surface for the visual-selection rules.
 *
 * WHY:   VISUALS_STAY_PURE. Everything under src/lib/visuals/ is pure — no
 *        Prisma, no `server-only`, no provider SDK, no clock — exactly as
 *        src/lib/generators/, src/lib/quiz/ and src/lib/credits/ are. The
 *        decisions that can actually be WRONG here (which clip is best for a
 *        block, how a tie resolves) are therefore testable with no key and no
 *        spend, which is the only way a rule about picture quality gets checked
 *        at all before somebody watches a video.
 *
 *        The impure half — searching, generating, moderating, ingesting — is
 *        src/services/visuals.service.ts, which is `server-only` and is the
 *        only layer here that touches the database.
 * WHERE: Imported by src/services/visuals.service.ts and the visuals router.
 */

export {
  orderStockResults,
  pickBestStockResult,
  scoreStockResult,
} from "./select";
export type { StockScoreInput } from "./select";
