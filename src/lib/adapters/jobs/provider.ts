/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: JOBS_PROVIDER, jobsSelector, assertJobsProviderActive,
 *   JOBS_PROVIDER env, DEFAULT_JOBS_PROVIDER
 *
 * WHAT:  Resolves which jobs engine is selected, once.
 * WHY:   `JOBS_PROVIDER` is server-only — NOT `NEXT_PUBLIC_`. The auth seam's
 *        var is public because the client wrappers must agree with the server
 *        on a provider; no browser code ever enqueues a job, so publishing
 *        this one would leak an infrastructure detail into the bundle for no
 *        benefit. Read literally for the same reason as everything in
 *        config/env.public.ts.
 * WHERE: Used by ./index.ts and asserted at module scope by ./inngest.
 */

import { createProviderSelector } from "../select-provider";
import { JOBS_PROVIDER_IDS, type JobsProviderId } from "./types";

export const DEFAULT_JOBS_PROVIDER: JobsProviderId = "inngest";

export const jobsSelector = createProviderSelector<JobsProviderId>({
  label: "jobs",
  envVar: "JOBS_PROVIDER",
  rawValue: process.env["JOBS_PROVIDER"],
  ids: JOBS_PROVIDER_IDS,
  fallback: DEFAULT_JOBS_PROVIDER,
});

export const JOBS_PROVIDER: JobsProviderId = jobsSelector.provider;

export function assertJobsProviderActive(id: JobsProviderId): void {
  jobsSelector.assertActive(id);
}
