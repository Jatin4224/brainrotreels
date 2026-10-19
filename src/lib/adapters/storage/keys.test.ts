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
 * SOURCE OF TRUTH KEYWORDS: storage keys tests, KEY_TRAVERSAL_GUARD,
 *   STORAGE_KEY_CONVENTION, isOwnedByOrganization, TENANCY_KEY_CHECK
 *
 * WHAT:  Tests for the storage key convention and its traversal guard.
 * WHY:   Keys encode tenancy. A key that escapes its `orgs/{id}/` prefix is a
 *        cross-tenant read or overwrite that no database constraint would
 *        catch, so the guard gets hostile inputs rather than happy paths.
 *        The exact prefixes are asserted literally because later phases, the
 *        R2 lifecycle rule on `tmp/`, and the CDN rule on `library/` all
 *        depend on these strings — changing one silently orphans stored
 *        objects, and a test that only checked "contains the id" would not
 *        notice.
 * WHERE: Run by `npm test`. Guards src/lib/adapters/storage/keys.ts.
 */

import { describe, expect, it } from 'vitest'

import {
  assertKeySegment,
  isLibraryKey,
  isOwnedByOrganization,
  libraryKey,
  projectKey,
  renderKey,
  tmpKey,
  uploadKey,
} from './keys'

const ORG = 'org_abc123'
const PROJECT = 'prj_xyz789'

describe('key shapes', () => {
  it('builds a library key', () => {
    expect(libraryKey('backgrounds', 'loop_01', 'vertical_1080.mp4')).toBe(
      'library/backgrounds/loop_01/vertical_1080.mp4',
    )
    expect(libraryKey('avatars', 'ava', 'neutral.png')).toBe('library/avatars/ava/neutral.png')
  })

  it('builds an upload key under the workspace prefix', () => {
    expect(uploadKey(ORG, 'ast_1', 'original.mp4')).toBe(
      `orgs/${ORG}/uploads/ast_1/original.mp4`,
    )
  })

  it('builds project keys per kind', () => {
    expect(projectKey(ORG, PROJECT, 'audio', 'line_1.mp3')).toBe(
      `orgs/${ORG}/projects/${PROJECT}/audio/line_1.mp3`,
    )
    expect(projectKey(ORG, PROJECT, 'footage', 'clip.mp4')).toBe(
      `orgs/${ORG}/projects/${PROJECT}/footage/clip.mp4`,
    )
  })

  /* A render's outputs share a prefix so one delete removes the whole set. */
  it('groups render outputs under one render id', () => {
    expect(renderKey(ORG, PROJECT, 'rnd_9', 'out.mp4')).toBe(
      `orgs/${ORG}/projects/${PROJECT}/renders/rnd_9/out.mp4`,
    )
    expect(renderKey(ORG, PROJECT, 'rnd_9', 'poster.jpg')).toBe(
      `orgs/${ORG}/projects/${PROJECT}/renders/rnd_9/poster.jpg`,
    )
  })

  /* The lifecycle rule deletes this prefix after 24h — the literal matters. */
  it('builds tmp keys under the expiring prefix', () => {
    expect(tmpKey('job_1', 'probe.json')).toBe('tmp/job_1/probe.json')
  })

  it('never produces a leading slash or a double slash', () => {
    const keys = [
      libraryKey('music', 'calm.mp3'),
      uploadKey(ORG, 'a', 'b.mp4'),
      projectKey(ORG, PROJECT, 'audio', 'x.mp3'),
      renderKey(ORG, PROJECT, 'r', 'out.mp4'),
      tmpKey('j', 'f'),
    ]
    for (const key of keys) {
      expect(key.startsWith('/'), key).toBe(false)
      expect(key.includes('//'), key).toBe(false)
    }
  })
})

describe('KEY_TRAVERSAL_GUARD', () => {
  it.each([
    ['..', 'parent traversal'],
    ['.', 'current directory'],
    ['.hidden', 'leading dot'],
    ['a/b', 'forward slash'],
    ['a\\b', 'backslash'],
    ['', 'empty'],
  ])('rejects %s (%s)', (value) => {
    expect(() => assertKeySegment(value, 'test')).toThrow()
  })

  it('rejects control characters', () => {
    expect(() => assertKeySegment('a\u0000b', 'test')).toThrow(/control character/)
    expect(() => assertKeySegment('a\nb', 'test')).toThrow(/control character/)
  })

  it('accepts ordinary ids and filenames', () => {
    expect(assertKeySegment('org_abc123', 'test')).toBe('org_abc123')
    expect(assertKeySegment('vertical_1080.mp4', 'test')).toBe('vertical_1080.mp4')
    expect(assertKeySegment('my video (final).mp4', 'test')).toBe('my video (final).mp4')
  })

  /* The attack this exists for: escaping into another workspace's prefix. */
  it('blocks an id that would escape the workspace prefix', () => {
    expect(() => uploadKey('../other-org', 'a', 'b.mp4')).toThrow()
    expect(() => uploadKey(ORG, '../../etc', 'b.mp4')).toThrow()
    expect(() => projectKey(ORG, `../${'other'}`, 'audio', 'x.mp3')).toThrow()
    expect(() => renderKey(ORG, PROJECT, 'r', '../../../escape.mp4')).toThrow()
  })
})

describe('TENANCY_KEY_CHECK', () => {
  it('recognises a workspace it owns', () => {
    expect(isOwnedByOrganization(uploadKey(ORG, 'a', 'b.mp4'), ORG)).toBe(true)
    expect(isOwnedByOrganization(projectKey(ORG, PROJECT, 'audio', 'x.mp3'), ORG)).toBe(true)
  })

  it('rejects another workspace', () => {
    expect(isOwnedByOrganization(uploadKey(ORG, 'a', 'b.mp4'), 'org_other')).toBe(false)
  })

  /* A prefix check must not be fooled by an id that merely starts the same. */
  it('is not fooled by a shared id prefix', () => {
    expect(isOwnedByOrganization('orgs/org_abc1234/uploads/a/b.mp4', 'org_abc123')).toBe(false)
  })

  it('treats library keys as unowned but public', () => {
    const key = libraryKey('backgrounds', 'loop.mp4')
    expect(isOwnedByOrganization(key, ORG)).toBe(false)
    expect(isLibraryKey(key)).toBe(true)
    expect(isLibraryKey(uploadKey(ORG, 'a', 'b.mp4'))).toBe(false)
  })
})
