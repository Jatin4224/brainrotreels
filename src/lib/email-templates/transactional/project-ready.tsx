/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectReadyEmail, ProjectReadyEmailProps,
 *   EMAIL_IS_OPT_IN, LINK_GOES_TO_THE_PREVIEW
 *
 * WHAT:  React Email template telling someone the video they asked for is
 *        ready to watch.
 * WHY:   The phase's "email me when done" — a generation takes minutes across
 *        three providers, which is long enough that nobody should have to keep
 *        the tab open (and they do not have to: the run survives the tab
 *        closing).
 *
 *        LINK_GOES_TO_THE_PREVIEW, not to the project list. The one thing the
 *        recipient wants is to watch the thing, and a list is a second click
 *        plus a search for the row.
 *
 *        It names what was made rather than only announcing success, because
 *        a workspace generating several videos gets several of these and
 *        "Your video is ready" twice in an inbox is indistinguishable.
 * WHERE: Rendered by sendProjectReadyEmail in src/services/email.service.ts,
 *        from the `notify` step of
 *        src/inngest/functions/project-generate.ts.
 */

import * as React from "react";
import { Text } from "@react-email/components";
import { BaseLayout, EmailButton, emailStyles } from "../base-layout";

export interface ProjectReadyEmailProps {
  projectTitle: string;
  previewLink: string;
  /** Omitted when the account has no name set — the greeting drops with it. */
  recipientName?: string;
}

export function ProjectReadyEmail({
  projectTitle,
  previewLink,
  recipientName,
}: ProjectReadyEmailProps) {
  return (
    <BaseLayout preview={`${projectTitle} is ready to watch`}>
      <Text style={emailStyles.title}>Your video is ready</Text>
      <Text style={emailStyles.paragraph}>
        {recipientName ? `${recipientName}, ` : ""}
        <strong>{projectTitle}</strong> has finished generating — the narration
        is recorded and the captions are timed to it.
      </Text>
      <EmailButton href={previewLink}>Watch it</EmailButton>
      <Text style={emailStyles.note}>
        Or paste this link into your browser: {previewLink}
      </Text>
    </BaseLayout>
  );
}

export default ProjectReadyEmail;
