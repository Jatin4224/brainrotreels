/**
 * SOURCE OF TRUTH KEYWORDS: CONTENT_TYPE_ALLOWLIST, UPLOAD_BYTES_PER_PLAN,
 *                           createUploadUrlSchema, normalizeAssetFilters,
 *                           assetFilenameSchema, ASSET_TABS, asset types tests
 *
 * WHAT:  The upload contract: what the app accepts, how large, and how the
 *        toolbar's values become router input.
 * WHY:   Every assertion here guards a rule that is enforced in TWO places —
 *        the drop zone and the router — from one object (CLIENT_SERVER_MIRROR).
 *        A drifted allowlist does not fail loudly; it either refuses a file the
 *        server would have taken or accepts one it will not, and both look like
 *        a flaky upload rather than a bug.
 *        The per-plan caps get their own case because the free cap being BELOW
 *        the free plan's total storage is deliberate, not arithmetic that
 *        happens to work — raising it past the quota would let one file fill a
 *        workspace that then cannot be used.
 * WHERE: Run by `npm test`. Guards src/lib/types/asset.ts.
 */

import { describe, expect, it } from 'vitest'

import { PLAN_KEYS } from '@/lib/config/plans'
import { RESOURCES } from '@/lib/resources'
import {
  ASSET_FILTER_ALL,
  ASSET_FILTER_DEFAULTS,
  ASSET_TABS,
  CONTENT_TYPE_ALLOWLIST,
  UPLOAD_BYTES_CEILING,
  UPLOAD_BYTES_PER_PLAN,
  assetFilenameSchema,
  createUploadUrlSchema,
  extensionForContentType,
  isUploadContentType,
  kindForContentType,
  maxUploadBytesForPlan,
  mediaFamilyOf,
  normalizeAssetFilters,
} from './asset'

