/**
 * SOURCE OF TRUTH KEYWORDS: renderCacheKey, docHash, RENDER_REUSE,
 *   KEY_COVERS_THE_OUTPUT, RENDER_KEY_VERSION, render reuse tests
 *
 * WHAT:  The cache key that decides whether a render is free or billed.
 * WHY:   This is the highest-stakes pure function in Phase 04 and the only one
 *        whose bugs are invisible: every failure mode here LOOKS like success.
 *        A key that is too coarse returns somebody the wrong video and nothing
 *        errors; a key that is too fine bills them twice and nothing errors
 *        either. So the tests are written as the two directions rather than as
 *        coverage of the implementation:
 *
 *          - MUST COLLIDE for two requests that would produce the same file,
 *            or reuse stops working and customers pay for renders they already
 *            have.
 *          - MUST DIFFER for any input that changes the file, or they are
 *            served a video that does not match what they asked for.
 *
 *        The second set is the one that matters. A new render option added
 *        without being folded into the key is the exact mistake this file
 *        exists to make fail, and `covers every input that changes the output`
 *        below is deliberately written so that adding a field to
 *        RenderCacheInputs breaks it until a case is added.
 * WHERE: Run by `npm test`. Guards src/lib/render/cache-key.ts.
 */

import { describe, expect, it } from 'vitest'

import { redditStoryFixture, voiceoverFixture } from '@/lib/timeline/fixtures'
import { resolveWordAnchors } from '@/lib/timeline'
import { RENDER_KEY_VERSION, renderCacheKey, type RenderCacheInputs } from './cache-key'

const doc = resolveWordAnchors(redditStoryFixture())
const otherDoc = resolveWordAnchors(voiceoverFixture())

const base: RenderCacheInputs = { doc, resolution: '1080p', watermark: false }

describe('renderCacheKey', () => {
  it('is stable across calls for identical inputs', () => {
    /* The whole premise of reuse. If this were ever false — a Map iteration
     * order, a float formatting difference — nothing would ever be reused and
     * every render would be billed, with no error anywhere to explain it. */
    expect(renderCacheKey(base)).toBe(renderCacheKey(base))
  })

  it('collides for two separately-built documents with the same content', () => {
    /* `hashDoc` hashes content, not identity. A customer rendering the same
     * project twice gets two distinct in-memory documents, and they must key
     * the same or reuse never fires in practice. */
    const rebuilt = resolveWordAnchors(redditStoryFixture())
    expect(renderCacheKey({ ...base, doc: rebuilt })).toBe(renderCacheKey(base))
  })

  it('differs when the document differs', () => {
    expect(renderCacheKey({ ...base, doc: otherDoc })).not.toBe(renderCacheKey(base))
  })

  /**
   * KEY_COVERS_THE_OUTPUT — the two live failure modes, named as what they
   * would cost rather than as what they assert.
   */
  it('differs by resolution, so a 720p render cannot satisfy a request for 1080p', () => {
    expect(renderCacheKey({ ...base, resolution: '720p' })).not.toBe(
      renderCacheKey({ ...base, resolution: '1080p' }),
    )
  })

  it('differs by watermark, so an upgraded workspace is not handed its old watermarked file', () => {
    expect(renderCacheKey({ ...base, watermark: true })).not.toBe(
      renderCacheKey({ ...base, watermark: false }),
    )
  })

  /**
   * SOURCE OF TRUTH KEYWORDS: KEY_COVERS_THE_OUTPUT
   *
   * The guard against the mistake this module exists to prevent: a new render
   * option that changes the picture but not the key. The `satisfies` forces
   * this list to name every field of RenderCacheInputs, so adding one makes
   * this file fail to compile until somebody decides — in a diff, where it can
   * be reviewed — whether it belongs in the key.
   */
  it('covers every input that changes the output', () => {
    const covered = {
      doc: true,
      resolution: true,
      watermark: true,
    } satisfies Record<keyof RenderCacheInputs, true>

    expect(Object.keys(covered).sort()).toEqual(['doc', 'resolution', 'watermark'])

    /* And each one actually moves the key — asserted together so a field that
     * is listed but silently ignored by the implementation still fails. */
    const variants: RenderCacheInputs[] = [
      base,
      { ...base, doc: otherDoc },
      { ...base, resolution: '720p' },
      { ...base, watermark: true },
    ]
    expect(new Set(variants.map(renderCacheKey)).size).toBe(variants.length)
  })

  it('carries the key version, so a composition change can invalidate the cache', () => {
    /* RENDER_KEY_VERSION is the only way to express "the document is the same
     * but the renderer now draws it differently". If the version stopped
     * reaching the key, bumping it would silently do nothing — and the whole
     * point of it is to be reached for exactly once, in a hurry, when a render
     * bug has shipped. */
    expect(renderCacheKey(base).startsWith(`v${RENDER_KEY_VERSION}-`)).toBe(true)
  })

  it('stays short and safe in a column, a filename and a URL', () => {
    /* It is stored in a unique index and printed in log lines, so an
     * unbounded or escape-needing key would be a problem far from here. */
    const key = renderCacheKey(base)
    expect(key.length).toBeLessThan(64)
    expect(key).toMatch(/^[a-z0-9-]+$/)
  })
})
