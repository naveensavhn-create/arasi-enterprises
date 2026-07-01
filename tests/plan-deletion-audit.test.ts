/**
 * Unit tests for the plan-deletion audit trail contract.
 *
 * These tests lock the shape written into `admin_audit_log` by
 * `deletePlanAudited` (blocked + successful attempts) and the shape read
 * back by `listPlanDeletionAudit` — specifically that the actor,
 * per-status enrollment counts, and blocking/total totals stay correct.
 *
 * Pure functions — no DB required, so this always runs in CI.
 */

import { describe, expect, it } from "vitest";
import {
  buildPlanDeletionAuditEntry,
  computeDeletionCounts,
  mapPlanDeletionAuditRow,
} from "@/lib/plan-deletion-audit";

const actor = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@arasi.test",
};
const plan = { id: "11111111-1111-1111-1111-111111111111", name: "Gold Plan", is_active: true };

describe("computeDeletionCounts", () => {
  it("derives blocking = pending + active and total = sum of all four buckets", () => {
    expect(computeDeletionCounts({ pending: 2, active: 3, cancelled: 4, completed: 5 })).toEqual({
      pending: 2, active: 3, cancelled: 4, completed: 5, blocking: 5, total: 14,
    });
  });

  it("clamps negatives and non-integers to safe values", () => {
    expect(computeDeletionCounts({ pending: -1, active: 1.9, cancelled: 0, completed: 0 })).toEqual({
      pending: 0, active: 1, cancelled: 0, completed: 0, blocking: 1, total: 1,
    });
  });
});

describe("buildPlanDeletionAuditEntry — successful delete", () => {
  const counts = computeDeletionCounts({ pending: 0, active: 0, cancelled: 2, completed: 1 });
  const entry = buildPlanDeletionAuditEntry({
    actorId: actor.id,
    actorEmail: actor.email,
    plan,
    counts,
    deleteError: null,
  });

  it("uses the plan_delete_success action", () => {
    expect(entry.action).toBe("plan_delete_success");
  });

  it("records the actor id + email as both actor and self-target", () => {
    expect(entry.actor_id).toBe(actor.id);
    expect(entry.actor_email).toBe(actor.email);
    expect(entry.target_user_id).toBe(actor.id);
    expect(entry.target_email).toBe(actor.email);
  });

  it("nulls out db_error and preserves the full count breakdown", () => {
    expect(entry.metadata.db_error).toBeNull();
    expect(entry.metadata.counts).toEqual({
      pending: 0, active: 0, cancelled: 2, completed: 1, blocking: 0, total: 3,
    });
  });

  it("snapshots plan_id, plan_name, and plan_was_active", () => {
    expect(entry.metadata.plan_id).toBe(plan.id);
    expect(entry.metadata.plan_name).toBe(plan.name);
    expect(entry.metadata.plan_was_active).toBe(true);
  });
});

describe("buildPlanDeletionAuditEntry — blocked delete", () => {
  const counts = computeDeletionCounts({ pending: 3, active: 2, cancelled: 4, completed: 1 });
  const entry = buildPlanDeletionAuditEntry({
    actorId: actor.id,
    actorEmail: actor.email,
    plan,
    counts,
    deleteError: {
      message: "Cannot delete plan: 5 active enrollment(s) still reference this plan.",
      code: "23503",
      details: null,
    },
  });

  it("uses the plan_delete_blocked action", () => {
    expect(entry.action).toBe("plan_delete_blocked");
  });

  it("stores blocking = pending + active and the trigger's error message + code", () => {
    expect(entry.metadata.counts.blocking).toBe(5);
    expect(entry.metadata.counts.total).toBe(10);
    expect(entry.metadata.db_error).toEqual({
      message: "Cannot delete plan: 5 active enrollment(s) still reference this plan.",
      code: "23503",
      details: null,
    });
  });

  it("still records the correct actor", () => {
    expect(entry.actor_id).toBe(actor.id);
    expect(entry.actor_email).toBe(actor.email);
  });

  it("keeps action name and db_error in sync — presence of an error forces blocked", () => {
    const inconsistent = buildPlanDeletionAuditEntry({
      actorId: actor.id,
      actorEmail: null,
      plan,
      counts,
      deleteError: { message: "boom", code: null, details: null },
    });
    expect(inconsistent.action).toBe("plan_delete_blocked");
    expect(inconsistent.metadata.db_error?.message).toBe("boom");
  });

  it("tolerates a null actor email", () => {
    const anon = buildPlanDeletionAuditEntry({
      actorId: actor.id,
      actorEmail: null,
      plan,
      counts,
      deleteError: null,
    });
    expect(anon.actor_email).toBeNull();
    expect(anon.target_email).toBeNull();
  });
});

describe("mapPlanDeletionAuditRow — read path parity", () => {
  it("round-trips a blocked entry back into the view model", () => {
    const counts = computeDeletionCounts({ pending: 1, active: 1, cancelled: 0, completed: 0 });
    const entry = buildPlanDeletionAuditEntry({
      actorId: actor.id,
      actorEmail: actor.email,
      plan,
      counts,
      deleteError: { message: "blocked!", code: "23503", details: null },
    });

    const view = mapPlanDeletionAuditRow({
      id: "audit-1",
      created_at: "2026-01-15T10:00:00Z",
      action: entry.action,
      actor_id: entry.actor_id,
      actor_email: entry.actor_email,
      metadata: entry.metadata,
    });

    expect(view).toMatchObject({
      action: "plan_delete_blocked",
      actor_id: actor.id,
      actor_email: actor.email,
      plan_id: plan.id,
      plan_name: plan.name,
      error_message: "blocked!",
      counts: { pending: 1, active: 1, cancelled: 0, completed: 0, blocking: 2, total: 2 },
    });
  });

  it("round-trips a successful entry with no error_message", () => {
    const counts = computeDeletionCounts({ pending: 0, active: 0, cancelled: 3, completed: 2 });
    const entry = buildPlanDeletionAuditEntry({
      actorId: actor.id,
      actorEmail: actor.email,
      plan,
      counts,
      deleteError: null,
    });

    const view = mapPlanDeletionAuditRow({
      id: "audit-2",
      created_at: "2026-01-15T11:00:00Z",
      action: entry.action,
      actor_id: entry.actor_id,
      actor_email: entry.actor_email,
      metadata: entry.metadata,
    });

    expect(view.action).toBe("plan_delete_success");
    expect(view.error_message).toBeNull();
    expect(view.counts).toEqual({
      pending: 0, active: 0, cancelled: 3, completed: 2, blocking: 0, total: 5,
    });
  });

  it("defaults missing metadata counts to zero without throwing", () => {
    const view = mapPlanDeletionAuditRow({
      id: "audit-3",
      created_at: "2026-01-15T12:00:00Z",
      action: "plan_delete_success",
      actor_id: actor.id,
      actor_email: null,
      metadata: { plan_id: plan.id, plan_name: plan.name },
    });
    expect(view.counts).toEqual({
      pending: 0, active: 0, cancelled: 0, completed: 0, blocking: 0, total: 0,
    });
    expect(view.actor_email).toBeNull();
    expect(view.error_message).toBeNull();
  });
});
