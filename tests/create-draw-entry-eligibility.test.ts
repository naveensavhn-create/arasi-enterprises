// @vitest-environment node
/**
 * Integration tests: `createDrawEntry` eligibility gate.
 *
 * Contract this pins:
 *   1. Malformed input (missing/invalid drawId, bad membershipId) throws
 *      `DrawEntryError` with `code: "INVALID_INPUT"`, `status: 400`, and
 *      NEVER touches the database.
 *   2. Server-side pre-flight rejects the following BEFORE any INSERT is
 *      attempted, each with `code: "INVALID_ELIGIBILITY"`, `status: 400`,
 *      and a machine-readable `reason`:
 *        • DRAW_NOT_FOUND      — draw id does not exist
 *        • DRAW_CLOSED         — draw.status is closed/completed/cancelled
 *        • DRAW_NOT_OPEN_YET   — draw.opens_at is in the future
 *        • DRAW_ENTRIES_CLOSED — draw.closes_at is in the past
 *        • NO_ACTIVE_MEMBERSHIP — requires_active_membership, none held
 *        • PLAN_NOT_ELIGIBLE    — plan_id set, no active membership on it
 *
 * The "no INSERT before rejection" guarantee is proven with a spy on the
 * mocked supabase client: `insert()` must never be called in the failure
 * cases. A final positive-path test proves the same builder DOES reach
 * `insert()` when input + eligibility are valid — otherwise a broken mock
 * could make every test trivially pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDrawEntryHandler,
  DrawEntryError,
} from "@/lib/draws.functions";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const DRAW_ID = "22222222-2222-2222-2222-222222222222";
const PLAN_ID = "33333333-3333-3333-3333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-4444-444444444444";

type Row = Record<string, unknown> | null;
type Result = { data: Row; error: { code?: string; message?: string } | null };

/**
 * Build a chainable PostgREST-like query object whose terminal `.maybeSingle`
 * / `.single` / awaited resolution returns the given `Result`. Every builder
 * method is a `vi.fn()` so the test can assert exact call sequences.
 */
function makeQuery(result: Result) {
  const q: any = {};
  const chain = () => q;
  q.select = vi.fn(chain);
  q.eq = vi.fn(chain);
  q.in = vi.fn(chain);
  q.order = vi.fn(chain);
  q.limit = vi.fn(chain);
  q.maybeSingle = vi.fn(() => Promise.resolve(result));
  q.single = vi.fn(() => Promise.resolve(result));
  q.then = (resolve: (r: Result) => void) => resolve(result);
  return q;
}

type TableResults = {
  draw_entries_existing?: Result; // idempotency lookup
  draws?: Result;                  // pre-flight draw fetch
  memberships?: Result;            // membership/plan check
  draw_entries_insert?: Result;    // final INSERT (should never fire in fail cases)
};

