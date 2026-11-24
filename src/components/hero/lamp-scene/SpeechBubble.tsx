/**
 * SOURCE OF TRUTH KEYWORDS: SpeechBubble, THE_HAND_TALKS_BACK, AnimatePresence
 *
 * WHAT:  The little cream bubble the hand speaks in when it reacts.
 *
 * WHY:   THE_HAND_TALKS_BACK. Three lines of pose curves can show a hand being
 *        annoyed; they cannot show WHAT it is annoyed about, and "hey! I'm
 *        scrolling" turns a swat from a physics demo into a joke the visitor
 *        is in on. It is the only text in the scene, which is why it gets the
 *        one `role="status"` here: the scene is decorative, but a thing that
 *        speaks should be heard.
 *
 *        It pops IN and vanishes OUT with no exit animation on purpose — the
 *        hand is interrupted constantly, and a bubble that fades out over
 *        200ms is still on screen contradicting the next one.
 * WHERE: Over the hand in LampScene, keyed on the text so a new line restarts
 *        the pop rather than cross-fading through the old one.
 */

"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function SpeechBubble({ text }: { text: string }) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {text ? (
        <motion.div
          key={text}
          role="status"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          className="absolute whitespace-nowrap font-semibold"
          style={{
            left: 368,
            top: 408,
            padding: "9px 13px",
            borderRadius: "14px 14px 14px 4px",
            background: "#f3eadb",
            color: "#17120c",
            fontSize: 14,
            boxShadow: "0 10px 28px rgba(0,0,0,0.5)",
            transformOrigin: "0 100%",
          }}
        >
          {text}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
