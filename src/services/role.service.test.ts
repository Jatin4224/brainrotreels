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
import { permissionsToStatement } from "@/lib/permissions";
import {
  VALID_PERMISSION_STRINGS,
  isOwnerRoleName,
  type PermissionGrantAuthority,
} from "@/lib/types";
import {
  processRole,
  PermissionEscalationError,
  RoleEscalationError,
  UnknownPermissionError,
} from "./role.service";

const ORG = "org_1";

/* A_GRANT_CANNOT_EXCEED_THE_GRANTER. Most cases here are about a DIFFERENT
 * refusal, so they run as an owner: full access grants everything, which keeps
 * the authority check out of the way of what they actually assert. */
const AS_OWNER: PermissionGrantAuthority = {
  hasFullAccess: true,
  permissions: [],
};

/* A caller holding exactly the permissions listed and nothing else. */
function holding(...perms: readonly string[]): PermissionGrantAuthority {
  return { hasFullAccess: false, permissions: perms };
}

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

/* A database holding exactly one OrganizationRole row (or none), for the plain
 * role-name branch — the only branch that reads an existing grant back. */
function roleRowDb(permissions: readonly string[] | null): DbClient {
  return {
    organizationRole: {
      findFirst: () =>
        Promise.resolve(
          permissions === null
            ? null
            : {
                permission: JSON.stringify(permissionsToStatement(permissions)),
              },
        ),
    },
  } as unknown as DbClient;
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
    await expect(processRole(NO_DB, ORG, "owner", AS_OWNER)).rejects.toThrow(
      RoleEscalationError,
    );
  });

  it("refuses it whatever the casing or padding", async () => {
    await expect(processRole(NO_DB, ORG, "OWNER", AS_OWNER)).rejects.toThrow(
      RoleEscalationError,
    );
    await expect(processRole(NO_DB, ORG, " Owner ", AS_OWNER)).rejects.toThrow(
      RoleEscalationError,
    );
  });

  it("refuses the second owner name the member router protects", async () => {
    await expect(processRole(NO_DB, ORG, "client-owner", AS_OWNER)).rejects.toThrow(
      RoleEscalationError,
    );
  });

  /* The variant a guard written only against the raw input would have missed:
   * the name is decoded and normalized first, and `"Owner"` normalizes to
   * `owner`. This is the encoding the member sheet actually sends for a new
   * named role, so it is the realistic attack shape. */
  it("refuses a named role whose name normalizes to owner", async () => {
    await expect(
      processRole(NO_DB, ORG, `Owner|||${JSON.stringify([LEGAL])}`, AS_OWNER),
    ).rejects.toThrow(RoleEscalationError);
  });

  it("carries the requested role on the error for the audit line", async () => {
    await expect(processRole(NO_DB, ORG, "owner", AS_OWNER)).rejects.toMatchObject({
      name: "RoleEscalationError",
      requestedRole: "owner",
    });
  });
});

describe("processRole — PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED", () => {
  it("refuses an invented permission in a bare array", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify(["billing:pillage"]), AS_OWNER),
    ).rejects.toThrow(UnknownPermissionError);
  });

  it("refuses an invented permission inside a named role", async () => {
    await expect(
      processRole(NO_DB, ORG, `strike-team|||${JSON.stringify(["nope:nope"])}`, AS_OWNER),
    ).rejects.toThrow(UnknownPermissionError);
  });

  it("refuses the array even when only one entry is unknown", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify([LEGAL, "nope:nope"]), AS_OWNER),
    ).rejects.toThrow(UnknownPermissionError);
  });

  it("names the offending permissions on the error", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify(["a:b", "c:d"]), AS_OWNER),
    ).rejects.toMatchObject({
      name: "UnknownPermissionError",
      unknownPermissions: ["a:b", "c:d"],
    });
  });
});

