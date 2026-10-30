/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FACE_METRICS, FaceMetrics, FACE_400, FACE_700,
 *   REAL_ADVANCES_NOT_AN_ESTIMATE, METRICS_ARE_GENERATED_DATA,
 *   ADVANCE_SUM_IS_AN_UPPER_BOUND, BUNDLED_FONT_ONLY
 *
 * WHAT:  The real glyph advance widths of the two bundled Geist faces, taken
 *        from the font files themselves, plus the vertical metrics that decide
 *        how tall a line is.
 *
 * WHY:   REAL_ADVANCES_NOT_AN_ESTIMATE is the phase's step 3, stated as a
 *        requirement precisely because the obvious shortcut fails: an average
 *        character width makes "WWW" and "iii" the same length, and those two
 *        differ by a factor of nearly four in this face (912 against 246 units
 *        at weight 400). Overflow detection built on an average passes beats
 *        that run off the frame and refuses beats that fit, and it does both
 *        silently. Every number in this file is a `hmtx` advance for the
 *        glyph the `cmap` maps that codepoint to.
 *
 *        METRICS_ARE_GENERATED_DATA, and the provenance is checkable rather
 *        than asserted. The values were extracted from
 *        `node_modules/@fontsource/geist-sans/files/geist-sans-latin-{400,700}-normal.woff`
 *        at the version the lockfile pins. That is the SAME release whose
 *        `.woff2` siblings are the files in `public/fonts/` — byte-identical,
 *        md5 `c7c6c540…` and `c7d1f898…` — so these are the advances of the
 *        face that actually renders, not of a lookalike. The `.woff` was read
 *        rather than the `.woff2` for one reason: WOFF stores each table under
 *        plain zlib, which Node can inflate, while WOFF2 brotli-compresses the
 *        whole directory and transforms `glyf`. Same font, cheaper door.
 *
 *        A TABLE rather than a measurement at runtime, because the measurement
 *        has to happen in three places that have nothing in common: the
 *        browser editor, a Vitest process with no DOM, and the Inngest worker
 *        that runs the deterministic checks before any still is rendered.
 *        `canvas.measureText` exists in exactly one of those. A table is the
 *        only form of real measurement that is ISOMORPHIC, and isomorphic is
 *        what makes the editor's overflow warning and the server's refusal the
 *        same answer — the same argument ISOMORPHIC_PURE_MODULE makes for the
 *        timeline module.
 *
 *        ADVANCE_SUM_IS_AN_UPPER_BOUND, and this is the one honest gap. Geist
 *        carries GPOS kerning, which this table does not: kerned pairs ("Ta",
 *        "AV") draw a few units NARROWER than the sum of their advances. So a
 *        measured width here is at or above the true width, never below —
 *        which means the overflow check can report a false overflow on a line
 *        that would just fit, and can never miss a real one. That is the
 *        direction to be wrong in: a false overflow costs one repair attempt,
 *        a missed one costs a video with text off the frame. The error is
 *        bounded by a few tenths of a percent on real copy.
 *
 *        BUNDLED_FONT_ONLY: there are two faces here because there are two
 *        files in public/fonts. A third weight means a third woff2, a FACES
 *        entry in src/remotion/fonts.ts, and a third table here — in that
 *        order, so a weight can never be measurable but unrenderable.
 *
 * WHERE: src/lib/scene/measure.ts is the only reader. Nothing else should
 *        touch the encoded string.
 */

import type { CaptionWeight } from "@/lib/types/caption";

/**
 * SOURCE OF TRUTH KEYWORDS: FaceMetrics, ADVANCES_ARE_ENCODED
 *
 * WHAT:  One face's metrics. Distances are in font units; divide by `upem` to
 *        get a fraction of the font size.
 *
 * WHY:   ADVANCES_ARE_ENCODED. `advances` is `codepoint:advance` pairs, both
 *        in base 36, comma-separated — not an object literal with 538 keys.
 *        Two reasons, and neither is cleverness: a 538-key literal per weight
 *        is a thousand lines of generated code in a file a human has to scroll
 *        past, and V8 parses one string faster than it builds two large
 *        integer-keyed objects at module load, which this pays on every cold
 *        Lambda. It is decoded once into a Map by measure.ts.
 *
 *        `widestAdvance` is the fallback for a codepoint this face has no
 *        glyph for — an emoji, a CJK character. The browser would draw it from
 *        some other font whose advance nothing here knows, so the widest glyph
 *        in the face is used instead: it keeps the sum an UPPER bound, which
 *        is the property the overflow check depends on.
 * WHERE: FACE_METRICS below; decoded by measure.ts.
 */
