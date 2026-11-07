/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ReelStage, ReelStageProps, ReelPhone,
 *   PHONE_SLOTS, FANNED_STACK, STAGE_IS_FIXED_HEIGHT, HOVER_IS_POLISH,
 *   ReelShowcaseItem
 *
 * WHAT:  The hero's right-hand stage — three phone mockups fanned around a
 *        larger upright centre, with a floating claim pill over the
 *        bottom-right corner.
 *
 * WHY:   FANNED_STACK. One phone says "here is a video"; three overlapping say
 *        "here is a feed", which is the thing being sold. The centre phone is
 *        upright, taller and on top so the eye lands on one caption instead of
 *        scanning three.
 *
 *        STAGE_IS_FIXED_HEIGHT, and the phones are absolutely positioned
 *        inside it at fixed pixel sizes. That is what makes the hero immune to
 *        layout shift as posters and videos load: the stage reserves its space
 *        before a single byte of media arrives. It is also why the fan cannot
 *        be driven by an arbitrary-length array — a fan has a middle — so the
 *        component takes the items and renders as many SLOTS as it has.
 *
 *        HOVER_IS_POLISH: the side phones splay further out and lift on
 *        hover, driven by `group-hover` so one state drives all three and
 *        nothing needs JavaScript. It is decoration, so it is the first thing
 *        dropped under `prefers-reduced-motion`.
 *
 *        `overflow-visible` with negative offsets is deliberate: the side
 *        phones are MEANT to break the column edge, which is what stops the
 *        group reading as three cards in a row. The hero section clips the
 *        page, so nothing escapes horizontally — see the `overflow-hidden` on
 *        the hero in page.tsx, which is what keeps mobile free of a scrollbar.
 * WHERE: The right column of the hero in src/app/(marketing)/page.tsx, fed by
 *        `LANDING_REELS` from ./landing-content.ts.
 */

import type { ReelShowcaseItem } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ReelPhone } from "./reel-phone";

export interface ReelStageProps {
  /** Up to three; the second is the featured centre. */
  items: readonly ReelShowcaseItem[];
  /** The floating claim, e.g. "Ready to post in under a minute". */
  badge: string;
  /** Passed through to every phone's feed header. */
  feedLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: PHONE_SLOTS, HOVER_IS_POLISH
 *
 * WHAT:  Where each phone sits, how far it tilts, and how it moves on hover.
 * WHY:   A positional list rather than props per phone, so the arrangement is
 *        readable as a shape in one place. Index 1 is the centre and carries
 *        no rotation — the upright phone is the anchor the other two lean away
 *        from, and tilting it would make the whole group look dropped.
 * WHERE: The map below.
 */
const PHONE_SLOTS = [
  "left-[-30px] top-[70px] z-[1] -rotate-[7deg] group-hover:-translate-y-1.5 group-hover:-rotate-[9deg]",
  "left-1/2 top-[10px] z-[2] -translate-x-1/2",
  "right-[-30px] top-[80px] z-[1] rotate-[7deg] group-hover:-translate-y-1.5 group-hover:rotate-[9deg]",
] as const;

export function ReelStage({
  items,
  badge,
  feedLabel,
  className,
}: ReelStageProps) {
  const phones = items.slice(0, PHONE_SLOTS.length);

  return (
    /* TWO BOXES, and both are load-bearing.
     *
     * The INNER one is a FIXED 560×600 stage: the fan's geometry is written in
     * absolute pixels against it, so the composition is identical at every
     * screen width instead of the phones sliding over each other as a fluid
     * column narrows. The OUTER one scales that stage to fit and reserves the
     * scaled height — `transform` does not change layout size, so without the
     * matching heights a shrunk stage would leave a column of dead space under
     * it at every width below the largest.
     *
     * The four steps are measured, not guessed: the fan is 674px wide once
     * the tilted side phones' corners are counted, and each step is the
     * largest scale at which that still clears the viewport edge at the
     * breakpoint below it. Full size needs 1440px.
     *
     * Scaling rather than re-laying-out is the right trade here because the
     * stage is a PICTURE: at 1024px the three phones genuinely do not fit
     * beside the text at full size, and the alternatives are to drop a phone
     * or to let the right one run off the screen. Both of those change what
     * the hero says; a smaller fan does not. */
    <div
      className={cn(
        "relative h-[330px] min-[900px]:h-[384px] min-[1024px]:h-[432px] min-[1240px]:h-[510px] min-[1440px]:h-[600px]",
        className,
      )}
    >
      {/* ABSOLUTELY centred, not `mx-auto`: auto margins collapse to zero on a
          box WIDER than its container, so on a phone the 560px stage pinned
          itself to the left edge of the column and the fan sat off-centre.
          left-1/2 + -translate-x-1/2 centres it at any container width. */}
      <div className="group absolute left-1/2 top-0 h-[600px] w-[560px] origin-top -translate-x-1/2 scale-[0.55] min-[900px]:scale-[0.64] min-[1024px]:scale-[0.72] min-[1240px]:scale-[0.85] min-[1440px]:scale-100">
        {phones.map((item, index) => (
          <ReelPhone
            key={item.id}
            item={item}
            featured={index === 1}
            feedLabel={feedLabel}
            className={cn(
              "absolute transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:rotate-0",
              PHONE_SLOTS[index],
            )}
          />
        ))}

        <span className="brutal-border brutal-shadow absolute bottom-[26px] right-0 z-[3] inline-flex -rotate-[4deg] items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
          {badge}
        </span>
      </div>
    </div>
  );
}
