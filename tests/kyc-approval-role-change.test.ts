/**
 * Verifies the KYC approve → membership role assignment contract.
 *
 * When an admin approves KYC with `assignRole = 'promoter'` or
 * `'customer'`, the `admin_set_kyc_decision` RPC must:
 *   1. Set `role_after` on the primary audit row to the new role.
 *   2. Include `user_roles.role` in `metadata.reviewed_fields`.
 *   3. Emit a discrete secondary `role.assigned_via_kyc` audit row when
 *      the role actually changed (not when it stayed the same).
 *   4. Never allow `assignRole = 'admin'` (privilege escalation guard).
 *
 * Contract source of truth: `public.admin_set_kyc_decision` SQL RPC.
 * TS mirror under test: `src/lib/kyc-audit.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  buildKycAuditEntry,
  buildKycRoleChangeAuditEntry,
  type AppRole,
  type BuildKycAuditInput,
} from "@/lib/kyc-audit";

const ADMIN = { id: "00000000-0000-0000-0000-0000000000a1", email: "admin@arasi.test" };
const TARGET = { id: "00000000-0000-0000-0000-0000000000b2", email: "member@arasi.test" };
const REVIEWED_AT = "2026-07-02T09:15:00.000Z";

function input(overrides: Partial<BuildKycAuditInput> = {}): BuildKycAuditInput {
  return {
    actorId: ADMIN.id,
    actorEmail: ADMIN.email,
    targetUserId: TARGET.id,
    targetEmail: TARGET.email,
    approve: true,
    notes: "Docs verified",
    assignRole: null,
    statusBefore: "pending",
    notesBefore: null,
    roleBefore: "customer",
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

describe.each<AppRole>(["promoter", "customer"])(
  "Approve KYC assigning role = %s",
  (assignRole) => {
    it("updates role_after on the primary audit row", () => {
      const entry = buildKycAuditEntry(
        input({ assignRole, roleBefore: assignRole === "promoter" ? "customer" : "promoter" }),
      );
      expect(entry.action).toBe("kyc.approved");
      expect(entry.role_after).toBe(assignRole);
      expect(entry.metadata.role_assigned).toBe(assignRole);
      expect(entry.metadata.kyc_status_after).toBe("approved");
    });

    it("includes user_roles.role in reviewed_fields", () => {
      const entry = buildKycAuditEntry(
        input({ assignRole, roleBefore: "customer" }),
      );
      expect(entry.metadata.reviewed_fields).toContain("user_roles.role");
      // Base KYC fields must still be present.
      expect(entry.metadata.reviewed_fields).toEqual(
        expect.arrayContaining([
          "kyc_status",
          "kyc_reviewed_at",
          "kyc_reviewed_by",
          "kyc_review_notes",
        ]),
      );
    });

    it("emits a discrete role.assigned_via_kyc row when role actually changes", () => {
      const other: AppRole = assignRole === "promoter" ? "customer" : "promoter";
      const secondary = buildKycRoleChangeAuditEntry(
        input({ assignRole, roleBefore: other }),
      );
      expect(secondary).not.toBeNull();
      expect(secondary!.action).toBe("role.assigned_via_kyc");
      expect(secondary!.role_before).toBe(other);
      expect(secondary!.role_after).toBe(assignRole);
      expect(secondary!.metadata.reviewed_fields).toEqual(["user_roles.role"]);
      expect(secondary!.target_user_id).toBe(TARGET.id);
      expect(secondary!.actor_id).toBe(ADMIN.id);
    });

    it("does NOT emit a role-change row when role is unchanged", () => {
      const secondary = buildKycRoleChangeAuditEntry(
        input({ assignRole, roleBefore: assignRole }),
      );
      expect(secondary).toBeNull();
    });

    it("carries the review notes through as `reason`", () => {
      const entry = buildKycAuditEntry(
        input({ assignRole, notes: "All good — welcome aboard" }),
      );
      expect(entry.reason).toBe("All good — welcome aboard");
      expect(entry.metadata.notes_after).toBe("All good — welcome aboard");
    });
  },
);

describe("Approve KYC — safety guards", () => {
  it("rejects assignRole = 'admin' (privilege escalation)", () => {
    expect(() =>
      buildKycAuditEntry(input({ assignRole: "admin" as AppRole })),
    ).toThrow(/admin role cannot be granted/i);
  });

  it("rejects role assignment when not approving", () => {
    expect(() =>
      buildKycAuditEntry(input({ approve: false, assignRole: "promoter" })),
    ).toThrow(/only be assigned when approving/i);
  });

  it("leaves role_after equal to roleBefore when no role is assigned", () => {
    const entry = buildKycAuditEntry(input({ assignRole: null, roleBefore: "customer" }));
    expect(entry.role_after).toBe("customer");
    expect(entry.metadata.reviewed_fields).not.toContain("user_roles.role");
    expect(buildKycRoleChangeAuditEntry(input({ assignRole: null }))).toBeNull();
  });
});
