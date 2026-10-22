/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LowBalanceEmail, LowBalanceEmailProps,
 *   WARN_BEFORE_IT_BITES, ONE_WARNING_NOT_A_DRIP
 *
 * WHAT:  React Email template warning a workspace that its credits are nearly
 *        gone.
 *
 * WHY:   WARN_BEFORE_IT_BITES. The failure this prevents is a generation that
 *         dies half way through because the balance ran out mid-pipeline — the
 *         customer has already waited two minutes, the script and the narration
 *         are paid for, and the video does not exist. A warning a day earlier
 *         turns that into a top-up.
 *
 *        It states the balance AND what that buys, because a credit count is
 *        meaningless on its own: "42 credits" tells a customer nothing, and
 *        "about one more video" tells them whether to act today.
 *
 *        ONE_WARNING_NOT_A_DRIP is the rule the SENDER enforces rather than
 *        this template — see the note on `sendLowBalanceEmail`. An email that
 *        arrives every time a balance is checked below the threshold is one
 *        that gets filtered, which costs the warning its whole value.
 * WHERE: Rendered by sendLowBalanceEmail in src/services/email.service.ts.
 */

import * as React from "react";
import { Text } from "@react-email/components";
import { BaseLayout, EmailButton, emailStyles } from "../base-layout";

export interface LowBalanceEmailProps {
  organizationName: string;
  balance: number;
  /** Roughly how many more videos that is. Omitted when it is none. */
  approximateVideosLeft?: number;
  topUpLink: string;
}

export function LowBalanceEmail({
  organizationName,
  balance,
  approximateVideosLeft,
  topUpLink,
}: LowBalanceEmailProps) {
  return (
    <BaseLayout preview={`${organizationName} is running low on credits`}>
      <Text style={emailStyles.title}>You are running low on credits</Text>

      <Text style={emailStyles.paragraph}>
        <strong>{organizationName}</strong> has {balance} credit
        {balance === 1 ? "" : "s"} left
        {/* The count alone is meaningless — see the file header. */}
        {approximateVideosLeft !== undefined && approximateVideosLeft > 0
          ? `, which is roughly ${approximateVideosLeft} more video${approximateVideosLeft === 1 ? "" : "s"}.`
          : ", which is not enough to finish another video."}
      </Text>

      <Text style={emailStyles.paragraph}>
        Top up before your next generation so it does not stop part-way
        through. Anything already in progress is unaffected.
      </Text>

      <EmailButton href={topUpLink}>Top up credits</EmailButton>

      <Text style={emailStyles.note}>
        Or paste this link into your browser: {topUpLink}
      </Text>
    </BaseLayout>
  );
}

export default LowBalanceEmail;
