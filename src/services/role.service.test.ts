/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: role.service test, processRole, RoleEscalationError,
 *   UnknownPermissionError, OWNER_IS_NEVER_ASSIGNABLE,
 *   PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED, isOwnerRoleName
 *
 * WHAT:  The decode seam every role assignment passes through — that it refuses
 *        an owner-role request, refuses a permission the registry does not
 *        define, and still resolves the three legitimate encodings.
 *
 * WHY:   `hasFullAccess` is a comparison against the role STRING, so whatever
 *        this function returns is the whole authorization decision for a
 *        member: an `"owner"` escaping it short-circuits every gate in the
 *        procedure factory. Both reachable callers (member.update and
 *        invitation.create) hand it a `z.string().min(1)` straight from the
 *        request, so the refusals are not a second line of defence — they are
 *        the only one, and worth asserting rather than trusting.
 *
 *        Two properties are under test that a reader cannot see from one
 *        branch. OWNER_IS_NEVER_ASSIGNABLE must hold for every ENCODING of the
 *        name, not just the bare string — `"Owner|||[…]"` normalizes to
 *        `owner`, which is the variant that would have slipped past a check
 *        written only against the raw input. PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED
 *        must hold for the array smuggled INSIDE the role string, which never
 *        passed `updateMemberSchema`'s `permissionStringSchema`.
 *
 *        Every refusal is asserted against a database that throws on contact,
 *        so the test also pins down that nothing is written before the decision
 *        is made — a role row created for a request that is then refused would
 *        be a quiet way to pile up attacker-named roles.
 *
 *        Permission strings come from VALID_PERMISSION_STRINGS rather than being
 *        written out, so these tests cannot go stale when the registry changes.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/config/prisma";
import { VALID_PERMISSION_STRINGS, isOwnerRoleName } from "@/lib/types";
import {
  processRole,
  RoleEscalationError,
  UnknownPermissionError,
} from "./role.service";

const ORG = "org_1";

/* A refusal must happen before any write. Following the NO_DB pattern in
 * src/lib/generators/generators.test.ts: a database that throws on contact
 * fails loudly rather than letting a refused request touch a real one. */
const NO_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("a refused role must not touch the database");
    },
  },
) as DbClient;

/* The happy path DOES write, so it needs somewhere to write to. Records what
 * ensureRole asked for, which is the only thing the assertions care about. */
function recordingDb(): {
  db: DbClient;
  created: { role: string; permission: string }[];
} {
  const created: { role: string; permission: string }[] = [];
  const db = {
    organizationRole: {
      findFirst: () => Promise.resolve(null),
      create: (args: { data: { role: string; permission: string } }) => {
        created.push({
          role: args.data.role,
          permission: args.data.permission,
        });
        return Promise.resolve(args.data);
      },
    },
  } as unknown as DbClient;
  return { db, created };
}

const LEGAL = VALID_PERMISSION_STRINGS[0] ?? "";
const LEGAL_TWO = VALID_PERMISSION_STRINGS[1] ?? LEGAL;

describe("isOwnerRoleName", () => {
  it("recognises the owner names whatever their casing or padding", () => {
    expect(isOwnerRoleName("owner")).toBe(true);
    expect(isOwnerRoleName("OWNER")).toBe(true);
    expect(isOwnerRoleName("  Owner  ")).toBe(true);
    expect(isOwnerRoleName("client-owner")).toBe(true);
  });

  it("does not mistake an ordinary role for an owner", () => {
    expect(isOwnerRoleName("member")).toBe(false);
    expect(isOwnerRoleName("admin")).toBe(false);
    /* Not a prefix match: a role may legitimately be NAMED after ownership
     * without BEING the owner role. */
    expect(isOwnerRoleName("owner-liaison")).toBe(false);
    expect(isOwnerRoleName("co-owner")).toBe(false);
  });
});

