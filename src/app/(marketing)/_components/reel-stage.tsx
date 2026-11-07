/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ReelStage, ReelStageProps, ReelPhone, ReelHand,
 *   SHOW_THE_GESTURE, STAGE_IS_FIXED_HEIGHT, HAND_IS_ILLUSTRATION,
 *   ReelShowcaseItem
 *
 * WHAT:  The hero's right-hand stage — one phone scrolling its own feed, an
 *        illustrated thumb swiping it, and two floating claim pills.
 *
 * WHY:   SHOW_THE_GESTURE. The fan of three phones it replaces said "here are
 *        three videos"; a phone being SWIPED says "here is a feed somebody
 *        cannot stop scrolling", which is the thing being sold. It also puts
 *        one caption in front of the visitor at a time instead of three
 *        competing for the same glance.
 *
 *        HAND_IS_ILLUSTRATION, and drawn rather than photographed for the same
 *        reason the avatars are: a stock photo of a hand belonging to nobody
 *        who uses this product is the oldest lie on a landing page. Its skin
 *        tones are tokens (see globals.css), so it is re-skinnable without
 *        touching this file, and it is `aria-hidden` — a picture of a gesture,
 *        not content.
 *
 *        STAGE_IS_FIXED_HEIGHT with everything absolutely positioned inside
 *        it, which is what makes the hero immune to layout shift: the stage
 *        reserves its space before a single frame loads. The stage then scales
 *        in measured steps to fit the column it lands in — the composition is
 *        a PICTURE, so shrinking it changes nothing about what the hero says,
 *        while letting it overflow would push a scrollbar onto every phone.
 * WHERE: The right column of the hero in src/app/(marketing)/page.tsx, fed by
 *        `LANDING_REELS` from ./landing-content.ts.
 */

import type { ReelShowcaseItem } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ReelPhone } from "./reel-phone";

export interface ReelStageProps {
  items: readonly ReelShowcaseItem[];
  /** The pale pill over the phone's top-left, e.g. "Ready to post in 41s". */
  badge: string;
  /** The yellow pill under the phone's bottom-right. */
  footnote: string;
  /** Passed through to the phone's feed header. */
  feedLabel?: string | undefined;
  className?: string | undefined;
}

export function ReelStage({
  items,
  badge,
  footnote,
  feedLabel,
  className,
}: ReelStageProps) {
  return (
    /* TWO BOXES, both load-bearing. The inner one is a FIXED 620×660 stage the
     * composition is positioned against in absolute pixels, and it is 700 wide
     * rather than 620 so the thumb's +70px swing at rest still lands INSIDE the
     * box — sized to the phone alone, the sleeve ran off the right of the
     * viewport at four of the seven widths tested. The phone, the
     * thumb and the pills hold their relationship at every screen width. The
     * outer one scales that stage and reserves the SCALED height — a transform
     * does not change layout size, so without the paired heights a shrunk
     * stage would leave dead space beneath it. The steps are measured against
     * the column the stage lands in; full size needs 1240px. */
    <div
      className={cn(
        "relative h-[356px] min-[900px]:h-[409px] min-[1024px]:h-[462px] min-[1240px]:h-[561px] min-[1440px]:h-[660px]",
        className,
      )}
    >
      <div className="absolute left-1/2 top-0 h-[660px] w-[700px] origin-top -translate-x-1/2 scale-[0.54] min-[900px]:scale-[0.62] min-[1024px]:scale-[0.7] min-[1240px]:scale-[0.85] min-[1440px]:scale-100">
        <span className="brutal-shadow absolute left-0 top-[120px] z-[4] inline-flex -rotate-[5deg] items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
          {badge}
        </span>

        <span className="brutal-shadow absolute left-[402px] top-[590px] z-[4] inline-block rotate-[4deg] rounded-full bg-brand-accent px-4 py-2 text-sm font-medium text-brand-accent-foreground">
          {footnote}
        </span>

        <ReelPhone
          items={items}
          feedLabel={feedLabel}
          className="absolute left-20 top-[10px] z-[2]"
        />

        <ReelHand />
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: ReelHand, HAND_IS_ILLUSTRATION, reel-hand
 *
 * WHAT:  The illustrated thumb that swipes the phone, with the pale tap halo
 *        that pulses under its tip.
 * WHY:   Its own component purely so the path data does not bury the stage's
 *        layout. Pure markup — the motion is `reel-hand` and `reel-touch` in
 *        globals.css, which stop under `prefers-reduced-motion` and leave the
 *        hand resting on the screen.
 * WHERE: The stage above.
 */
function ReelHand() {
  return (
    <div
      aria-hidden="true"
      className="reel-hand absolute left-[222px] top-[318px] z-[3] w-[400px]"
    >
      <span className="reel-touch absolute left-3 top-[107px] size-9 rounded-full bg-foreground/55" />
      <svg viewBox="0 0 300 200" className="block h-auto w-full">
        <path
          d="M226 54 L322 44 L322 172 L230 164 Z"
          fill="var(--brand-accent)"
        />
        <path
          d="M226 54 L246 52 L250 166 L230 164 Z"
          fill="var(--brand-accent-foreground)"
          opacity=".12"
        />
        <path
          d="M130 72 C150 56 196 52 230 58 C236 90 236 130 232 160 C204 170 160 168 134 154 C118 142 116 92 130 72 Z"
          fill="var(--hand-skin)"
        />
        <path
          d="M136 150 C160 164 204 166 232 158 L232 162 C204 172 158 170 134 156 Z"
          fill="var(--hand-skin-shade)"
          opacity=".5"
        />
        <path
          d="M150 104 C126 100 106 106 106 118 C106 126 112 130 118 131 C108 134 106 144 116 148 C110 152 112 162 126 162 L176 160 L172 104 Z"
          fill="var(--hand-skin-mid)"
        />
        <path
          d="M118 131 C126 132 140 131 150 129 M116 148 C126 148 140 147 152 145"
          stroke="var(--hand-skin-shade)"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M30 79 C19 79 13 86 13 92 C13 99 19 105 30 105 L144 109 L146 73 Z"
          fill="var(--hand-skin)"
        />
        <path
          d="M30 100 C60 102 100 104 144 104 L144 109 L30 105 C24 105 18 103 16 99 Z"
          fill="var(--hand-skin-shade)"
          opacity=".6"
        />
        <path
          d="M17 86 C17 82 21 81 25 81 L33 81 C36 81 37 84 37 87 L37 95 C37 98 35 100 32 100 L23 100 C19 100 17 97 17 94 Z"
          fill="var(--hand-skin-light)"
        />
        <path
          d="M64 81 Q67 91 64 101 M102 79 Q105 90 102 102"
          stroke="var(--hand-skin-shade)"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          opacity=".8"
        />
        <path
          d="M204 60 C176 58 140 60 116 66 C102 70 102 82 114 83 C140 85 170 82 200 82 Z"
          fill="var(--hand-skin)"
        />
        <path
          d="M114 83 C140 85 170 82 200 82 L200 85 C170 86 140 88 113 86 Z"
          fill="var(--hand-skin-shade)"
          opacity=".45"
        />
        <path
          d="M106 70 C108 67 114 66 118 67 L122 68 C124 72 124 78 121 81 L114 81 C108 80 105 76 106 70 Z"
          fill="var(--hand-skin-light)"
        />
      </svg>
    </div>
  );
}
