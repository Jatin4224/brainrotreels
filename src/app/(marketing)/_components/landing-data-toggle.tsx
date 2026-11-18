/**
 * SOURCE OF TRUTH KEYWORDS: LandingDataToggle, LANDING_DATA_VARIANTS,
 *   DEV_ONLY_FIXTURE, THE_TOGGLE_IS_NOT_THE_DESIGN
 *
 * WHAT:  The segmented control at the bottom of /dev/landing that swaps the
 *        page between the real content and the worst-case, empty and
 *        single-item fixtures.
 *
 * WHY:   THE_TOGGLE_IS_NOT_THE_DESIGN. It sits over the page under test, so
 *        it deliberately wears none of the page's language — no brand
 *        colour, no display face, no brutal border. A grey track and a white
 *        pill in the system font, so nobody reviewing a screenshot mistakes
 *        it for part of the product.
 *
 *        Plain links, not state: the variant lives in the URL, so a reload
 *        keeps it and a screenshot can be taken of a specific state by
 *        address. No "use client" either — there is no hook here, so it
 *        renders on the server with the page it is testing.
 * WHERE: Rendered only by src/app/(marketing)/dev/landing/page.tsx, which
 *        404s in production.
 */

/* A plain <a>, not next/link: typedRoutes rejects a href carrying a query
   string it has not generated a type for, and a full reload is the right
   behaviour here anyway — it re-renders the server component against the
   new fixture with no stale client state to reason about. */

import {
  LANDING_DATA_VARIANTS,
  type LandingDataVariant,
} from "./landing-fixtures";

const LABELS: Record<LandingDataVariant, string> = {
  demo: "Demo data",
  worst: "Worst case",
  empty: "Empty",
  one: "One",
};

export function LandingDataToggle({ active }: { active: LandingDataVariant }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        gap: 2,
        padding: 3,
        borderRadius: 9999,
        background: "#1f1f22",
        border: "1px solid #3a3a3e",
        boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
      }}
    >
      {LANDING_DATA_VARIANTS.map((variant) => {
        const isActive = variant === active;
        return (
          <a
            key={variant}
            href={`/dev/landing?data=${variant}`}
            style={{
              padding: "5px 12px",
              borderRadius: 9999,
              textDecoration: "none",
              whiteSpace: "nowrap",
              background: isActive ? "#ffffff" : "transparent",
              color: isActive ? "#111113" : "#a1a1a6",
              fontWeight: isActive ? 600 : 500,
            }}
          >
            {LABELS[variant]}
          </a>
        );
      })}
    </div>
  );
}