describe("processRole — OWNER_IS_NEVER_ASSIGNABLE", () => {
  it("refuses the bare owner role", async () => {
    await expect(processRole(NO_DB, ORG, "owner")).rejects.toThrow(
      RoleEscalationError,
    );
  });

  it("refuses it whatever the casing or padding", async () => {
    await expect(processRole(NO_DB, ORG, "OWNER")).rejects.toThrow(
      RoleEscalationError,
    );
    await expect(processRole(NO_DB, ORG, " Owner ")).rejects.toThrow(
      RoleEscalationError,
    );
  });

  it("refuses the second owner name the member router protects", async () => {
    await expect(processRole(NO_DB, ORG, "client-owner")).rejects.toThrow(
      RoleEscalationError,
    );
  });

  /* The variant a guard written only against the raw input would have missed:
   * the name is decoded and normalized first, and `"Owner"` normalizes to
   * `owner`. This is the encoding the member sheet actually sends for a new
   * named role, so it is the realistic attack shape. */
  it("refuses a named role whose name normalizes to owner", async () => {
    await expect(
      processRole(NO_DB, ORG, `Owner|||${JSON.stringify([LEGAL])}`),
    ).rejects.toThrow(RoleEscalationError);
  });

  it("carries the requested role on the error for the audit line", async () => {
    await expect(processRole(NO_DB, ORG, "owner")).rejects.toMatchObject({
      name: "RoleEscalationError",
      requestedRole: "owner",
    });
  });
});

describe("processRole — PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED", () => {
  it("refuses an invented permission in a bare array", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify(["billing:pillage"])),
    ).rejects.toThrow(UnknownPermissionError);
  });

  it("refuses an invented permission inside a named role", async () => {
    await expect(
      processRole(NO_DB, ORG, `strike-team|||${JSON.stringify(["nope:nope"])}`),
    ).rejects.toThrow(UnknownPermissionError);
  });

  it("refuses the array even when only one entry is unknown", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify([LEGAL, "nope:nope"])),
    ).rejects.toThrow(UnknownPermissionError);
  });

  it("names the offending permissions on the error", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify(["a:b", "c:d"])),
    ).rejects.toMatchObject({
      name: "UnknownPermissionError",
      unknownPermissions: ["a:b", "c:d"],
    });
  });
});

describe("processRole — the legitimate encodings still resolve", () => {
  it("passes a plain existing role name through untouched", async () => {
    /* The plain branch returns before any lookup, which is why NO_DB is safe
     * here and why an existing role is not re-created on every edit. */
    await expect(processRole(NO_DB, ORG, "editor")).resolves.toBe("editor");
  });

  it("creates a named role with exactly the permissions it was sent", async () => {
    const { db, created } = recordingDb();
    const role = await processRole(
      db,
      ORG,
      `Strike Team|||${JSON.stringify([LEGAL, LEGAL_TWO])}`,
    );

    expect(role).toBe("strike-team");
    expect(created).toHaveLength(1);
    expect(created[0]?.role).toBe("strike-team");
    /* Stored as the JSON statement map the procedure factory reads back. */
    expect(created[0]?.permission).toContain(LEGAL.split(":")[0] ?? "");
  });

  it("gives an identical permission set the same custom role name", async () => {
    const first = recordingDb();
    const second = recordingDb();

    const a = await processRole(
      first.db,
      ORG,
      JSON.stringify([LEGAL, LEGAL_TWO]),
    );
    /* Reversed — the name is a hash of the SORTED set, so order must not
     * produce a second role row for the same grant. */
    const b = await processRole(
      second.db,
      ORG,
      JSON.stringify([LEGAL_TWO, LEGAL]),
    );

    expect(a).toBe(b);
    expect(a.startsWith("custom-")).toBe(true);
    /* A custom name can never collide with an owner name, which is why the
     * bare-array branch needs no second owner check. */
    expect(isOwnerRoleName(a)).toBe(false);
  });

  it("treats a malformed permission array as no permissions, not an error", async () => {
    const { db, created } = recordingDb();
    /* Unparseable JSON is a client bug with nothing to validate; it resolves to
     * an empty grant rather than a refusal, which is the pre-existing
     * behaviour and the safe direction. */
    const role = await processRole(db, ORG, "[not json");
    expect(role.startsWith("custom-")).toBe(true);
    expect(created).toHaveLength(1);
  });
});
