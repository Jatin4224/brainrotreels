/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: SettingsSection, SettingsSectionProps
 *
 * WHAT:  A settings section — SectionHeader, a separator, then a two-column
 *        grid: a left label/description column and a right content column
 *        (capped at max-w-md).
 * WHY:   This exact layout repeats for every settings section (subscription,
 *        payment methods, organization, …). Extracting it keeps each section a
 *        one-liner and the spacing/columns consistent.
 * WHERE: settings/billing, settings/organization, etc.
 */

import * as React from "react";

import { SectionHeader } from "@/components/global/section-header";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface SettingsSectionProps {
  title: string;
  description?: string;
  label: string;
  labelDescription?: string;
  /**
   * Width of the content column.
   *
   * `'default'` caps it at `max-w-md`, which keeps forms readable — a full-width
   * text input is unpleasant to scan and that is what most settings are.
   * `'full'` removes the cap for content that legitimately needs the page: a
   * horizontally scrolling plan row, a wide table. Opt-in so the default stays
   * the readable one.
   */
  contentWidth?: "default" | "full";
  children: React.ReactNode;
}

export function SettingsSection({
  title,
  description,
  label,
  labelDescription,
  contentWidth = "default",
  children,
}: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <SectionHeader title={title} {...(description ? { description } : {})} />
      <Separator />
      <div className="grid gap-8 md:grid-cols-[280px_1fr] lg:gap-12">
        <div className="space-y-1">
          <h4 className="text-sm font-medium">{label}</h4>
          {labelDescription ? (
            <p className="text-sm text-muted-foreground">{labelDescription}</p>
          ) : null}
        </div>
        {/* `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`,
            so it refuses to shrink below its content and an inner
            `overflow-x: auto` never gets to scroll — it just overflows and gets
            clipped by the page. */}
        <div
          className={cn("min-w-0", contentWidth === "default" && "max-w-md")}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
