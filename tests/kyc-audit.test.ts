/**
 * Integration tests for the KYC review audit-log contract.
 *
 * Locks the exact shape of rows written into `admin_audit_log` by the
 * `public.admin_set_kyc_decision` SQL RPC for the three review actions the
 * admin UI can trigger:
 *   1. Approve a submission (no role change)
 *   2. Reject a submission
 *   3. Update / re-review a submission (approve with role reassignment,
 *      and re-decide an already-decided user)
 *
 * The RPC is the source of truth; `src/lib/kyc-audit.ts` mirrors the same
 * logic in TypeScript so these tests can run without a live database while
 * still catching contract drift (actor id/email, timestamps, before/after
 * status + role, reviewed_fields, discrete role-change row).
 */

import { describe, expect, it } from "vitest";
import {
  buildKycAuditEntry,
  buildKycRoleChangeAuditEntry,
  isRecentIsoTimestamp,
  type BuildKycAuditInput,
} from "@/lib/kyc-audit";

const ADMIN = {
  id: "00000000-0000-0000-0000-0000000000a1",
  email: "admin@arasi.test",
};
const TARGET = {
  id: "00000000-0000-0000-0000-0000000000b2",
  email: "customer@arasi.test",
};

function baseInput(overrides: Partial<BuildKycAuditInput> = {}): BuildKycAuditInput {
  return {
    actorId: ADMIN.id,
    actorEmail: ADMIN.email,
    targetUserId: TARGET.id,
    targetEmail: TARGET.email,
    approve: true,
    notes: null,
    assignRole: null,
    statusBefore: "pending",
    notesBefore: null,
    roleBefore: "customer",
    reviewedAt: "2026-07-02T09:15:00.000Z",
    ...overrides,
  };
}

describe("KYC approve → audit row", () => {
  const entry = buildKycAuditEntry(
    baseInput({ approve: true, notes: "Docs verified" }),
  );

  it("uses action=kyc.approved", () => {
    expect(entry.action).toBe("kyc.approved");
  });

  it("records the admin as the actor with id + email", () => {
    expect(entry.actor_id).toBe(ADMIN.id);
    expect(entry.actor_email).toBe(ADMIN.email);
  });

  it("records the target user and email separately from the actor", () => {
    expect(entry.target_user_id).toBe(TARGET.id);
    expect(entry.target_email).toBe(TARGET.email);
    expect(entry.target_user_id).not.toBe(entry.actor_id);
  });

  it("stamps a reviewed_at timestamp equal to the RPC clock", () => {
    expect(entry.metadata.reviewed_at).toBe("2026-07-02T09:15:00.000Z");
    expect(isRecentIsoTimestamp(entry.metadata.reviewed_at, Date.parse(entry.metadata.reviewed_at))).toBe(true);
  });

  it("captures kyc_status_before → kyc_status_after transition", () => {
    expect(entry.metadata.kyc_status_before).toBe("pending");
    expect(entry.metadata.kyc_status_after).toBe("approved");
  });

  it("propagates the admin's notes into reason + metadata.notes_after", () => {
    expect(entry.reason).toBe("Docs verified");
    expect(entry.metadata.notes_after).toBe("Docs verified");
    expect(entry.metadata.notes_before).toBeNull();
  });

  it("leaves role unchanged when no role is assigned", () => {
    expect(entry.role_before).toBe("customer");
    expect(entry.role_after).toBe("customer");
    expect(entry.metadata.role_assigned).toBeNull();
    expect(entry.metadata.reviewed_fields).toEqual([
      "kyc_status",
      "kyc_reviewed_at",
      "kyc_reviewed_by",
      "kyc_review_notes",
    ]);
  });

  it("does not emit a secondary role-change row", () => {
    expect(buildKycRoleChangeAuditEntry(baseInput({ approve: true }))).toBeNull();
  });
});

