import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createDrawSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional().nullable(),
  prize: z.string().min(2).max(200),
  prizeValue: z.number().nonnegative().optional().nullable(),
  winnersCount: z.number().int().min(1).max(1000).default(1),
  opensAt: z.string().datetime().optional().nullable(),
  closesAt: z.string().datetime().optional().nullable(),
  drawAt: z.string().datetime().optional().nullable(),
  mode: z.enum(["manual", "automated"]).default("manual"),
  planId: z.string().uuid().optional().nullable(),
  requiresActiveMembership: z.boolean().default(true),
});


const idSchema = z.object({ id: z.string().uuid() });
const pickSchema = z.object({ drawId: z.string().uuid(), seed: z.string().max(200).optional().nullable() });
const enterSchema = z.object({ drawId: z.string().uuid(), membershipId: z.string().uuid().optional().nullable() });

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listDraws = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("draws")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createDraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => createDrawSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("draws")
      .insert({
        name: data.name,
        description: data.description ?? null,
        prize: data.prize,
        prize_value: data.prizeValue ?? null,
        winners_count: data.winnersCount,
        opens_at: data.opensAt ?? null,
        closes_at: data.closesAt ?? null,
        draw_at: data.drawAt ?? null,
        mode: data.mode,
        plan_id: data.planId ?? null,
        requires_active_membership: data.requiresActiveMembership,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });


export const setDrawStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["scheduled", "open", "closed", "completed", "cancelled"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("draws").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("draws").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDrawEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ drawId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("draw_entries")
      .select("id, customer_id, membership_id, entry_number, eligible, disqualified_reason, created_at")
      .eq("draw_id", data.drawId)
      .order("entry_number", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listDrawWinners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ drawId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("draw_winners")
      .select("id, entry_id, customer_id, position, prize, drawn_at, seed")
      .eq("draw_id", data.drawId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * listAllDrawWinners — Admin results view.
 * Returns every recorded winner across all draws, hydrated with draw metadata
 * and the winner's profile (name/email) plus the exact drawn_at timestamp.
 * The DB unique constraint `draw_winners_draw_customer_unique` guarantees a
 * customer can appear at most once per draw.
 */
export type DrawResultRow = {
  id: string;
  draw_id: string;
  entry_id: string;
  customer_id: string;
  position: number;
  prize: string;
  drawn_at: string;
  seed: string | null;
  draw_name: string;
  draw_status: string;
  winners_count: number;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
};

export async function listAllDrawWinnersHandler(context: {
  supabase: any;
  userId: string;
}): Promise<DrawResultRow[]> {
  await assertAdmin(context);
  const { data: winners, error } = await context.supabase
    .from("draw_winners")
    .select("id, draw_id, entry_id, customer_id, position, prize, drawn_at, seed")
    .order("drawn_at", { ascending: false })
    .order("position", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  const rawRows = (winners ?? []) as Array<{
    id: string; draw_id: string; entry_id: string; customer_id: string;
    position: number; prize: string; drawn_at: string; seed: string | null;
  }>;
  // Defense in depth: even though `draw_winners_draw_customer_unique` and
  // `draw_winners_draw_id_position_key` prevent duplicates at the storage
  // layer, dedupe by primary key here so a bad join / view change can never
  // produce duplicate rows in the admin results feed.
  const seen = new Set<string>();
  const rows = rawRows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  if (rows.length === 0) return [];
  const drawIds = Array.from(new Set(rows.map((r) => r.draw_id)));
  const custIds = Array.from(new Set(rows.map((r) => r.customer_id)));
  const [drawsRes, profRes] = await Promise.all([
    context.supabase.from("draws").select("id, name, status, winners_count").in("id", drawIds),
    context.supabase.from("profiles").select("id, full_name, email, phone").in("id", custIds),
  ]);
  if (drawsRes.error) throw new Error(drawsRes.error.message);
  if (profRes.error) throw new Error(profRes.error.message);
  const drawMap = new Map<string, { name: string; status: string; winners_count: number }>(
    ((drawsRes.data ?? []) as Array<{ id: string; name: string; status: string; winners_count: number }>)
      .map((d) => [d.id, { name: d.name, status: d.status, winners_count: d.winners_count }]),
  );
  const profMap = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>(
    ((profRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null }>)
      .map((p) => [p.id, { full_name: p.full_name, email: p.email, phone: p.phone }]),
  );
  return rows.map((r) => {
    const d = drawMap.get(r.draw_id);
    const p = profMap.get(r.customer_id);
    return {
      ...r,
      draw_name: d?.name ?? "(deleted draw)",
      draw_status: d?.status ?? "unknown",
      winners_count: d?.winners_count ?? 0,
      customer_name: p?.full_name ?? null,
      customer_email: p?.email ?? null,
      customer_phone: p?.phone ?? null,
    };
  });
}

export const listAllDrawWinners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DrawResultRow[]> => listAllDrawWinnersHandler(context));



/**
 * pickDrawWinners — admin-only, single-transaction winner selection.
 *
 * Backed by `public.pick_draw_winners(uuid, text)` which:
 *   - re-checks `has_role(admin)` server-side,
 *   - takes `SELECT … FOR UPDATE` on the draw row so concurrent picks
 *     serialize instead of double-drawing,
 *   - is idempotent: if the draw is already `completed` or already has
 *     winners recorded, the existing winners are returned unchanged,
 *   - is duplicate-safe at the storage layer via the unique constraints
 *     `draw_winners_draw_customer_unique` and `draw_winners_draw_id_position_key`.
 */
export const pickDrawWinners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => pickSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase.rpc("pick_draw_winners", {
      _draw_id: data.drawId,
      _seed: data.seed ?? undefined,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const enterDraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => enterSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: draw, error: drawErr } = await context.supabase
      .from("draws")
      .select("id, status, opens_at, closes_at, requires_active_membership, plan_id")
      .eq("id", data.drawId)
      .maybeSingle();
    if (drawErr) throw new Error(drawErr.message);
    if (!draw) throw new Error("Draw not found");
    if (!["scheduled", "open"].includes(draw.status)) throw new Error("Draw is not open for entries");
    const now = Date.now();
    if (draw.opens_at && new Date(draw.opens_at).getTime() > now) throw new Error("Draw hasn't opened yet");
    if (draw.closes_at && new Date(draw.closes_at).getTime() < now) throw new Error("Draw entries have closed");

    let membershipId = data.membershipId ?? null;
    if (draw.requires_active_membership || membershipId) {
      let q = context.supabase
        .from("memberships")
        .select("id, plan_id, status")
        .eq("user_id", context.userId)
        .eq("status", "active");
      if (draw.plan_id) q = q.eq("plan_id", draw.plan_id);
      const { data: mem, error: mErr } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (mErr) throw new Error(mErr.message);
      if (draw.requires_active_membership && !mem) {
        throw new Error("You need an active membership to enter this draw");
      }
      membershipId = mem?.id ?? membershipId;
    }

    const { data: row, error } = await context.supabase
      .from("draw_entries")
      .insert({
        draw_id: data.drawId,
        customer_id: context.userId,
        membership_id: membershipId,
      })
      .select("*")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("You've already entered this draw");
      throw new Error(error.message);
    }
    return row;
  });

export const listOpenDrawsForCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: draws, error } = await context.supabase
      .from("draws")
      .select("id, name, description, prize, prize_value, status, mode, opens_at, closes_at, draw_at, winners_count, plan_id, requires_active_membership, drawn_at")
      .in("status", ["scheduled", "open", "closed", "completed"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const list = (draws ?? []) as Array<{ id: string; name: string; description: string | null; prize: string; prize_value: number | null; status: string; mode: string; opens_at: string | null; closes_at: string | null; draw_at: string | null; winners_count: number; plan_id: string | null; requires_active_membership: boolean; drawn_at: string | null }>;
    const ids = list.map((d) => d.id);
    const [entriesRes, winsRes] = await Promise.all([
      ids.length
        ? context.supabase
            .from("draw_entries")
            .select("id, draw_id, entry_number, eligible, disqualified_reason, created_at, membership_id")
            .eq("customer_id", context.userId)
            .in("draw_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? context.supabase
            .from("draw_winners")
            .select("id, draw_id, position, prize, drawn_at")
            .eq("customer_id", context.userId)
            .in("draw_id", ids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    type EntryRow = { id: string; draw_id: string; entry_number: number; eligible: boolean; disqualified_reason: string | null; created_at: string; membership_id: string | null };
    type WinRow = { id: string; draw_id: string; position: number; prize: string; drawn_at: string };
    const entryByDraw = new Map<string, EntryRow>(((entriesRes.data ?? []) as EntryRow[]).map((e) => [e.draw_id, e]));
    const winByDraw = new Map<string, WinRow>(((winsRes.data ?? []) as WinRow[]).map((w) => [w.draw_id, w]));
    return list.map((d) => ({
      ...d,
      myEntry: entryByDraw.get(d.id) ?? null,
      myWin: winByDraw.get(d.id) ?? null,
    }));
  });

/**
 * listDrawsForPromoter — Read-only feed of active/recent draws with the
 * public winner list per draw (name only, no PII). Promoters need visibility
 * into upcoming schedules and announced winners for their customers.
 */
export const listDrawsForPromoter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [isPromoter, isAdmin] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "promoter" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    ]);
    if (!isPromoter.data && !isAdmin.data) throw new Error("Forbidden");

    const { data: draws, error } = await context.supabase
      .from("draws")
      .select("id, name, description, prize, prize_value, status, mode, opens_at, closes_at, draw_at, drawn_at, winners_count, requires_active_membership")
      .in("status", ["scheduled", "open", "closed", "completed"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const list = (draws ?? []) as Array<Record<string, unknown> & { id: string }>;
    const ids = list.map((d) => d.id);
    if (ids.length === 0) return [];

    const { data: winners, error: wErr } = await context.supabase
      .from("draw_winners")
      .select("id, draw_id, customer_id, position, prize, drawn_at")
      .in("draw_id", ids)
      .order("position", { ascending: true });
    if (wErr) throw new Error(wErr.message);
    const custIds = Array.from(new Set(((winners ?? []) as Array<{ customer_id: string }>).map((w) => w.customer_id)));
    const { data: profs } = custIds.length
      ? await context.supabase.from("profiles").select("id, full_name").in("id", custIds)
      : { data: [] as Array<{ id: string; full_name: string | null }> };
    const nameById = new Map<string, string>(
      ((profs ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name ?? "Member"]),
    );
    const winnersByDraw = new Map<string, Array<{ position: number; name: string; prize: string; drawn_at: string }>>();
    for (const w of (winners ?? []) as Array<{ draw_id: string; customer_id: string; position: number; prize: string; drawn_at: string }>) {
      const arr = winnersByDraw.get(w.draw_id) ?? [];
      arr.push({ position: w.position, name: nameById.get(w.customer_id) ?? "Member", prize: w.prize, drawn_at: w.drawn_at });
      winnersByDraw.set(w.draw_id, arr);
    }
    return list.map((d) => ({ ...d, winners: winnersByDraw.get(d.id) ?? [] }));
  });


/**
 * createDrawEntry
 *
 * Canonical entry-creation server function. Eligibility is enforced in layers:
 *   1) Zod input validation (well-formed UUIDs, optional membership)
 *      → INVALID_INPUT.
 *   2) Server-side pre-flight (draw exists, status scheduled/open, within
 *      open/close window, plan/membership match when required)
 *      → INVALID_ELIGIBILITY, thrown BEFORE any INSERT is attempted.
 *   3) Database trigger `validate_draw_entry()` — belt-and-braces authority.
 *   4) RLS policy `draw_entries.customer_id = auth.uid()` on INSERT.
 *
 * Unique index on (draw_id, customer_id) prevents duplicate entries.
 */
export const createDrawEntrySchema = z.object({
  drawId: z.string().uuid("Invalid draw id"),
  membershipId: z.string().uuid().optional().nullable(),
});

export type DrawEntryErrorCode = "INVALID_INPUT" | "INVALID_ELIGIBILITY";

export class DrawEntryError extends Error {
  readonly code: DrawEntryErrorCode;
  readonly status = 400 as const;
  readonly reason: string;
  readonly details?: Record<string, unknown>;
  constructor(
    code: DrawEntryErrorCode,
    reason: string,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message ?? reason);
    this.name = "DrawEntryError";
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
  toJSON() {
    return {
      ok: false,
      error: this.code,
      reason: this.reason,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

type PgError = { code?: string; message?: string; details?: string | null };

function mapEntryError(err: PgError): Error {
  const code = err.code ?? "";
  const msg = err.message ?? "Failed to create draw entry";
  if (code === "23505") return new Error("You've already entered this draw");
  if (code === "23503")
    return new DrawEntryError("INVALID_ELIGIBILITY", "DRAW_NOT_FOUND", "Draw not found");
  if (code === "42501")
    return new DrawEntryError(
      "INVALID_ELIGIBILITY",
      "NOT_ALLOWED",
      "You are not allowed to enter this draw",
    );
  // Trigger-raised check_violation surfaces the human-readable message directly.
  if (code === "23514" || code === "P0001")
    return new DrawEntryError("INVALID_ELIGIBILITY", "TRIGGER_REJECTED", msg);
  return new Error(msg);
}

const ENTRY_COLUMNS =
  "id, draw_id, customer_id, membership_id, entry_number, eligible, created_at";

type DrawEntryContext = {
  supabase: {
    from: (t: string) => any;
  };
  userId: string;
};

/**
 * Testable handler body — exported so integration tests can drive it with a
 * mocked supabase client and assert the exact error contract (code / reason /
 * status) plus "no INSERT before rejection".
 */
export async function createDrawEntryHandler(
  input: unknown,
  context: DrawEntryContext,
) {
  // 1) INPUT VALIDATION → INVALID_INPUT (never touches the DB).
  const parsed = createDrawEntrySchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new DrawEntryError(
      "INVALID_INPUT",
      "SCHEMA_VALIDATION_FAILED",
      issues[0]?.message ?? "Invalid input",
      { issues },
    );
  }
  const data = parsed.data;

  // Idempotency: if the caller already has an entry for this draw, return it.
  const { data: existing, error: existingError } = await context.supabase
    .from("draw_entries")
    .select(ENTRY_COLUMNS)
    .eq("draw_id", data.drawId)
    .eq("customer_id", context.userId)
    .maybeSingle();
  if (existingError) throw mapEntryError(existingError as PgError);
  if (existing) return existing;

  // 2) SERVER-SIDE PRE-FLIGHT → INVALID_ELIGIBILITY (before any INSERT).
  const { data: draw, error: drawErr } = await context.supabase
    .from("draws")
    .select(
      "id, status, opens_at, closes_at, requires_active_membership, plan_id",
    )
    .eq("id", data.drawId)
    .maybeSingle();
  if (drawErr) throw mapEntryError(drawErr as PgError);
  if (!draw) {
    throw new DrawEntryError(
      "INVALID_ELIGIBILITY",
      "DRAW_NOT_FOUND",
      "This draw is no longer available.",
      { drawId: data.drawId },
    );
  }
  if (!["scheduled", "open"].includes(draw.status)) {
    throw new DrawEntryError(
      "INVALID_ELIGIBILITY",
      "DRAW_CLOSED",
      "Entries for this draw are closed.",
      { status: draw.status },
    );
  }
  const now = Date.now();
  if (draw.opens_at && new Date(draw.opens_at).getTime() > now) {
    throw new DrawEntryError(
      "INVALID_ELIGIBILITY",
      "DRAW_NOT_OPEN_YET",
      "This draw hasn't opened yet.",
      { opens_at: draw.opens_at },
    );
  }
  if (draw.closes_at && new Date(draw.closes_at).getTime() < now) {
    throw new DrawEntryError(
      "INVALID_ELIGIBILITY",
      "DRAW_ENTRIES_CLOSED",
      "Entries for this draw have closed.",
      { closes_at: draw.closes_at },
    );
  }

  let membershipId = data.membershipId ?? null;
  if (draw.requires_active_membership || membershipId || draw.plan_id) {
    let q = context.supabase
      .from("memberships")
      .select("id, plan_id, status")
      .eq("user_id", context.userId)
      .eq("status", "active");
    if (draw.plan_id) q = q.eq("plan_id", draw.plan_id);
    if (membershipId) q = q.eq("id", membershipId);
    const { data: mem, error: mErr } = await q
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mErr) throw mapEntryError(mErr as PgError);

    if (draw.requires_active_membership && !mem) {
      throw new DrawEntryError(
        "INVALID_ELIGIBILITY",
        draw.plan_id ? "PLAN_NOT_ELIGIBLE" : "NO_ACTIVE_MEMBERSHIP",
        draw.plan_id
          ? "Your membership plan isn't eligible for this draw."
          : "An active membership is required to enter this draw.",
        draw.plan_id ? { required_plan_id: draw.plan_id } : undefined,
      );
    }
    if (membershipId && !mem) {
      throw new DrawEntryError(
        "INVALID_ELIGIBILITY",
        "MEMBERSHIP_NOT_ELIGIBLE",
        "The selected membership isn't eligible for this draw.",
        { membershipId, required_plan_id: draw.plan_id ?? null },
      );
    }
    membershipId = mem?.id ?? membershipId;
  }

  // 3) INSERT — reachable only after all pre-flight gates pass.
  const { data: row, error } = await context.supabase
    .from("draw_entries")
    .insert({
      draw_id: data.drawId,
      customer_id: context.userId,
      membership_id: membershipId,
    })
    .select(ENTRY_COLUMNS)
    .single();

  if (error) {
    // Race: concurrent insert won the unique-index race. Return that row.
    if ((error as PgError).code === "23505") {
      const { data: racedRow, error: racedError } = await context.supabase
        .from("draw_entries")
        .select(ENTRY_COLUMNS)
        .eq("draw_id", data.drawId)
        .eq("customer_id", context.userId)
        .maybeSingle();
      if (racedError) throw mapEntryError(racedError as PgError);
      if (racedRow) return racedRow;
    }
    throw mapEntryError(error as PgError);
  }
  return row;
}

export const createDrawEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // Pass raw input through — the handler performs safeParse itself so that
  // validation failures throw DrawEntryError (INVALID_INPUT), not raw ZodError.
  .inputValidator((i: unknown) => i)
  .handler(async ({ data, context }) => {
    return createDrawEntryHandler(data, {
      supabase: context.supabase as unknown as DrawEntryContext["supabase"],
      userId: context.userId,
    });
  });