export interface FaceMetrics {
  upem: number;
  ascender: number;
  descender: number;
  lineGap: number;
  widestAdvance: number;
  advances: string;
}

export const FACE_400: FaceMetrics = {
  upem: 1000,
  ascender: 920,
  descender: -220,
  lineGap: 100,
  widestAdvance: 1200,
  advances:
  "w:6y,x:61,y:a0,z:da,10:i1,11:le,12:ha,13:58,14:8p,15:8p,16:c4,17:fu,18:5n,19:bu,1a:5n,1b:df," +
  "1c:io,1d:ap,1e:h7,1f:h1,1g:ho,1h:he,1i:hc,1j:g9,1k:gs,1l:hc,1m:85,1n:85,1o:f9,1p:ic,1q:fd,1r" +
  ":fr,1s:pe,1t:io,1u:ix,1v:ji,1w:jj,1x:gs,1y:gf,1z:jp,20:jk,21:7k,22:gm,23:i5,24:g5,25:oe,26:k" +
  "j,27:ks,28:i3,29:km,2a:ip,2b:i1,2c:g2,2d:j6,2e:im,2f:pc,2g:hh,2h:hj,2i:f3,2j:9d,2k:da,2l:9d," +
  "2m:b6,2n:fo,2o:70,2p:g0,2q:gn,2r:fd,2s:gn,2t:fs,2u:b3,2v:gm,2w:g6,2x:6u,2y:79,2z:gf,30:7w,31" +
  ":oe,32:g6,33:g4,34:gn,35:gn,36:an,37:er,38:b1,39:g0,3a:ey,3b:ms,3c:gb,3d:ey,3e:fa,3f:bs,3g:7" +
  "c,3h:bs,3i:ey,4g:6y,4h:61,4i:fd,4j:h4,4k:gb,4l:hj,4m:7c,4n:fi,4o:94,4p:n8,4q:g0,4r:ey,4s:dh," +
  "4t:c0,4u:gq,4v:9q,4w:b0,4x:fu,4y:go,4z:go,50:70,51:gi,52:gh,53:5n,54:8m,55:go,56:g4,57:ey,58" +
  ":ql,59:r4,5a:r1,5b:fr,5c:io,5d:io,5e:io,5f:io,5g:io,5h:io,5i:r5,5j:ji,5k:gs,5l:gs,5m:gs,5n:g" +
  "s,5o:7k,5p:7k,5q:7k,5r:7k,5s:lz,5t:kj,5u:ks,5v:ks,5w:ks,5x:ks,5y:ks,5z:dj,60:kx,61:j6,62:j6," +
  "63:j6,64:j6,65:hj,66:h9,67:gf,68:g0,69:g0,6a:g0,6b:g0,6c:g0,6d:g0,6e:pw,6f:fd,6g:fs,6h:fs,6i" +
  ":fs,6j:fs,6k:6u,6l:6u,6m:6u,6n:6u,6o:gj,6p:g6,6q:g4,6r:g4,6s:g4,6t:g4,6u:g4,6v:fu,6w:fq,6x:g" +
  "0,6y:g0,6z:g0,70:g0,71:ey,72:gn,73:ey,74:io,75:g0,76:io,77:g0,78:jn,79:g0,7a:ji,7b:fd,7c:ji," +
  "7d:fd,7e:ji,7f:fd,7g:ji,7h:fd,7i:jj,7j:l4,7k:lz,7l:i4,7m:gs,7n:fs,7q:gs,7r:fs,7s:gs,7t:fs,7u" +
  ":gs,7v:fs,7w:jp,7x:gm,7y:jp,7z:gm,80:jp,81:gm,82:jp,83:gm,84:jk,85:g6,86:o4,87:fw,88:7k,89:6" +
  "u,8a:7k,8b:6u,8e:7k,8f:6u,8g:7k,8h:6u,8i:lu,8j:dt,8k:gm,8l:79,8m:i5,8n:gf,8p:g5,8q:7w,8r:g5," +
  "8s:7w,8t:f2,8u:be,8x:h4,8y:ai,8z:kj,90:g6,91:kj,92:g6,93:kj,94:g6,96:kj,97:g6,98:ks,99:g4,9c" +
  ":ks,9d:g4,9e:u6,9f:qs,9g:ip,9h:an,9i:ip,9j:an,9k:ip,9l:an,9m:i1,9n:er,9o:i1,9p:er,9q:i1,9r:e" +
  "r,9s:i1,9t:er,9u:g2,9v:b1,9w:g2,9x:cm,9y:g2,9z:b1,a0:j6,a1:g0,a2:j6,a3:g0,a4:j6,a5:g0,a6:j6," +
  "a7:g0,a8:j6,a9:g0,aa:j6,ab:g0,ac:pc,ad:ms,ae:hj,af:ey,ag:hj,ah:f3,ai:fa,aj:f3,ak:fa,al:f3,am" +
  ":fa,b3:k2,b6:eb,c7:gp,ct:io,cu:g0,dg:kz,dh:hm,di:jp,dj:gm,dk:i5,dl:gf,dq:gp,dr:gp,ew:i1,ex:e" +
  "r,ey:g2,ez:b1,fr:79,gp:fs,ia:gp,jd:70,jg:5r,jq:ac,jr:ac,js:54,k8:ai,k9:54,ka:7t,kb:79,kc:by," +
  "kd:ae,lc:0,ld:0,le:0,lf:0,lg:0,li:0,lj:0,lk:0,lm:0,ln:0,lo:0,lu:0,me:0,mf:0,mg:0,mt:0,pn:io," +
  "q1:kk,qj:fx,qo:ic,2tb:ht,5y8:jp,5y9:gm,60w:pc,60x:ms,60y:pc,60z:ms,610:pc,611:ms,61q:ja,62k:" +
  "gs,62l:fs,642:hj,643:ey,648:hj,649:ey,6c3:gm,6c4:pe,6c8:5r,6c9:5r,6ca:5r,6cc:ae,6cd:ae,6ce:a" +
  "e,6cg:fv,6ch:fv,6ci:89,6cm:fx,6cw:ug,6cy:70,6cz:af,6d5:9c,6d6:9c,6dg:go,6eo:go,6es:go,6et:go" +
  ",6eu:go,6ev:go,6ew:go,6ex:go,6f4:go,6f5:go,6f6:go,6f7:go,6f8:go,6f9:go,6fa:go,6fb:go,6fc:go," +
  "6fd:go,6ga:lj,6gc:kg,6gk:iq,6gp:iw,6gt:k1,6iv:h1,6ja:uc,6jb:gq,6jm:oq,6kz:qq,6l0:qi,6l1:qf,6" +
  "l7:qo,6l8:r4,6l9:qz,6la:xc,6mo:mg,6mp:k0,6mq:mg,6mr:k0,6ms:t2,6mt:k0,6mu:hi,6mv:hi,6mw:hi,6m" +
  "x:hi,6n1:id,6nd:ig,6ne:ig,6nk:in,6nl:in,6nn:in,6no:is,6np:in,6p0:iw,6p1:iw,6p3:ma,6pu:gl,6py" +
  ":i4,6q7:h4,6q9:eq,6qa:fu,6qi:gz,6qm:nd,6qz:aj,6rs:ey,6sg:fu,6sk:fu,6sl:fu,72m:nt,74b:go,74c:" +
  "go,76o:n4,76p:n4,76q:n4,76r:n4,76s:n4,76t:n4,76u:n4,76v:n4,76w:n4,7ai:n4,7b3:n4,7g2:nx,7g3:n" +
  "x,7g6:mv,7g7:mv,7gc:nx,7gd:nx,7gg:mv,7gh:mv,7gq:f1,7gr:no,7gs:no,7gv:no,7jt:n4,7ju:n4,7sm:n4" +
  ",7sn:n4,7so:n4,7sp:n4,7sq:n4,7sr:n4,7ss:n4,7st:n4,7su:n4,9he:9u,9hf:ag,9hk:9z,9hl:9z,9hm:em," +
  "9hn:em,9ho:b1,9hp:b1,9hq:b1,9hr:b1,9hs:a9,9ht:a9,9hw:b3,9hx:b3,9hy:9z,9hz:9z,9i4:nv,x3f:58,x" +
  "3g:58,1edd:7o,1ede:9w,1edf:da,1edh:le,1edi:hu,1edj:54,1edk:8p,1edl:8p,1edm:c4,1edo:5n,1edp:k" +
  "0,1edq:5n,1edr:df,1ee2:5n,1ee3:5n,1ee7:fr,1ee8:pa,1eez:9d,1ef0:da,1ef1:9d,1ef3:fo,1efv:bs,1e" +
  "fx:bs",
};