function makeSupabase(tables: TableResults) {
  const insertSpy = vi.fn(() =>
    makeQuery(tables.draw_entries_insert ?? { data: null, error: null }),
  );
  const drawEntriesSelectQueue: Result[] = [
    tables.draw_entries_existing ?? { data: null, error: null },
  ];

  const from = vi.fn((table: string) => {
    if (table === "draws") {
      return makeQuery(tables.draws ?? { data: null, error: null });
    }
    if (table === "memberships") {
      return makeQuery(tables.memberships ?? { data: null, error: null });
    }
    if (table === "draw_entries") {
      // A single object exposes both `.select` (idempotency lookup) and
      // `.insert` (final write). We hand out the queued select result and
      // count inserts separately via `insertSpy`.
      const selectResult =
        drawEntriesSelectQueue.shift() ?? { data: null, error: null };
      const selectQuery = makeQuery(selectResult);
      return {
        ...selectQuery,
        insert: insertSpy,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: { from } as const,
    from,
    insertSpy,
  };
}

function ctx(supa: { from: (t: string) => any }) {
  return { supabase: supa, userId: USER_ID };
}

async function expectDrawEntryError(
  promise: Promise<unknown>,
  code: "INVALID_INPUT" | "INVALID_ELIGIBILITY",
  reason?: string,
) {
  const err = await promise.then(
    () => {
      throw new Error("Expected DrawEntryError, got success");
    },
    (e: unknown) => e as unknown,
  );
  expect(err).toBeInstanceOf(DrawEntryError);
  const de = err as DrawEntryError;
  expect(de.code).toBe(code);
  expect(de.status).toBe(400);
  if (reason) expect(de.reason).toBe(reason);
  expect(de.toJSON()).toMatchObject({
    ok: false,
    error: code,
    ...(reason ? { reason } : {}),
  });
  return de;
}

// ---------------------------------------------------------------------------
// INVALID_INPUT — never touches the database
// ---------------------------------------------------------------------------
describe("createDrawEntry — INVALID_INPUT", () => {
  let supa: ReturnType<typeof makeSupabase>;
  beforeEach(() => {
    supa = makeSupabase({});
  });

  it("rejects missing drawId with 400 INVALID_INPUT before any DB call", async () => {
    await expectDrawEntryError(
      createDrawEntryHandler({}, ctx(supa.client)),
      "INVALID_INPUT",
      "SCHEMA_VALIDATION_FAILED",
    );
    expect(supa.from).not.toHaveBeenCalled();
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID drawId with INVALID_INPUT", async () => {
    await expectDrawEntryError(
      createDrawEntryHandler(
        { drawId: "not-a-uuid" },
        ctx(supa.client),
      ),
      "INVALID_INPUT",
    );
    expect(supa.from).not.toHaveBeenCalled();
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID membershipId with INVALID_INPUT", async () => {
    await expectDrawEntryError(
      createDrawEntryHandler(
        { drawId: DRAW_ID, membershipId: "nope" },
        ctx(supa.client),
      ),
      "INVALID_INPUT",
    );
    expect(supa.from).not.toHaveBeenCalled();
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects null / non-object input with INVALID_INPUT", async () => {
    await expectDrawEntryError(
      createDrawEntryHandler(null, ctx(supa.client)),
      "INVALID_INPUT",
    );
    expect(supa.from).not.toHaveBeenCalled();
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// INVALID_ELIGIBILITY — pre-flight rejects, INSERT never fires
// ---------------------------------------------------------------------------
describe("createDrawEntry — INVALID_ELIGIBILITY (no INSERT before rejection)", () => {
  it("rejects DRAW_NOT_FOUND when the draw id doesn't exist", async () => {
    const supa = makeSupabase({
      draws: { data: null, error: null }, // maybeSingle → null
    });
    await expectDrawEntryError(
      createDrawEntryHandler({ drawId: DRAW_ID }, ctx(supa.client)),
      "INVALID_ELIGIBILITY",
      "DRAW_NOT_FOUND",
    );
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects DRAW_CLOSED when draw.status is not scheduled/open", async () => {
    for (const status of ["closed", "completed", "cancelled"] as const) {
      const supa = makeSupabase({
        draws: {
          data: {
            id: DRAW_ID,
            status,
            opens_at: null,
            closes_at: null,
            requires_active_membership: false,
            plan_id: null,
          },
          error: null,
        },
      });
      const err = await expectDrawEntryError(
        createDrawEntryHandler({ drawId: DRAW_ID }, ctx(supa.client)),
        "INVALID_ELIGIBILITY",
        "DRAW_CLOSED",
      );
      expect(err.details).toMatchObject({ status });
      expect(supa.insertSpy).not.toHaveBeenCalled();
    }
  });

  it("rejects DRAW_NOT_OPEN_YET when opens_at is in the future", async () => {
    const supa = makeSupabase({
      draws: {
        data: {
          id: DRAW_ID,
          status: "scheduled",
          opens_at: new Date(Date.now() + 60_000).toISOString(),
          closes_at: null,
          requires_active_membership: false,
          plan_id: null,
        },
        error: null,
      },
    });
    await expectDrawEntryError(
      createDrawEntryHandler({ drawId: DRAW_ID }, ctx(supa.client)),
      "INVALID_ELIGIBILITY",
      "DRAW_NOT_OPEN_YET",
    );
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects DRAW_ENTRIES_CLOSED when closes_at is in the past", async () => {
    const supa = makeSupabase({
      draws: {
        data: {
          id: DRAW_ID,
          status: "open",
          opens_at: null,
          closes_at: new Date(Date.now() - 60_000).toISOString(),
          requires_active_membership: false,
          plan_id: null,
        },
        error: null,
      },
    });
    await expectDrawEntryError(
      createDrawEntryHandler({ drawId: DRAW_ID }, ctx(supa.client)),
      "INVALID_ELIGIBILITY",
      "DRAW_ENTRIES_CLOSED",
    );
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects NO_ACTIVE_MEMBERSHIP when the draw requires one and the user has none", async () => {
    const supa = makeSupabase({
      draws: {
        data: {
          id: DRAW_ID,
          status: "open",
          opens_at: null,
          closes_at: null,
          requires_active_membership: true,
          plan_id: null,
        },
        error: null,
      },
      memberships: { data: null, error: null },
    });
    await expectDrawEntryError(
      createDrawEntryHandler({ drawId: DRAW_ID }, ctx(supa.client)),
      "INVALID_ELIGIBILITY",
      "NO_ACTIVE_MEMBERSHIP",
    );
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects PLAN_NOT_ELIGIBLE when the draw is gated to a plan the user isn't on", async () => {
    const supa = makeSupabase({
      draws: {
        data: {
          id: DRAW_ID,
          status: "open",
          opens_at: null,
          closes_at: null,
          requires_active_membership: true,
          plan_id: PLAN_ID, // gated
        },
        error: null,
      },
      // No active membership row matches (user isn't on PLAN_ID).
      memberships: { data: null, error: null },
    });
    const err = await expectDrawEntryError(
      createDrawEntryHandler({ drawId: DRAW_ID }, ctx(supa.client)),
      "INVALID_ELIGIBILITY",
      "PLAN_NOT_ELIGIBLE",
    );
    expect(err.details).toMatchObject({ required_plan_id: PLAN_ID });
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("rejects MEMBERSHIP_NOT_ELIGIBLE when a specific membershipId is supplied but doesn't match", async () => {
    const supa = makeSupabase({
      draws: {
        data: {
          id: DRAW_ID,
          status: "open",
          opens_at: null,
          closes_at: null,
          requires_active_membership: false,
          plan_id: PLAN_ID,
        },
        error: null,
      },
      memberships: { data: null, error: null },
    });
    await expectDrawEntryError(
      createDrawEntryHandler(
        { drawId: DRAW_ID, membershipId: MEMBERSHIP_ID },
        ctx(supa.client),
      ),
      "INVALID_ELIGIBILITY",
      "MEMBERSHIP_NOT_ELIGIBLE",
    );
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency + positive path (control: proves INSERT can fire when valid)
// ---------------------------------------------------------------------------
describe("createDrawEntry — idempotency & positive path", () => {
  it("returns the existing entry without INSERTing when one already exists", async () => {
    const existing = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      draw_id: DRAW_ID,
      customer_id: USER_ID,
      membership_id: null,
      entry_number: 7,
      eligible: true,
      created_at: new Date().toISOString(),
    };
    const supa = makeSupabase({
      draw_entries_existing: { data: existing, error: null },
    });
    const row = await createDrawEntryHandler(
      { drawId: DRAW_ID },
      ctx(supa.client),
    );
    expect(row).toEqual(existing);
    expect(supa.insertSpy).not.toHaveBeenCalled();
  });

  it("proceeds to INSERT and returns the new row when eligibility passes", async () => {
    const inserted = {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      draw_id: DRAW_ID,
      customer_id: USER_ID,
      membership_id: null,
      entry_number: 42,
      eligible: true,
      created_at: new Date().toISOString(),
    };
    const supa = makeSupabase({
      draws: {
        data: {
          id: DRAW_ID,
          status: "open",
          opens_at: null,
          closes_at: null,
          requires_active_membership: false,
          plan_id: null,
        },
        error: null,
      },
      draw_entries_insert: { data: inserted, error: null },
    });
    const row = await createDrawEntryHandler(
      { drawId: DRAW_ID },
      ctx(supa.client),
    );
    expect(row).toEqual(inserted);
    // Control assertion: INSERT MUST fire when eligibility passes — otherwise
    // the "no INSERT before rejection" assertions above would be vacuous.
    expect(supa.insertSpy).toHaveBeenCalledTimes(1);
    expect(supa.insertSpy).toHaveBeenCalledWith({
      draw_id: DRAW_ID,
      customer_id: USER_ID,
      membership_id: null,
    });
  });
});
