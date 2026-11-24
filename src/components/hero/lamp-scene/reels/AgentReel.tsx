/**
 * SOURCE OF TRUTH KEYWORDS: AgentReel, REELS_ARE_DRAWN_NOT_FILMED
 *
 * WHAT:  The second reel's "video": a cartoon character throwing its arms up
 *        in a sunlit field, captioned "great agent!".
 * WHY:   See OctopusReel for why these are SVG rather than clips. This one is
 *        the reel that is nominally about the product, which is why it is the
 *        MIDDLE of the three: a feed that opens on an advert is an advert, and
 *        a feed that reaches one between an octopus and a cat is a feed.
 * WHERE: Rendered by ReelsFeed as reel B.
 */

export function AgentReel({ gradientId }: { gradientId: string }) {
  return (
    <svg
      viewBox="0 0 252 522"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd9a8" />
          <stop offset="1" stopColor="#ffefd6" />
        </linearGradient>
      </defs>
      <rect width="252" height="522" fill={`url(#${gradientId})`} />
      <circle cx="196" cy="96" r="34" fill="#ff9a5a" />
      <path d="M0 330 C70 300 150 320 252 296 V522 H0Z" fill="#8fc66b" />
      <path d="M0 380 C90 350 170 380 252 360 V522 H0Z" fill="#6aab4e" />
      <g fill="#fff" opacity=".9">
        <rect x="0" y="352" width="252" height="6" />
        <rect x="0" y="372" width="252" height="6" />
        <rect x="20" y="340" width="6" height="50" />
        <rect x="80" y="340" width="6" height="50" />
        <rect x="140" y="340" width="6" height="50" />
        <rect x="200" y="340" width="6" height="50" />
      </g>
      <g transform="translate(126 300)">
        <rect x="-34" y="20" width="68" height="84" rx="26" fill="#ffc83d" />
        <circle cx="0" cy="-12" r="44" fill="#ffd9b8" />
        <path
          d="M-46 -20 C-50 -64 30 -76 46 -30 C30 -40 0 -50 -46 -20Z"
          fill="#e0662c"
        />
        <circle cx="-15" cy="-6" r="7" fill="#24201c" />
        <circle cx="15" cy="-6" r="7" fill="#24201c" />
        <circle cx="-13" cy="-9" r="2.4" fill="#fff" />
        <circle cx="17" cy="-9" r="2.4" fill="#fff" />
        <path
          d="M-10 14 Q0 24 10 14"
          stroke="#9a3b20"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          className="reelWave"
          d="M-34 40 L-62 6 M34 40 L62 6"
          stroke="#ffd9b8"
          strokeWidth="14"
          strokeLinecap="round"
        />
      </g>
      <text
        x="126"
        y="470"
        textAnchor="middle"
        fontFamily="var(--font-bricolage), sans-serif"
        fontWeight="800"
        fontSize="40"
        fill="#fff"
        stroke="#1a1410"
        strokeWidth="7"
        paintOrder="stroke"
      >
        great agent!
      </text>
    </svg>
  );
}
