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
 * SOURCE OF TRUTH KEYWORDS: ffmpegBinary, ffprobeBinary, isFfmpegConfigured,
 *   runTool, MEDIA_TOOL_TIMEOUT_MS, ARGV_NEVER_A_SHELL, LAZY_BINARY
 *
 * WHAT:  Where the two binaries live, and the one function that runs either of
 *        them.
 * WHY:   ARGV_NEVER_A_SHELL is the security property of this file. Every
 *        argument — file paths, filter strings, the customer's own numbers —
 *        goes through `execFile` as an ARRAY with no shell, so there is nothing
 *        to quote and nothing to escape. The obvious alternative, building a
 *        command string and calling `exec`, turns any filename into shell
 *        input; the staged paths here are generated, but the rule has to hold
 *        unconditionally because the day someone passes a customer string is
 *        the day it matters.
 *
 *        LAZY_BINARY, matching config/stripe.ts and storage/r2/client.ts: the
 *        paths are read at import but nothing is executed or verified there, so
 *        a repo with no ffmpeg installed still boots, still builds, and still
 *        renders the setup checklist. Only an actual ingest fails, with a
 *        message naming the variable to set.
 *
 *        MEDIA_TOOL_TIMEOUT_MS exists because ffmpeg can hang indefinitely on a
 *        malformed file rather than exiting — a truncated MP4 whose index
 *        promises frames that are not there. Without a timeout that becomes a
 *        workflow step that never returns and a worker that never frees.
 * WHERE: Used only by ./index.ts, the ffmpeg MediaAdapter implementation.
 */

import 'server-only'

import { execFile } from 'node:child_process'

import { MediaProcessingError } from '../types'

/** Overridable because a container image, a Mac with Homebrew and a CI runner
 *  all put these somewhere different. Bare names resolve on PATH. */
const FFMPEG_PATH = process.env['FFMPEG_PATH']?.trim() || 'ffmpeg'
const FFPROBE_PATH = process.env['FFPROBE_PATH']?.trim() || 'ffprobe'

/** Generous: a long 4K source legitimately takes minutes to transcode. Still
 *  finite, so a hung process cannot hold a worker forever. */
export const MEDIA_TOOL_TIMEOUT_MS = 15 * 60 * 1000

/** ffmpeg writes progress to stderr, so a chatty success can be megabytes.
 *  Capped, and only the tail is ever kept for diagnostics. */
const MAX_TOOL_OUTPUT_BYTES = 8 * 1024 * 1024

const STDERR_TAIL_CHARS = 2000

export function ffmpegBinary(): string {
  return FFMPEG_PATH
}

export function ffprobeBinary(): string {
  return FFPROBE_PATH
}

/**
 * SOURCE OF TRUTH KEYWORDS: isFfmpegConfigured
 *
 * WHAT:  Whether the operator has pointed this deployment at ffmpeg explicitly.
 * WHY:   Mirrors isR2Configured so a future setup-checklist row can report media
 *        readiness the same way it reports storage. It answers "was this
 *        configured", not "does the binary work" — proving the latter means
 *        running it, which is not something a health check should do on every
 *        page load.
 * WHERE: Available to the setup checklist; not required by the ingest path.
 */
export function isFfmpegConfigured(): boolean {
  return Boolean(process.env['FFMPEG_PATH']?.trim() && process.env['FFPROBE_PATH']?.trim())
}

/**
 * SOURCE OF TRUTH KEYWORDS: runTool, ARGV_NEVER_A_SHELL, READABLE_INGEST_FAILURE
 *
 * WHAT:  Runs ffmpeg or ffprobe with an argument array and returns its stdout.
 * WHY:   One place that spawns a process, so the timeout, the output cap, the
 *        no-shell rule and the error translation are written once. A missing
 *        binary (ENOENT) is reported as a CONFIGURATION problem naming the env
 *        var, because "spawn ffmpeg ENOENT" in a workflow log has sent more
 *        than one developer looking for a bug in their video file.
 * WHERE: Both methods of the ffmpeg adapter.
 */
export async function runTool(
  binary: string,
  args: readonly string[],
  failureMessage: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [...args],
      {
        timeout: MEDIA_TOOL_TIMEOUT_MS,
        maxBuffer: MAX_TOOL_OUTPUT_BYTES,
        /* No `shell` option — see ARGV_NEVER_A_SHELL. execFile's default is
         * already shell-free; it is named here so a future edit that adds
         * `shell: true` for convenience has to delete this comment first. */
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout)
          return
        }

        const detail = String(stderr).slice(-STDERR_TAIL_CHARS)

        if ('code' in error && error.code === 'ENOENT') {
          reject(
            new MediaProcessingError(
              `Media processing is not available on this server: "${binary}" was not found. ` +
                'Install ffmpeg in the worker image, or set FFMPEG_PATH and FFPROBE_PATH.',
              detail
            )
          )
          return
        }

        if ('killed' in error && error.killed === true) {
          reject(
            new MediaProcessingError(
              'This file took too long to process and was stopped. It may be corrupt or much larger than expected.',
              detail
            )
          )
          return
        }

        reject(new MediaProcessingError(failureMessage, detail))
      }
    )
  })
}
