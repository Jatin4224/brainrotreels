/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectPreview, RemotionPlayer, PROXY_FOR_SCRUBBING,
 *   SAME_COMPONENT_AS_THE_RENDER, PLAYER_NEEDS_A_NUMERIC_SIZE,
 *   PREVIEW_EMPTY_STATES
 *
 * WHAT:  The player: fetches the resolved document and its signed proxy URLs,
 *        then mounts the SAME composition the renderer uses.
 * WHY:   SAME_COMPONENT_AS_THE_RENDER. `<Player>` is handed `TimelineRenderer`
 *        — the identical component `remotion render` and Phase 04's Lambda
 *        render use — so the preview is not an approximation of the output,
 *        it IS the output at a different resolution. That is the property
 *        architecture.md names as the reason preview and output match, and the
 *        only thing that differs between them is which variant each asset
 *        resolves to (PROXY_FOR_SCRUBBING: `proxy_480` here, `vertical_1080`
 *        there).
 *
 *        PLAYER_NEEDS_A_NUMERIC_SIZE: `compositionWidth`/`compositionHeight`
 *        are the DOCUMENT's canvas, and the on-screen size is handled by
 *        `style` — the Player scales the canvas into whatever box it is given.
 *        Passing the on-screen pixels as the composition size instead would
 *        render the document at 400×711, which silently changes every
 *        normalized box's pixel result and makes the preview disagree with the
 *        render.
 *
 *        PREVIEW_EMPTY_STATES: a project with no timeline, and a timeline that
 *        cannot be migrated, are DIFFERENT states and say different things. A
 *        draft project simply has not been generated yet (Phase 09 fills it);
 *        a document that fails to migrate is a broken record the customer
 *        cannot fix and support needs to hear about. Collapsing both into "no
 *        preview" is how the second one goes unreported.
 * WHERE: Mounted by the preview page's server component.
 */

import * as React from 'react'
import { Player } from '@remotion/player'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganizationId } from '@/hooks/use-active-organization'
import { TimelineRenderer } from '@/remotion/timeline-renderer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function ProjectPreview({ projectId }: { projectId: string }) {
  const organizationId = useActiveOrganizationId()
  const enabled = organizationId !== undefined

  const query = trpc.projects.preview.useQuery(
    { organizationId: organizationId ?? '', id: projectId },
    { enabled, retry: false },
  )

  if (!enabled || (query.isPending && query.data === undefined)) {
    return <Skeleton className="mx-auto aspect-[9/16] w-full max-w-sm rounded-xl" />
  }

  if (query.error !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This project could not be opened</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    )
  }

  const data = query.data
  if (data === undefined) return null

  /* PREVIEW_EMPTY_STATES — the two cases are deliberately not merged. */
  if (data.doc === null) {
    const broken = data.timelineErrors.length > 0
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {broken ? (
            <>
              <p className="font-medium text-foreground">This timeline could not be read</p>
              <p className="mt-1">
                It was written in a format this version cannot open. Nothing has been lost —
                please contact support with the project name.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">Nothing to preview yet</p>
              <p className="mt-1">This project has no timeline. Generate one to see it here.</p>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  const { doc, assets, composition } = data
  if (composition === null) return null

  return (
    <div className="flex flex-col items-center gap-3">
      <Player
        component={TimelineRenderer}
        /* The document's own canvas, never the on-screen size — see
         * PLAYER_NEEDS_A_NUMERIC_SIZE. */
        compositionWidth={composition.width}
        compositionHeight={composition.height}
        durationInFrames={composition.durationInFrames}
        fps={composition.fps}
        inputProps={{ doc, assets }}
        controls
        /* Loops because a short-form video is watched repeatedly while being
         * judged; the render does not loop, and nothing about this setting
         * reaches it. */
        loop
        acknowledgeRemotionLicense
        className="overflow-hidden rounded-xl border border-border bg-card"
        style={{ width: '100%', maxWidth: 360, aspectRatio: `${composition.width} / ${composition.height}` }}
      />

      <p className="text-xs text-muted-foreground">
        {composition.durationInSeconds.toFixed(1)}s · {composition.width}×{composition.height} ·
        {' '}
        {composition.fps}fps · preview quality
      </p>
    </div>
  )
}
