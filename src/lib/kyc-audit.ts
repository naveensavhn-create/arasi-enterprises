/**
 * Pure helpers that mirror the `admin_audit_log` contract written by the
 * `public.admin_set_kyc_decision` SQL RPC. Used both by tests (to lock the
 * shape) and by any future TypeScript reader that needs to interpret KYC
 * audit rows without duplicating the SQL logic.
 *
 * The SQL RPC is the source of truth; if that RPC changes, update this
 * file AND the `tests/kyc-audit.test.ts` tests in the same commit.
 */

export type KycStatus = "unsubmitted" | "pending" | "approved" | "rejected";
export type AppRole = "admin" | "promoter" | "customer";

export type KycAuditAction =
  | "kyc.approved"
  | "kyc.rejected"
  | "kyc.submitted_by_promoter"
  | "role.assigned_via_kyc";

export interface KycAuditMetadata {
  kyc_status_before: KycStatus | null;
  kyc_status_after: KycStatus;
  notes_before: string | null;
  notes_after: string | null;
  role_assigned: AppRole | null;
  reviewed_fields: string[];
  reviewed_at: string; // ISO timestamp
}

export interface KycAuditEntry {
  action: KycAuditAction;
  actor_id: string;
  actor_email: string | null;
  target_user_id: string;
  target_email: string | null;
  role_before: AppRole | null;
  role_after: AppRole | null;
  reason: string | null;
  metadata: KycAuditMetadata;
}

export interface BuildKycAuditInput {
  actorId: string;
  actorEmail: string | null;
  targetUserId: string;
  targetEmail: string | null;
  approve: boolean;
  notes: string | null;
  assignRole: AppRole | null;
  statusBefore: KycStatus | null;
  notesBefore: string | null;
  roleBefore: AppRole | null;
  reviewedAt: string; // ISO timestamp, controlled by caller for deterministic tests
}

const BASE_FIELDS = [
  "kyc_status",
  "kyc_reviewed_at",
  "kyc_reviewed_by",
  "kyc_review_notes",
] as const;

/**
 * Build the primary `kyc.approved` / `kyc.rejected` audit row.
 *
 * SQL invariants enforced here:
 *  - `assignRole=admin` is rejected (privilege escalation guard).
 *  - `assignRole` is only allowed when approving.
 *  - `reviewed_fields` appends `user_roles.role` iff a role is being
 *    reassigned during approval.
 */
export function buildKycAuditEntry(input: BuildKycAuditInput): KycAuditEntry {
  if (input.assignRole && (input.assignRole as string) === "admin") {
    throw new Error("Admin role cannot be granted through KYC approval");
  }
  if (input.assignRole && !input.approve) {
    throw new Error("Role can only be assigned when approving KYC");
  }

  const roleWillChange = Boolean(input.approve && input.assignRole);
  const roleAfter: AppRole | null = roleWillChange
    ? (input.assignRole as AppRole)
    : input.roleBefore;

  const reviewedFields: string[] = roleWillChange
    ? [...BASE_FIELDS, "user_roles.role"]
    : [...BASE_FIELDS];

  const statusAfter: KycStatus = input.approve ? "approved" : "rejected";

  return {
    action: input.approve ? "kyc.approved" : "kyc.rejected",
    actor_id: input.actorId,
    actor_email: input.actorEmail,
    target_user_id: input.targetUserId,
    target_email: input.targetEmail,
    role_before: input.roleBefore,
    role_after: roleAfter,
    reason: input.notes,
    metadata: {
      kyc_status_before: input.statusBefore,
      kyc_status_after: statusAfter,
      notes_before: input.notesBefore,
      notes_after: input.notes,
      role_assigned: input.assignRole,
      reviewed_fields: reviewedFields,
      reviewed_at: input.reviewedAt,
    },
  };
}

/**
 * Secondary audit row emitted by the RPC when an approval also flips a role.
 * Returns `null` when no discrete role-change row should be written.
 */
export function buildKycRoleChangeAuditEntry(
  input: BuildKycAuditInput,
): KycAuditEntry | null {
  const roleWillChange = Boolean(
    input.approve && input.assignRole && input.assignRole !== input.roleBefore,
  );
  if (!roleWillChange) return null;
  return {
    action: "role.assigned_via_kyc",
    actor_id: input.actorId,
    actor_email: input.actorEmail,
    target_user_id: input.targetUserId,
    target_email: input.targetEmail,
    role_before: input.roleBefore,
    role_after: input.assignRole as AppRole,
    reason: input.notes,
    metadata: {
      kyc_status_before: input.statusBefore,
      kyc_status_after: "approved",
      notes_before: input.notesBefore,
      notes_after: input.notes,
      role_assigned: input.assignRole,
      reviewed_fields: ["user_roles.role"],
      reviewed_at: input.reviewedAt,
    },
  };
}

/**
 * The `reviewed_at` metadata must be a valid ISO timestamp within a small
 * clock-skew window of "now"; used by tests to assert timestamp correctness.
 */
export function isRecentIsoTimestamp(
  value: string,
  now: number = Date.now(),
  toleranceMs: number = 5_000,
): boolean {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return Math.abs(now - t) <= toleranceMs;
}