describe('CONTENT_TYPE_ALLOWLIST', () => {
  /* The eight types Phase 02 names. Asserted as a set rather than a length so
   * a swap is caught, not just an addition. */
  it('accepts exactly the declared formats', () => {
    expect(Object.keys(CONTENT_TYPE_ALLOWLIST).sort()).toEqual([
      'audio/mpeg',
      'audio/wav',
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ])
  })

  it('refuses anything else', () => {
    expect(isUploadContentType('video/x-matroska')).toBe(false)
    expect(isUploadContentType('application/pdf')).toBe(false)
    /* The empty string is what a browser reports for a file it cannot
     * identify, and it must not pass. */
    expect(isUploadContentType('')).toBe(false)
  })

  it('maps every type to a family, an extension and a kind', () => {
    for (const contentType of Object.keys(CONTENT_TYPE_ALLOWLIST)) {
      expect(mediaFamilyOf(contentType)).not.toBeNull()
      expect(extensionForContentType(contentType)).toBeTruthy()
      expect(kindForContentType(contentType)).not.toBeNull()
    }
  })

  /* The extension goes into the storage KEY, so it must never carry a
   * separator or a dot — assertKeySegment would reject the key and the upload
   * would fail at presign. */
  it('has extensions safe to use as a key segment', () => {
    for (const entry of Object.values(CONTENT_TYPE_ALLOWLIST)) {
      expect(entry.extension).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('lets a MOV upload through — it is what an iPhone produces', () => {
    expect(mediaFamilyOf('video/quicktime')).toBe('video')
  })
})

describe('UPLOAD_BYTES_PER_PLAN', () => {
  it('covers every plan', () => {
    for (const plan of PLAN_KEYS) {
      expect(maxUploadBytesForPlan(plan)).toBeGreaterThan(0)
    }
  })

  it('never exceeds the ceiling the client pre-checks against', () => {
    for (const plan of PLAN_KEYS) {
      expect(maxUploadBytesForPlan(plan)).toBeLessThanOrEqual(UPLOAD_BYTES_CEILING)
    }
  })

  it('rises with the plan', () => {
    expect(UPLOAD_BYTES_PER_PLAN.free).toBeLessThan(UPLOAD_BYTES_PER_PLAN.starter)
    expect(UPLOAD_BYTES_PER_PLAN.starter).toBeLessThan(UPLOAD_BYTES_PER_PLAN.pro)
  })

  /* PER_FILE_CAP_NOT_A_QUOTA. One file must not be able to fill a plan's whole
   * storage allowance — a workspace with a single 100 MB file and no room left
   * is worse than one that refused the upload. */
  it('keeps a capped plan\'s per-file limit below its total storage', () => {
    const storage = RESOURCES.storage.limit.perPlan
    for (const plan of PLAN_KEYS) {
      const total = storage[plan]
      if (total === 'unlimited') continue
      expect(maxUploadBytesForPlan(plan)).toBeLessThan(total)
    }
  })
})

describe('createUploadUrlSchema', () => {
  const valid = {
    organizationId: 'org_1',
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    bytes: 1024,
  }

  it('accepts a well-formed request', () => {
    expect(createUploadUrlSchema.safeParse(valid).success).toBe(true)
  })

  it('refuses a content type outside the allowlist', () => {
    expect(
      createUploadUrlSchema.safeParse({ ...valid, contentType: 'video/x-matroska' }).success
    ).toBe(false)
  })

  /* A 0-byte PUT succeeds and produces an asset that fails ingest for a reason
   * the customer cannot act on, so it is refused at the schema. */
  it('refuses an empty file', () => {
    expect(createUploadUrlSchema.safeParse({ ...valid, bytes: 0 }).success).toBe(false)
  })

  it('refuses a file larger than any plan allows', () => {
    expect(
      createUploadUrlSchema.safeParse({ ...valid, bytes: UPLOAD_BYTES_CEILING + 1 }).success
    ).toBe(false)
  })

  /* A client naming its own privileged kind is the escalation this guards:
   * `render_output` is billed for in Phase 04 and treated as pre-moderated. */
  it('refuses an asset kind a customer may not claim', () => {
    expect(createUploadUrlSchema.safeParse({ ...valid, kind: 'render_output' }).success).toBe(
      false
    )
    expect(createUploadUrlSchema.safeParse({ ...valid, kind: 'background' }).success).toBe(false)
    expect(createUploadUrlSchema.safeParse({ ...valid, kind: 'upload' }).success).toBe(true)
  })
})

describe('assetFilenameSchema', () => {
  it('keeps the leaf name of a directory drop', () => {
    expect(assetFilenameSchema.parse('footage/b-roll/clip.mp4')).toBe('clip.mp4')
    expect(assetFilenameSchema.parse('folder\\clip.mp4')).toBe('clip.mp4')
  })

  it('refuses a blank name', () => {
    expect(assetFilenameSchema.safeParse('   ').success).toBe(false)
  })

  it('refuses a name longer than the column', () => {
    expect(assetFilenameSchema.safeParse('a'.repeat(256)).success).toBe(false)
  })
})

describe('normalizeAssetFilters', () => {
  /* The sentinel must never reach a where clause — the single reason the
   * normalizer exists. */
  it('strips the all-sentinel and a blank search', () => {
    expect(normalizeAssetFilters(ASSET_FILTER_DEFAULTS)).toEqual({})
  })

  it('turns a tab into the set of kinds it covers', () => {
    expect(normalizeAssetFilters({ ...ASSET_FILTER_DEFAULTS, tab: 'audio' })).toEqual({
      kinds: ['audio_music', 'audio_tts', 'sfx'],
    })
  })

  it('passes a real search and a real status through', () => {
    expect(
      normalizeAssetFilters({ search: '  gerald ', tab: 'uploads', status: 'ready' })
    ).toEqual({ search: 'gerald', kinds: ['upload', 'image'], status: 'ready' })
  })

  it('drops a status that is not in the union', () => {
    expect(
      normalizeAssetFilters({ ...ASSET_FILTER_DEFAULTS, status: 'nonsense' })
    ).toEqual({})
  })

  /* The All tab must stay a NO-OP filter rather than a list of today's kinds,
   * or render outputs vanish from it the day Phase 04 starts writing them. */
  it('leaves the All tab unfiltered', () => {
    const all = ASSET_TABS.find((tab) => tab.key === 'all')
    expect(all?.kinds).toBeNull()
    expect(normalizeAssetFilters({ ...ASSET_FILTER_DEFAULTS, tab: 'all' })).toEqual({})
  })

  it('has a default for every filter key, and the status default is the sentinel', () => {
    expect(ASSET_FILTER_DEFAULTS.status).toBe(ASSET_FILTER_ALL)
    expect(ASSET_FILTER_DEFAULTS.tab).toBe('all')
  })
})
