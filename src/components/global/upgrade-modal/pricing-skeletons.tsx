/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PricingCardSkeleton, ComparisonTableSkeleton,
 *   PricingSkeletonBar, UpgradeContent, RIGHT_FADE_MASK
 *
 * WHAT:  Static placeholders that mirror the pricing card and the comparison
 *        table while the live prices are in flight.
 * WHY:   The plan CATALOGUE is local (registry + PLANS) but the AMOUNTS come
 *        from the billing provider, so the grid has a real loading window on
 *        every open. These placeholders reproduce the finished layout's vertical
 *        rhythm exactly, so the cards don't jump when the prices land.
 *        Built from the shared <Skeleton /> primitive rather than local bars, so
 *        the placeholder colour and pulse match every other loading state in the
 *        app instead of introducing a second loading language on the one screen
 *        a user reaches when something already went wrong.
 * WHERE: <UpgradeContent /> renders these inside <PricingGridFrame /> until
 *        billing.getAvailablePlans resolves.
 */

import type { CSSProperties } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export function PricingCardSkeleton() {
  return (
    <div className="flex h-full flex-col p-6 sm:p-7">
      {/* Plan name → description → badge row */}
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-2 h-3 w-40" />
      <Skeleton className="mt-2 h-4 w-16 rounded-full" />

      {/* Price block */}
      <div className="mt-6 mb-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
      </div>

      <Skeleton className="mb-6 h-9 w-full rounded-full" />

      {/* Feature checklist — irregular widths so it reads as text, not bars. */}
      <div className="flex-1 space-y-3">
        <Skeleton className="h-3 w-44" />
        {SKELETON_LINE_WIDTHS.map((width) => (
          <div key={width} className="flex items-center gap-2.5">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const SKELETON_LINE_WIDTHS = [75, 60, 80, 50, 70] as const;

/* Row counts per placeholder category — uneven on purpose, so the loading state
 * looks like a grouped table rather than a uniform block. */
const SKELETON_CATEGORIES = [4, 3, 2] as const;
const SKELETON_COLUMNS = [1, 2, 3, 4] as const;

export function ComparisonTableSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div className="w-full" style={style}>
      <Skeleton className="mx-auto mb-10 h-7 w-56" />

      <div className="space-y-10">
        {SKELETON_CATEGORIES.map((rows, categoryIndex) => (
          <div key={categoryIndex}>
            {/* Category header — label plus one column head per plan. */}
            <div className="flex items-end gap-6 pb-2">
              <Skeleton className="h-4 w-28 shrink-0" />
              <div className="flex flex-1 gap-6">
                {SKELETON_COLUMNS.map((column) => (
                  <div
                    key={column}
                    className="flex flex-1 flex-col items-center gap-1"
                  >
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-0.5 w-full" />
                  </div>
                ))}
              </div>
            </div>

            {Array.from({ length: rows }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="flex items-center gap-6 border-b border-border/30 py-3.5"
              >
                <Skeleton
                  className="h-3 shrink-0"
                  style={{ width: `${100 + rowIndex * 20}px` }}
                />
                <div className="flex flex-1 gap-6">
                  {SKELETON_COLUMNS.map((column) => (
                    <div key={column} className="flex flex-1 justify-center">
                      <Skeleton className="h-3 w-10" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
