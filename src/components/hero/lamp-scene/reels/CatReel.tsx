/**
 * SOURCE OF TRUTH KEYWORDS: CatReel, REELS_ARE_DRAWN_NOT_FILMED
 *
 * WHAT:  The third reel's "video": an orange cat in headphones swaying in a
 *        warm, lamp-lit room, captioned "vibes only".
 * WHY:   See OctopusReel for why these are SVG rather than clips. Its room is
 *        lit from the top right by a glow the same colour as the pendant lamp
 *        over the real phone, so the brightest reel in the loop does not read
 *        as a different scene pasted into the screen.
 * WHERE: Rendered by ReelsFeed as reel C.
 */

export function CatReel({
  gradientId,
  glowId,
}: {
  gradientId: string;
  glowId: string;
}) {
  return (
    <svg
      viewBox="0 0 252 522"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a5a48" />
          <stop offset=".6" stopColor="#4a3428" />
          <stop offset="1" stopColor="#2a1d16" />
        </linearGradient>
        <radialGradient id={glowId} cx=".8" cy=".25" r=".6">
          <stop offset="0" stopColor="#ffcf8a" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffcf8a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="252" height="522" fill={`url(#${gradientId})`} />
      <rect width="252" height="522" fill={`url(#${glowId})`} />
      <rect x="150" y="70" width="80" height="104" rx="6" fill="#1d2440" />
      <circle cx="200" cy="104" r="14" fill="#f6e7b8" />
      <path d="M150 122h80M190 70v104" stroke="#5a4033" strokeWidth="5" />
      <rect x="26" y="96" width="56" height="70" rx="4" fill="#e6c36a" />
      <rect x="34" y="104" width="40" height="40" rx="3" fill="#a5543a" />
      <path
        d="M24 330 q14 -50 30 -10 q10 -40 24 6 q6 -28 18 0 v40 h-72z"
        fill="#3f6b3a"
      />
      <rect x="30" y="360" width="62" height="40" rx="6" fill="#8a5a3c" />
      <rect x="0" y="430" width="252" height="92" fill="#3a2a22" />
      <g className="reelSway">
        <ellipse cx="126" cy="392" rx="74" ry="78" fill="#ef9f55" />
        <ellipse cx="126" cy="410" rx="40" ry="52" fill="#fbe1c4" />
        <path
          d="M72 230 L80 176 L112 214 Z M180 230 L172 176 L140 214 Z"
          fill="#ef9f55"
        />
        <path
          d="M82 222 L86 192 L104 214 Z M170 222 L166 192 L148 214 Z"
          fill="#f7b7a3"
        />
        <circle cx="126" cy="268" r="60" fill="#f2a65a" />
        <path
          d="M108 216 q18 -10 36 0 M112 228 q14 -8 28 0"
          stroke="#d9823c"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="126" cy="296" rx="32" ry="24" fill="#fde6cc" />
        <path
          d="M96 268 q10 8 20 0 M136 268 q10 8 20 0"
          stroke="#4a2c1c"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path d="M121 286 h10 l-5 6z" fill="#e98a8a" />
        <path
          d="M126 292 q-6 8 -12 4 M126 292 q6 8 12 4"
          stroke="#4a2c1c"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M62 268 C 62 186, 190 186, 190 268"
          stroke="#ece6dd"
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
        />
        <rect x="48" y="246" width="28" height="48" rx="12" fill="#f3eee7" />
        <rect x="176" y="246" width="28" height="48" rx="12" fill="#f3eee7" />
        <rect x="54" y="252" width="10" height="36" rx="5" fill="#cfc7bc" />
        <rect x="188" y="252" width="10" height="36" rx="5" fill="#cfc7bc" />
      </g>
      <text
        x="126"
        y="122"
        textAnchor="middle"
        fontFamily="var(--font-bricolage), sans-serif"
        fontWeight="800"
        fontSize="34"
        fill="#fff"
        stroke="#1a1410"
        strokeWidth="7"
        paintOrder="stroke"
      >
        vibes only
      </text>
    </svg>
  );
}
