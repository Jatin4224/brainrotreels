/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: GET /api/v1/catalog/backgrounds, CURSOR_PAGINATION,
 *   THE_CURSOR_IS_OPAQUE, LOCKED_NOT_HIDDEN
 *
 * WHAT:  A page of the shared background library, with availability per row.
 *
 * WHY:   CURSOR_PAGINATION, which the phase file asks for and which this is the
 *        only endpoint to need — the other catalogues are small closed sets
 *        and the library grows.
 *
 *        THE_CURSOR_IS_OPAQUE. What comes back is a STRING the client is
 *        expected to send back untouched, and today it happens to be an
 *        offset. That is deliberate: page-number paging is a promise about the
 *        shape of the data (that nothing was inserted between calls), and
 *        keyset paging is where this should end up. Encoding it as an opaque
 *        string means replacing the implementation later is not a breaking
 *        change, while a documented `?page=2` would be.
 *
 *        `nextCursor` is null on the last page rather than absent, so a client
 *        loops on a value rather than on the presence of a key.
 * WHERE: Documented in the OpenAPI document at /api/v1/openapi.json.
 */

import { listBackgroundCatalogOperation } from "@/lib/api/operations";
import { apiBackgroundCatalogSchema } from "@/lib/types/api";

import { methodNotAllowed, runApiRoute } from "../../_lib/handler";

export async function GET(request: Request): Promise<Response> {
  return runApiRoute(request, {
    input: "query",
    schema: apiBackgroundCatalogSchema,
    run: async (operation, input) => {
      /* The cursor decodes to an offset. A cursor we did not issue — a
       * truncated copy-paste, a client inventing one — decodes to 0 rather
       * than erroring: the worst outcome is the first page, and refusing would
       * strand a client that mangled a value it was told to treat as opaque. */
      const skip = decodeCursor(input.cursor);

      const page = await listBackgroundCatalogOperation(operation, {
        ...(input.search !== undefined ? { search: input.search } : {}),
        skip,
        take: input.limit,
      });

      const nextSkip = skip + page.backgrounds.length;

      return {
        ...page,
        nextCursor: nextSkip < page.total ? encodeCursor(nextSkip) : null,
      };
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  return Promise.resolve(methodNotAllowed(request, "GET"));
}

/* base64url so the value looks opaque and survives a query string without
 * escaping. It is not a secret and is not pretending to be one — it is a
 * marker that this is ours to interpret and not the client's to construct. */
function encodeCursor(skip: number): string {
  return Buffer.from(String(skip), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;

  const decoded = Number.parseInt(
    Buffer.from(cursor, "base64url").toString("utf8"),
    10,
  );
  return Number.isSafeInteger(decoded) && decoded >= 0 ? decoded : 0;
}
