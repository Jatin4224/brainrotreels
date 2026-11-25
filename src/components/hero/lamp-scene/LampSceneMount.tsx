/**
 * SOURCE OF TRUTH KEYWORDS: LampSceneMount, LampPoster, NO_LAYOUT_SHIFT,
 *   THREE_IS_NEVER_IN_THE_BUNDLE
 *
 * WHAT:  How the lamp scene gets onto the page: a client-only dynamic import
 *        with a still screenshot of the scene standing in until it arrives.
 *
 * WHY:   NO_LAYOUT_SHIFT. The scene is the right half of the hero and it
 *        cannot render on the server — it is a canvas, a RAF loop and a
 *        `window` measurement. Something has to hold its exact shape from the
 *        first paint, and a poster of the scene AT REST does it while also
 *        being the correct picture: a visitor on a slow connection sees the
 *        lamp, the phone and the hand, just not moving yet.
 *
 *        It is an <img> with explicit dimensions and `priority` off: this is
 *        below the headline in reading order and must not compete with the
 *        LCP text beside it.
 * WHERE: Imported by the hero in src/app/(marketing)/page.tsx, which is a
 *        server component — which is the whole reason this wrapper exists
 *        rather than a `dynamic()` call in the page.
 */

"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import * as React from "react";

import { cn } from "@/lib/utils";

import { SCENE_H, SCENE_W } from "./lib/geometry";

/** The scene at rest, so the hero's right column is never empty or jumpy. */
function LampPoster({ className }: { className?: string | undefined }) {
  /* The SAME box the live scene occupies — same cap, same centring, same
     aspect ratio — so the swap from poster to scene moves nothing. */
  return (
    <div
      className={cn("mx-auto w-full max-w-[560px] overflow-hidden", className)}
      style={{ aspectRatio: `${SCENE_W} / ${SCENE_H}`, borderRadius: 30 }}
    >
      <Image
        src="/hero/lamp-poster.webp"
        alt=""
        aria-hidden="true"
        width={SCENE_W}
        height={SCENE_H}
        className="h-full w-full"
      />
    </div>
  );
}

const LampScene = dynamic(() => import("./LampScene"), {
  ssr: false,
  loading: () => <LampPoster />,
});

export function LampSceneMount({ className }: { className?: string | undefined }) {
  return <LampScene className={className} />;
}