describe("KYC reject → audit row", () => {
  const entry = buildKycAuditEntry(
    baseInput({ approve: false, notes: "Aadhaar mismatch" }),
  );

  it("uses action=kyc.rejected and status_after=rejected", () => {
    expect(entry.action).toBe("kyc.rejected");
    expect(entry.metadata.kyc_status_after).toBe("rejected");
    expect(entry.metadata.kyc_status_before).toBe("pending");
  });

  it("still records the acting admin and target separately", () => {
    expect(entry.actor_id).toBe(ADMIN.id);
    expect(entry.actor_email).toBe(ADMIN.email);
    expect(entry.target_user_id).toBe(TARGET.id);
    expect(entry.target_email).toBe(TARGET.email);
  });

  it("keeps rejection notes in reason + metadata", () => {
    expect(entry.reason).toBe("Aadhaar mismatch");
    expect(entry.metadata.notes_after).toBe("Aadhaar mismatch");
  });

  it("refuses to attach a role assignment to a rejection", () => {
    expect(() =>
      buildKycAuditEntry(
        baseInput({ approve: false, assignRole: "promoter" }),
      ),
    ).toThrow(/only be assigned when approving/i);
  });

  it("does not emit a discrete role-change entry", () => {
    expect(
      buildKycRoleChangeAuditEntry(baseInput({ approve: false })),
    ).toBeNull();
  });
});

describe("KYC update → re-review + role reassignment", () => {
  it("re-decides an already-approved user and captures the prior status", () => {
    const entry = buildKycAuditEntry(
      baseInput({
        approve: false,
        statusBefore: "approved",
        notesBefore: "Approved on first pass",
        notes: "Revoked: address mismatch found later",
      }),
    );
    expect(entry.action).toBe("kyc.rejected");
    expect(entry.metadata.kyc_status_before).toBe("approved");
    expect(entry.metadata.kyc_status_after).toBe("rejected");
    expect(entry.metadata.notes_before).toBe("Approved on first pass");
    expect(entry.metadata.notes_after).toBe("Revoked: address mismatch found later");
  });

  it("promotes a customer to promoter on approval and lists user_roles.role in reviewed_fields", () => {
    const entry = buildKycAuditEntry(
      baseInput({ approve: true, assignRole: "promoter", roleBefore: "customer" }),
    );
    expect(entry.action).toBe("kyc.approved");
    expect(entry.role_before).toBe("customer");
    expect(entry.role_after).toBe("promoter");
    expect(entry.metadata.role_assigned).toBe("promoter");
    expect(entry.metadata.reviewed_fields).toContain("user_roles.role");
    expect(entry.metadata.reviewed_fields).toEqual([
      "kyc_status",
      "kyc_reviewed_at",
      "kyc_reviewed_by",
      "kyc_review_notes",
      "user_roles.role",
    ]);
  });

  it("emits a secondary role.assigned_via_kyc audit row alongside the kyc.approved row", () => {
    const input = baseInput({
      approve: true,
      assignRole: "promoter",
      roleBefore: "customer",
      notes: "Verified + upgrading",
    });
    const primary = buildKycAuditEntry(input);
    const secondary = buildKycRoleChangeAuditEntry(input);

    expect(primary.action).toBe("kyc.approved");
    expect(secondary).not.toBeNull();
    expect(secondary!.action).toBe("role.assigned_via_kyc");

    // Both rows share actor + target + timestamp for correlation.
    expect(secondary!.actor_id).toBe(primary.actor_id);
    expect(secondary!.actor_email).toBe(primary.actor_email);
    expect(secondary!.target_user_id).toBe(primary.target_user_id);
    expect(secondary!.metadata.reviewed_at).toBe(primary.metadata.reviewed_at);

    // But the role-change row focuses on the role transition.
    expect(secondary!.role_before).toBe("customer");
    expect(secondary!.role_after).toBe("promoter");
    expect(secondary!.metadata.reviewed_fields).toEqual(["user_roles.role"]);
  });

  it("does not emit a role-change row when the assigned role equals the current role", () => {
    const input = baseInput({
      approve: true,
      assignRole: "customer",
      roleBefore: "customer",
    });
    expect(buildKycRoleChangeAuditEntry(input)).toBeNull();
  });

  it("rejects attempts to grant the admin role through KYC approval", () => {
    expect(() =>
      buildKycAuditEntry(
        baseInput({ approve: true, assignRole: "admin" as never }),
      ),
    ).toThrow(/admin role cannot be granted/i);
  });
});

describe("KYC audit timestamp helper", () => {
  it("accepts a fresh ISO timestamp within tolerance", () => {
    const now = Date.now();
    expect(isRecentIsoTimestamp(new Date(now).toISOString(), now)).toBe(true);
    expect(isRecentIsoTimestamp(new Date(now - 1_000).toISOString(), now)).toBe(true);
  });

  it("rejects stale timestamps outside tolerance", () => {
    const now = Date.now();
    expect(isRecentIsoTimestamp(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });

  it("rejects non-ISO or unparseable input", () => {
    expect(isRecentIsoTimestamp("not-a-date", Date.now())).toBe(false);
  });
});
