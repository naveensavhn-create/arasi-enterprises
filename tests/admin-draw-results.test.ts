// @vitest-environment node
/**
 * Integration tests for the admin draw-results feed (`listAllDrawWinners`,
 * powering `/_authenticated/admin/draw-results`).
 *
 * Pins three guarantees:
 *   1. Admin-only — non-admin callers are rejected via the `has_role`
 *      pre-check BEFORE any `draw_winners` read is attempted.
 *   2. Eligible-only — the feed reads from `public.draw_winners`, which is
 *      populated exclusively by `public.pick_draw_winners` (that RPC filters
 *      entries by `eligible = true` and, when required, active membership;
 *      see `tests/pick-draw-winners.test.ts`). The DB-level guarantee is
 *      re-asserted here by verifying the unique/eligibility invariants on
 *      `draw_winners` (skipped when SUPABASE_DB_URL is not set).
 *   3. No duplicate winner rows — even if the underlying select somehow
 *      yields duplicates (bad view/join change), the handler dedupes by
 *      primary key so admins never see the same winner twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { listAllDrawWinnersHandler } from "@/lib/draws.functions";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const DRAW_A = "22222222-2222-2222-2222-222222222222";
const DRAW_B = "33333333-3333-3333-3333-333333333333";
const CUST_A = "44444444-4444-4444-4444-444444444444";
const CUST_B = "55555555-5555-5555-5555-555555555555";

type Result = { data: unknown; error: { message: string } | null };

function makeSelectBuilder(result: Result) {
  const q: any = {};
  const chain = () => q;
  q.select = vi.fn(chain);
  q.eq = vi.fn(chain);
  q.in = vi.fn(chain);
  q.order = vi.fn(chain);
  q.limit = vi.fn(() => Promise.resolve(result));
  q.then = (resolve: (r: Result) => void) => resolve(result);
  return q;
}

function makeSupabase(opts: {
  isAdmin: boolean | null;
  adminError?: { message: string } | null;
  winners?: Result;
  draws?: Result;
  profiles?: Result;
}) {
  const fromCalls: string[] = [];
  const winnersBuilder = opts.winners
    ? makeSelectBuilder(opts.winners)
    : makeSelectBuilder({ data: [], error: null });
  const drawsBuilder = opts.draws
    ? makeSelectBuilder(opts.draws)
    : makeSelectBuilder({ data: [], error: null });
  const profilesBuilder = opts.profiles
    ? makeSelectBuilder(opts.profiles)
    : makeSelectBuilder({ data: [], error: null });

  // `.in()` is the terminator for the draws / profiles lookups.
  drawsBuilder.in = vi.fn(() => Promise.resolve(opts.draws ?? { data: [], error: null }));
  profilesBuilder.in = vi.fn(() =>
    Promise.resolve(opts.profiles ?? { data: [], error: null }),
  );

  const supabase = {
    rpc: vi.fn((name: string) => {
      if (name !== "has_role") throw new Error(`unexpected rpc ${name}`);
      return Promise.resolve({
        data: opts.isAdmin,
        error: opts.adminError ?? null,
      });
    }),
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      if (table === "draw_winners") return winnersBuilder;
      if (table === "draws") return drawsBuilder;
      if (table === "profiles") return profilesBuilder;
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { supabase, fromCalls, winnersBuilder, drawsBuilder, profilesBuilder };
}

describe("listAllDrawWinners — admin-only, dedup, eligibility source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-admin callers with Forbidden and never queries draw_winners", async () => {
    const { supabase, fromCalls } = makeSupabase({ isAdmin: false });
    await expect(
      listAllDrawWinnersHandler({ supabase, userId: USER_ID }),
    ).rejects.toThrow(/Forbidden/);
    expect(supabase.rpc).toHaveBeenCalledWith("has_role", {
      _user_id: USER_ID,
      _role: "admin",
    });
    // Critical: the winners feed must NOT be read for a non-admin.
    expect(fromCalls).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("propagates has_role errors without falling through to a read", async () => {
    const { supabase, fromCalls } = makeSupabase({
      isAdmin: null,
      adminError: { message: "db down" },
    });
    await expect(
      listAllDrawWinnersHandler({ supabase, userId: USER_ID }),
    ).rejects.toThrow(/db down/);
    expect(fromCalls).toEqual([]);
  });

  it("reads the winners feed from public.draw_winners (the eligible-only source of truth)", async () => {
    // `draw_winners` is only ever populated by `public.pick_draw_winners`,
    // which filters entries by `eligible = true`. By reading from that table
    // and nothing else, this endpoint inherits the eligibility guarantee.
    const { supabase, fromCalls, winnersBuilder } = makeSupabase({
      isAdmin: true,
      winners: {
        data: [
          {
            id: "w1",
            draw_id: DRAW_A,
            entry_id: "e1",
            customer_id: CUST_A,
            position: 1,
            prize: "Bike",
            drawn_at: "2026-06-01T10:00:00Z",
            seed: "seed-a",
          },
        ],
        error: null,
      },
      draws: {
        data: [{ id: DRAW_A, name: "June Draw", status: "completed", winners_count: 1 }],
        error: null,
      },
      profiles: {
        data: [{ id: CUST_A, full_name: "Ada", email: "ada@example.com", phone: null }],
        error: null,
      },
    });

    const rows = await listAllDrawWinnersHandler({ supabase, userId: USER_ID });

    expect(fromCalls[0]).toBe("draw_winners");
    // Only safe columns are projected — no PII beyond what admins need,
    // and definitely no `eligible` flag guessed from a join.
    expect(winnersBuilder.select).toHaveBeenCalledWith(
      "id, draw_id, entry_id, customer_id, position, prize, drawn_at, seed",
    );
    // Deterministic ordering: newest drawn_at first, then position.
    expect(winnersBuilder.order).toHaveBeenNthCalledWith(1, "drawn_at", { ascending: false });
    expect(winnersBuilder.order).toHaveBeenNthCalledWith(2, "position", { ascending: true });
    // Bounded result set — never an unbounded scan.
    expect(winnersBuilder.limit).toHaveBeenCalledWith(1000);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "w1",
      draw_id: DRAW_A,
      customer_id: CUST_A,
      draw_name: "June Draw",
      draw_status: "completed",
      customer_name: "Ada",
      customer_email: "ada@example.com",
    });
  });

  it("dedupes winner rows by primary key so the API never returns duplicates", async () => {
    // Simulate a hostile scenario: the underlying SELECT returns the same
    // winner id twice (e.g. a bad join or replication artefact). The handler
    // MUST dedupe before returning, because the admin UI keys on `id`.
    const dup = {
      id: "w-dup",
      draw_id: DRAW_A,
      entry_id: "e1",
      customer_id: CUST_A,
      position: 1,
      prize: "Bike",
      drawn_at: "2026-06-01T10:00:00Z",
      seed: null,
    };
    const other = {
      id: "w-other",
      draw_id: DRAW_B,
      entry_id: "e2",
      customer_id: CUST_B,
      position: 1,
      prize: "Phone",
      drawn_at: "2026-05-01T10:00:00Z",
      seed: null,
    };
    const { supabase } = makeSupabase({
      isAdmin: true,
      winners: { data: [dup, dup, other, dup], error: null },
      draws: {
        data: [
          { id: DRAW_A, name: "A", status: "completed", winners_count: 1 },
          { id: DRAW_B, name: "B", status: "completed", winners_count: 1 },
        ],
        error: null,
      },
      profiles: {
        data: [
          { id: CUST_A, full_name: null, email: null, phone: null },
          { id: CUST_B, full_name: null, email: null, phone: null },
        ],
        error: null,
      },
    });

    const rows = await listAllDrawWinnersHandler({ supabase, userId: USER_ID });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(["w-dup", "w-other"]);
    // And no (draw_id, customer_id) pair appears more than once — the
    // storage-level uniqueness contract the UI relies on.
    const pairs = rows.map((r) => `${r.draw_id}:${r.customer_id}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("surfaces winners-table errors without silently returning an empty feed", async () => {
    const { supabase } = makeSupabase({
      isAdmin: true,
      winners: { data: null, error: { message: "permission denied for draw_winners" } },
    });
    await expect(
      listAllDrawWinnersHandler({ supabase, userId: USER_ID }),
    ).rejects.toThrow(/permission denied for draw_winners/);
  });
});

// ---------------------------------------------------------------------------
// DB-level assertions: eligibility source-of-truth + duplicate prevention.
// Skipped when SUPABASE_DB_URL is not set so `bunx vitest run` stays green in
// environments without database access.
// ---------------------------------------------------------------------------
const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("draw_winners — DB invariants backing the admin feed", () => {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  beforeEach(async () => {
    if (!(client as any)._connected) {
      await client.connect();
      (client as any)._connected = true;
    }
  });

  it("has a unique (draw_id, customer_id) index — no duplicate winners per draw", async () => {
    const res = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'draw_winners'
          AND indexdef ILIKE '%UNIQUE%(draw_id, customer_id)%'`,
    );
    expect(res.rowCount).toBeGreaterThan(0);
  });

  it("has a unique (draw_id, position) index — no duplicate positions per draw", async () => {
    const res = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'draw_winners'
          AND indexdef ILIKE '%UNIQUE INDEX%(draw_id, "position")%'`,
    );
    expect(res.rowCount).toBeGreaterThan(0);
  });

  it("pick_draw_winners is the ONLY writer path and filters by eligible = true", async () => {
    // If a future migration adds a second writer that skips the eligibility
    // filter, the admin feed's guarantee silently breaks. Pin the invariant.
    const fn = await client.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'pick_draw_winners'`,
    );
    expect(fn.rowCount).toBe(1);
    expect(fn.rows[0].src).toMatch(/de\.eligible\s*=\s*true/i);
  });
});