describe("processRole — the legitimate encodings still resolve", () => {
  it("passes a plain role name with no stored row through untouched", async () => {
    /* The plain branch now LOOKS the role up — EVERY_BRANCH_IS_A_GRANT, because
     * naming an existing role hands over whatever that row holds. A name with
     * no row carries nothing, so it still resolves unchanged and the member
     * gains no permissions from it. */
    const db = roleRowDb(null);
    await expect(processRole(db, ORG, "editor", AS_OWNER)).resolves.toBe(
      "editor",
    );
  });

  it("creates a named role with exactly the permissions it was sent", async () => {
    const { db, created } = recordingDb();
    const role = await processRole(
      db,
      ORG,
      `Strike Team|||${JSON.stringify([LEGAL, LEGAL_TWO])}`,
      AS_OWNER,
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
      AS_OWNER,
    );
    /* Reversed — the name is a hash of the SORTED set, so order must not
     * produce a second role row for the same grant. */
    const b = await processRole(
      second.db,
      ORG,
      JSON.stringify([LEGAL_TWO, LEGAL]),
      AS_OWNER,
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
    const role = await processRole(db, ORG, "[not json", AS_OWNER);
    expect(role.startsWith("custom-")).toBe(true);
    expect(created).toHaveLength(1);
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: A_GRANT_CANNOT_EXCEED_THE_GRANTER,
 *   PermissionEscalationError, EVERY_BRANCH_IS_A_GRANT
 *
 * The invariant the RBAC system was missing. `OWNER_IS_NEVER_ASSIGNABLE` stops
 * a caller NAMING the owner role, but assembling owner-equivalent power out of
 * permissions the caller does not hold was unchecked — and the admin preset
 * ships both `invitation:create` and `member:update`, so the escalation needed
 * no unusual access to start from. Each of the three decode branches is a
 * separate grant and is asserted separately: a fix applied to two of three is
 * the shape this bug had in the first place.
 */
describe("processRole — A_GRANT_CANNOT_EXCEED_THE_GRANTER", () => {
  it("refuses a named role carrying a permission the caller lacks", async () => {
    await expect(
      processRole(
        NO_DB,
        ORG,
        `Strike Team|||${JSON.stringify([LEGAL, LEGAL_TWO])}`,
        holding(LEGAL),
      ),
    ).rejects.toThrow(PermissionEscalationError);
  });

  it("refuses a bare custom permission array that over-reaches", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify([LEGAL, LEGAL_TWO]), holding(LEGAL)),
    ).rejects.toThrow(PermissionEscalationError);
  });

  it("refuses assigning an EXISTING role that holds more than the caller", async () => {
    /* The quiet one. No permission is encoded anywhere in the request — the
     * caller just names a role that already carries more than they do, which
     * before this check was waved straight through. */
    await expect(
      processRole(roleRowDb([LEGAL, LEGAL_TWO]), ORG, "finance", holding(LEGAL)),
    ).rejects.toThrow(PermissionEscalationError);
  });

  it("names every permission over-reached for, so the payload is fixable", async () => {
    await expect(
      processRole(NO_DB, ORG, JSON.stringify([LEGAL, LEGAL_TWO]), holding()),
    ).rejects.toMatchObject({
      name: "PermissionEscalationError",
      excessPermissions: [LEGAL, LEGAL_TWO],
    });
  });

  it("allows a grant that exactly matches what the caller holds", async () => {
    const { db, created } = recordingDb();
    await expect(
      processRole(
        db,
        ORG,
        JSON.stringify([LEGAL, LEGAL_TWO]),
        holding(LEGAL, LEGAL_TWO),
      ),
    ).resolves.toMatch(/^custom-/);
    expect(created).toHaveLength(1);
  });

  it("allows an owner to grant anything, despite the empty sentinel array", async () => {
    /* The procedure factory resolves a full-access member's permissions to `[]`
     * deliberately — the gate never reads them. Treating that as "holds
     * nothing" would lock owners out of role management, so `hasFullAccess`
     * has to be consulted BEFORE the list. */
    const { db } = recordingDb();
    await expect(
      processRole(db, ORG, JSON.stringify([LEGAL, LEGAL_TWO]), {
        hasFullAccess: true,
        permissions: [],
      }),
    ).resolves.toMatch(/^custom-/);
  });

  it("reports an unknown permission as unknown, not as over-reach", async () => {
    /* Both faults at once. The registry check runs first, because "that
     * permission does not exist" is the more actionable answer and a
     * non-existent permission cannot meaningfully be held by anyone. */
    await expect(
      processRole(NO_DB, ORG, JSON.stringify(["nope:nope"]), holding()),
    ).rejects.toThrow(UnknownPermissionError);
  });
});
