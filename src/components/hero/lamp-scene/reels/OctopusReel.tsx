/**
 * SOURCE OF TRUTH KEYWORDS: OctopusReel, REELS_ARE_DRAWN_NOT_FILMED
 *
 * WHAT:  The first reel's "video": a pink octopus bobbing underwater under a
 *        captioned hook.
 * WHY:   REELS_ARE_DRAWN_NOT_FILMED. The phone has to be playing SOMETHING,
 *        and an inline SVG costs a few hundred bytes where a real clip costs a
 *        download, a decoder and a frame of black before it starts. It also
 *        never gets out of sync with the scroll timeline, because there is no
 *        second clock. The `bob` class is the only motion in it, and it is
 *        video content, so it loops — see lamp-scene.module.css, where
 *        reduced motion turns it off.
 * WHERE: Rendered by ReelsFeed, twice: as reel A and as the A-copy that makes
 *        the loop seamless.
 */

export function OctopusReel({ gradientId }: { gradientId: string }) {
  return (
    <svg
      viewBox="0 0 252 522"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fd3e6" />
          <stop offset="1" stopColor="#1f6f9a" />
        </linearGradient>
      </defs>
      <rect width="252" height="522" fill={`url(#${gradientId})`} />
      <path
        d="M0 430 C60 400 120 450 180 420 S252 410 252 410 V522 H0Z"
        fill="#f2d39a"
      />
      <circle cx="40" cy="120" r="5" fill="#fff" opacity=".5" />
      <circle cx="58" cy="90" r="3" fill="#fff" opacity=".5" />
      <circle cx="210" cy="150" r="4" fill="#fff" opacity=".5" />
      <g transform="translate(126 270)">
        <g className="reelBob">
          <path
            d="M-50 40 C-70 90 -90 100 -100 130 M-25 50 C-35 100 -40 120 -55 150 M0 55 C0 110 5 130 -5 160 M25 50 C35 100 40 120 55 150 M50 40 C70 90 90 100 100 130"
            stroke="#ef7fa7"
            strokeWidth="18"
            strokeLinecap="round"
            fill="none"
          />
          <ellipse cx="0" cy="0" rx="66" ry="70" fill="#f48fb5" />
          <ellipse cx="-20" cy="-30" rx="16" ry="10" fill="#fff" opacity=".35" />
          <circle cx="-22" cy="10" r="13" fill="#fff" />
          <circle cx="22" cy="10" r="13" fill="#fff" />
          <circle cx="-19" cy="13" r="7" fill="#1d1d2b" />
          <circle cx="25" cy="13" r="7" fill="#1d1d2b" />
          <path
            d="M-12 38 Q0 48 12 38"
            stroke="#7a2846"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M-60 -64 l8 10 M-48 -76 l4 12"
            stroke="#ff4f6d"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>
      </g>
      <text
        x="126"
        y="122"
        textAnchor="middle"
        fontFamily="var(--font-bricolage), sans-serif"
        fontWeight="800"
        fontSize="40"
        fill="#fff"
        stroke="#1a1410"
        strokeWidth="7"
        paintOrder="stroke"
      >
        3 hearts?!
      </text>
    </svg>
  );
}
