/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthFlowTemplate, AUTH_FLOW_ARRIVES,
 *   block-enter-rise, EVERY_ROUTE_ARRIVES, THE_PANEL_OUTLIVES_THE_PAGE,
 *   LCP_IS_NEVER_FADED, CTA_PINS_TO_THE_BOTTOM
 *
 * WHAT:  The form column's arrival. One element, rising 8px over 220ms, and
 *        the only thing between ./layout.tsx and the page.
 *
 * WHY:   EVERY_ROUTE_ARRIVES, which governed every authenticated route and
 *        skipped this group. The shell holds still — the wordmark, the legal
 *        line and the whole animated panel occupy the same pixels before and
 *        after — so when the mode tabs navigate from sign-in to sign-up the
 *        ONLY thing that changes is this column, and it changed by
 *        teleporting. That is the jarring swap an entrance is actually for.
 *
 *        A TEMPLATE AND NOT THE LAYOUT. A layout persists across sibling
 *        navigations, which is exactly what the showcase needs and exactly
 *        what an entrance cannot use: the DOM would never be replaced, so the
 *        animation would play once in a session and never again. A template
 *        is remounted on every navigation, which is the same trick
 *        page-header.tsx plays by keying `.block-enter` on the pathname —
 *        here the framework provides it, so nothing has to read the path.
 *
 *        `block-enter-rise` and not `.block-enter`: LCP_IS_NEVER_FADED. These
 *        are cold-entry pages reached by typing a URL or following a link
 *        from an email, so this column carries the largest paint, and a
 *        browser does not count an `opacity: 0` element as painted. The rise
 *        alone still reads as arriving.
 *
 *        `flex-1 lg:flex-none` is not decoration: on mobile
 *        CTA_PINS_TO_THE_BOTTOM depends on the form having a flex parent with
 *        slack to push `mt-auto` against, and at `lg` the shell's column
 *        centres its child, which it can only do if the child is not greedy.
 *        The same pair CheckInbox wears for the same two reasons.
 * WHERE: Between src/app/(auth)/(flow)/layout.tsx and each of that group's
 *        pages. Class in src/app/globals.css.
 */

export default function AuthFlowTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="block-enter-rise flex flex-1 flex-col lg:flex-none">
      {children}
    </div>
  );
}
