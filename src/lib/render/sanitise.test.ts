/**
 * SOURCE OF TRUTH KEYWORDS: dropUnknownRenderKinds, FORWARD_COMPATIBLE_DOCUMENT,
 *                           ONE_BAD_ITEM_IS_NOT_A_BAD_DOCUMENT, sanitise tests
 *
 * WHAT:  What happens to a document carrying a render kind this build has
 *        never heard of.
 * WHY:   This is the forward-compatibility guard, and the failure it prevents
 *        is expensive and silent: a document written by a newer release,
 *        rendered by a worker still on the old one, would fail the strict
 *        schema on ONE unrecognised overlay and come out as a fully black
 *        video. architecture.md's rule is that a bad item draws nothing and
 *        the render completes, and these cases are what hold that true.
 *        The input is deliberately raw JSON rather than a parsed TimelineDoc —
 *        this function runs BEFORE validation, on whatever arrived, so the
 *        tests feed it malformed shapes on purpose.
 * WHERE: Run by `npm test`. Guards src/lib/render/sanitise.ts.
 */

import { describe, expect, it } from 'vitest'

import { resolveWordAnchors } from '@/lib/timeline'
import { redditStoryFixture } from '@/lib/timeline/fixtures'
import { dropUnknownRenderKinds } from './sanitise'

function docWithRender(render: unknown) {
  return {
    version: 4,
    tracks: [
      {
        id: 't1',
        type: 'overlay',
        items: [
          { id: 'keep', render: 'text', text: 'hello' },
          { id: 'suspect', render },
        ],
      },
    ],
  }
}

describe('dropUnknownRenderKinds', () => {
  it('keeps every item when all render kinds are known', () => {
    const doc = resolveWordAnchors(redditStoryFixture())
    const result = dropUnknownRenderKinds(doc)

    expect(result.droppedCount).toBe(0)
    expect(result.droppedKinds).toEqual([])
    /* `redditCard` is a KNOWN kind with no component yet — it survives
     * sanitising and is handled by the registry's own fallback instead. */
    expect(JSON.stringify(result.doc)).toContain('redditCard')
  })

  it('drops an item whose render kind is outside the union, and reports it', () => {
    const result = dropUnknownRenderKinds(docWithRender('someFutureThing'))

    expect(result.droppedCount).toBe(1)
    expect(result.droppedKinds).toEqual(['someFutureThing'])

    const items = (result.doc['tracks'] as { items: { id: string }[] }[])[0]?.items ?? []
    expect(items.map((item) => item.id)).toEqual(['keep'])
  })

  /* The whole point: the REST of the document survives. */
  it('leaves the rest of the document intact', () => {
    const doc = resolveWordAnchors(redditStoryFixture())
    const poisoned = {
      ...doc,
      tracks: [
        ...doc.tracks,
        { id: 'future', type: 'overlay', items: [{ id: 'f1', render: 'hologram' }] },
      ],
    }

    const result = dropUnknownRenderKinds(poisoned)
    expect(result.droppedCount).toBe(1)

    const tracks = result.doc['tracks']
    expect(Array.isArray(tracks)).toBe(true)
    /* Every original track is still there — only the item went. */
    expect((tracks as unknown[]).length).toBe(doc.tracks.length + 1)
  })

  /* Audio and caption items legitimately have no `render` field. Dropping
   * them would silence every video. */
  it('keeps items that declare no render kind at all', () => {
    const result = dropUnknownRenderKinds({
      tracks: [{ id: 'a', type: 'audio', items: [{ id: 'a1', assetId: 'x' }] }],
    })
    expect(result.droppedCount).toBe(0)
  })

  /* A non-string `render` is malformed in a way the strict parse should
   * report with a field path — sanitising must not swallow it. */
  it('leaves a non-string render value for the schema to reject', () => {
    expect(dropUnknownRenderKinds(docWithRender(42)).droppedCount).toBe(0)
    expect(dropUnknownRenderKinds(docWithRender(null)).droppedCount).toBe(0)
  })

  it('reports each unknown kind once however many items carry it', () => {
    const result = dropUnknownRenderKinds({
      tracks: [
        {
          id: 't',
          type: 'overlay',
          items: [
            { id: '1', render: 'hologram' },
            { id: '2', render: 'hologram' },
            { id: '3', render: 'scratchAndSniff' },
          ],
        },
      ],
    })

    expect(result.droppedCount).toBe(3)
    expect(result.droppedKinds.sort()).toEqual(['hologram', 'scratchAndSniff'])
  })

  /* Never mutates: the caller may be the editor holding this object in an
   * undo stack. */
  it('does not mutate its input', () => {
    const input = docWithRender('someFutureThing')
    const before = JSON.stringify(input)
    dropUnknownRenderKinds(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('survives shapes that are not documents at all', () => {
    expect(dropUnknownRenderKinds(null).droppedCount).toBe(0)
    expect(dropUnknownRenderKinds('nonsense').doc).toEqual({})
    expect(dropUnknownRenderKinds({ tracks: 'not an array' }).droppedCount).toBe(0)
  })
})
