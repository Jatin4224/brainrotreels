/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ComposerSettingPill, DROPDOWN_PILL,
 * SETTINGS_ARE_PILLS, DropdownMenu
 *
 * WHAT: One of the small "Length · Up to 3 min ⌄" controls under the
 * composer's field — a label, the current value, and a menu of the
 * others.
 *
 * WHY: SETTINGS_ARE_PILLS. The design puts these INSIDE the composer card,
 * on the same row as the actions, because they modify the field above
 * rather than standing on their own. A <Select> with a visible label
 * above it — which is what the rest of the app uses for a choice —
 * would be three lines tall each and would turn one field into a form.
 *
 * It reads as one control, so it IS one button: the label and the
 * value are both inside it, and the accessible name carries both
 * ("Length, currently Up to 3 min") rather than leaving a screen
 * reader with a bare "Up to 3 min" and no idea what it sets.
 *
 * Built on the app's existing DropdownMenu rather than a new popover,
 * so keyboard handling, focus return and outside-click dismissal come
 * from the primitive the rest of the dashboard already uses.
 *
 * WHERE: The composer card in ./composer-screen.tsx.
 */

import { CheckIcon, ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ComposerSettingOption {
  value: string;
  label: string;
}

export interface ComposerSettingPillProps {
  /** What the pill sets, e.g. "Length". Shown muted, before the value. */
  label: string;
  /** The current value's label. */
  value: string;
  options: readonly ComposerSettingOption[];
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}

export function ComposerSettingPill({
  label,
  value,
  options,
  selected,
  onSelect,
  disabled = false,
}: ComposerSettingPillProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={`${label}, currently ${value}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong px-3 text-sm outline-none transition-colors hover:border-foreground/25 focus-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          />
        }
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{value}</span>
        <ChevronDownIcon
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-44">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onSelect(option.value)}
            className="justify-between"
          >
            {option.label}
            {/* The tick, not a highlighted row: the menu already highlights
                what the pointer is over, and two kinds of emphasis in one
                list is how "selected" stops being readable. */}
            <CheckIcon
              className={cn(
                "size-4",
                option.value === selected ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
