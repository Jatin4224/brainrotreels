/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: POST /api/v1/projects/:id/voices,
 *   THE_PROJECT_IS_NAMED_NOT_INFERRED, THE_PATH_IS_NOT_DECORATIVE
 *
 * WHAT:  Assigns a voice to one of a project's speakers.
 *
 * WHY:   THE_PATH_IS_NOT_DECORATIVE. The project id in the URL is passed into
 *        the operation, which refuses the write if the speaker is not in that
 *        project. Without that, a client could name any project and we would
 *        ignore it — a URL that does not mean what it says, and a stale
 *        speaker id quietly assigning a voice in a different video.
 *
 *        The id reaches the operation through a CLOSURE rather than through
 *        the schema, which is the pattern every parameterised route here uses:
 *        a path segment is not part of a body, and a body field that could
 *        disagree with the URL is a question nobody should have to answer.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { assignVoiceOperation } from "@/lib/api/operations";
import { apiAssignVoiceSchema } from "@/lib/types/api";

import { methodNotAllowed, runApiRoute } from "../../../_lib/handler";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return runApiRoute(request, {
    input: "body",
    schema: apiAssignVoiceSchema,
    idempotent: true,
    run: (operation, input) =>
      assignVoiceOperation(operation, {
        /* From the path — see THE_PROJECT_IS_NAMED_NOT_INFERRED. */
        projectId: id,
        speakerId: input.speakerId,
        voiceId: input.voiceId,
      }),
  });
}

export async function GET(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "POST"));
}