export const FACE_700: FaceMetrics = {
  upem: 1000,
  ascender: 920,
  descender: -220,
  lineGap: 100,
  widestAdvance: 1200,
  advances:
  "w:6d,x:74,y:ar,z:gd,10:iv,11:nd,12:jp,13:5j,14:9o,15:9o,16:bu,17:fe,18:6n,19:bq,1a:6n,1b:ej," +
  "1c:jd,1d:ch,1e:i5,1f:i5,1g:iw,1h:in,1i:ic,1j:gk,1k:ij,1l:ih,1m:8l,1n:8l,1o:ex,1p:hc,1q:f1,1r" +
  ":gk,1s:qp,1t:km,1u:jj,1v:k9,1w:jz,1x:ha,1y:gt,1z:kg,20:jy,21:8d,22:hf,23:jl,24:gd,25:pf,26:k" +
  "s,27:lh,28:io,29:lb,2a:jd,2b:iv,2c:hk,2d:jk,2e:kl,2f:rj,2g:jz,2h:jb,2i:gl,2j:an,2k:eg,2l:an," +
  "2m:bo,2n:fp,2o:7d,2p:h7,2q:ho,2r:gq,2s:ho,2t:gy,2u:ch,2v:ho,2w:gz,2x:7u,2y:97,2z:i0,30:94,31" +
  ":p0,32:gz,33:ha,34:ho,35:ho,36:bv,37:g1,38:cg,39:gw,3a:gy,3b:nm,3c:i3,3d:gc,3e:gk,3f:bz,3g:8" +
  "8,3h:bz,3i:eh,4g:6d,4h:74,4i:gq,4j:hy,4k:g1,4l:jb,4m:88,4n:gp,4o:c7,4p:ms,4q:h7,4r:i7,4s:d1," +
  "4t:bt,4u:ga,4v:a8,4w:bk,4x:g3,4y:go,4z:go,50:79,51:hf,52:i8,53:6n,54:90,55:go,56:ha,57:i7,58" +
  ":qd,59:qw,5a:qy,5b:gk,5c:km,5d:km,5e:km,5f:km,5g:km,5h:km,5i:t6,5j:k9,5k:ha,5l:ha,5m:ha,5n:h" +
  "a,5o:8d,5p:8d,5q:8d,5r:8d,5s:m3,5t:ks,5u:lh,5v:lh,5w:lh,5x:lh,5y:lh,5z:dx,60:lk,61:jk,62:jk," +
  "63:jk,64:jk,65:jb,66:ht,67:ia,68:h7,69:h7,6a:h7,6b:h7,6c:h7,6d:h7,6e:qu,6f:gq,6g:gy,6h:gy,6i" +
  ":gy,6j:gy,6k:7u,6l:7u,6m:7u,6n:7u,6o:h5,6p:gz,6q:ha,6r:ha,6s:ha,6t:ha,6u:ha,6v:fe,6w:gv,6x:g" +
  "w,6y:gw,6z:gw,70:gw,71:gc,72:he,73:gc,74:km,75:h7,76:km,77:h7,78:lh,79:h7,7a:k9,7b:gq,7c:k9," +
  "7d:gq,7e:k9,7f:gq,7g:k9,7h:gq,7i:jz,7j:my,7k:m3,7l:j7,7m:ha,7n:gy,7q:ha,7r:gy,7s:ha,7t:gy,7u" +
  ":ha,7v:gy,7w:kg,7x:ho,7y:kg,7z:ho,80:kg,81:ho,82:kg,83:ho,84:jy,85:gz,86:oe,87:go,88:8d,89:7" +
  "u,8a:8d,8b:7u,8e:8d,8f:7u,8g:8d,8h:7u,8i:o5,8j:gr,8k:hf,8l:97,8m:jl,8n:i0,8p:gd,8q:94,8r:gd," +
  "8s:94,8t:fr,8u:dn,8x:hj,8y:bl,8z:ks,90:gz,91:ks,92:gz,93:ks,94:gz,96:ks,97:gz,98:lh,99:ha,9c" +
  ":lh,9d:ha,9e:ux,9f:ry,9g:jd,9h:bv,9i:jd,9j:bv,9k:jd,9l:bv,9m:iv,9n:g1,9o:iv,9p:g1,9q:iv,9r:g" +
  "1,9s:iv,9t:g1,9u:hk,9v:cg,9w:hk,9x:ew,9y:hk,9z:cg,a0:jk,a1:gw,a2:jk,a3:gw,a4:jk,a5:gw,a6:jk," +
  "a7:gw,a8:jk,a9:gw,aa:jk,ab:gw,ac:rj,ad:nm,ae:jb,af:gc,ag:jb,ah:gl,ai:gk,aj:gl,ak:gk,al:gl,am" +
  ":gk,b3:kz,b6:eq,c7:hw,ct:km,cu:h7,dg:ll,dh:il,di:kg,dj:ho,dk:jl,dl:i0,dq:hw,dr:hw,ew:iv,ex:g" +
  "1,ey:hk,ez:cg,fr:97,gp:gy,ia:hw,jd:79,jg:6r,jq:bb,jr:bb,js:5f,k8:ax,k9:6i,ka:7v,kb:7e,kc:bx," +
  "kd:bf,lc:0,ld:0,le:0,lf:0,lg:0,li:0,lj:0,lk:0,lm:0,ln:0,lo:0,lu:0,me:0,mf:0,mg:0,mt:0,pn:ke," +
  "q1:la,qj:i3,qo:io,2tb:iq,5y8:kg,5y9:ho,60w:rj,60x:nm,60y:rj,60z:nm,610:rj,611:nm,61q:km,62k:" +
  "ha,62l:gy,642:jb,643:gc,648:jb,649:gc,6c3:gn,6c4:pf,6c8:6r,6c9:6r,6ca:6r,6cc:cq,6cd:cq,6ce:c" +
  "q,6cg:g3,6ch:g7,6ci:9b,6cm:jc,6cw:wp,6cy:79,6cz:bg,6d5:aw,6d6:aw,6dg:go,6eo:go,6es:go,6et:go" +
  ",6eu:go,6ev:go,6ew:go,6ex:go,6f4:go,6f5:go,6f6:go,6f7:go,6f8:go,6f9:go,6fa:go,6fb:go,6fc:go," +
  "6fd:go,6ga:o7,6gc:kj,6gk:ju,6gp:jp,6gt:kb,6iv:h7,6ja:ut,6jb:ga,6jm:ok,6kz:qi,6l0:qf,6l1:q7,6" +
  "l7:qg,6l8:r1,6l9:qx,6la:xc,6mo:m0,6mp:jk,6mq:m0,6mr:jk,6ms:u2,6mt:jk,6mu:hp,6mv:hp,6mw:hq,6m" +
  "x:hq,6n1:hy,6nd:ia,6ne:ia,6nk:ib,6nl:ib,6nn:ib,6no:ib,6np:ib,6p0:ig,6p1:ig,6p3:ov,6pu:h7,6py" +
  ":ig,6q7:jt,6q9:fh,6qa:fe,6qi:jb,6qm:o0,6qz:ck,6rs:eh,6sg:fe,6sk:fe,6sl:fe,72m:p1,74b:go,74c:" +
  "go,76o:nh,76p:nh,76q:nh,76r:nh,76s:nh,76t:nh,76u:nh,76v:nh,76w:nh,7ai:nh,7b3:mo,7g2:o5,7g3:o" +
  "5,7g6:mh,7g7:mh,7gc:o5,7gd:o5,7gg:mh,7gh:mh,7gq:gh,7gr:n8,7gs:n8,7gv:n8,7jt:nh,7ju:nh,7sm:mo" +
  ",7sn:mo,7so:mo,7sp:mo,7sq:mo,7sr:mo,7ss:mo,7st:mo,7su:mo,9he:9y,9hf:b7,9hk:b1,9hl:b1,9hm:hm," +
  "9hn:hm,9ho:ap,9hp:ap,9hq:al,9hr:al,9hs:a1,9ht:a1,9hw:ay,9hx:ay,9hy:ah,9hz:ah,9i4:o6,x3f:5h,x" +
  "3g:5h,1edd:7o,1ede:an,1edf:gd,1edh:nd,1edi:js,1edj:5f,1edk:9o,1edl:9o,1edm:bu,1edo:6n,1edp:k" +
  "1,1edq:6n,1edr:df,1ee2:6n,1ee3:6n,1ee7:gk,1ee8:q4,1eez:an,1ef0:da,1ef1:an,1ef3:fp,1efv:bz,1e" +
  "fx:bz",
};

/**
 * SOURCE OF TRUTH KEYWORDS: FACE_METRICS
 *
 * Keyed by the two weights src/lib/types/caption.ts calls CAPTION_WEIGHTS —
 * the same two faces, because there is only one bundled family and these are
 * the only weights of it in public/fonts.
 */
export const FACE_METRICS: Readonly<Record<CaptionWeight, FaceMetrics>> = {
  400: FACE_400,
  700: FACE_700,
};
