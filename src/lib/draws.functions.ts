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

export const listAllDrawWinners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DrawResultRow[]> => {
    await assertAdmin(context);
    const { data: winners, error } = await context.supabase
      .from("draw_winners")
      .select("id, draw_id, entry_id, customer_id, position, prize, drawn_at, seed")
      .order("drawn_at", { ascending: false })
      .order("position", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);
    const rows = (winners ?? []) as Array<{
      id: string; draw_id: string; entry_id: string; customer_id: string;
      position: number; prize: string; drawn_at: string; seed: string | null;
    }>;
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
  });



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
 * Canonical entry-creation server function. Eligibility is enforced in two layers:
 *   1) Zod input validation (well-formed UUIDs, optional membership).
 *   2) Database trigger `validate_draw_entry()` (draw exists, status is scheduled/open,
 *      within open/close window, active membership + plan match when required).
 *   3) RLS policy `draw_entries.customer_id = auth.uid()` on INSERT, so a caller
 *      cannot create an entry on behalf of another user.
 *
 * Unique index on (draw_id, customer_id) prevents duplicate entries.
 */
const createDrawEntrySchema = z.object({
  drawId: z.string().uuid("Invalid draw id"),
  membershipId: z.string().uuid().optional().nullable(),
});

type PgError = { code?: string; message?: string; details?: string | null };

function mapEntryError(err: PgError): Error {
  const code = err.code ?? "";
  const msg = err.message ?? "Failed to create draw entry";
  if (code === "23505") return new Error("You've already entered this draw");
  if (code === "23503") return new Error("Draw not found");
  if (code === "42501") return new Error("You are not allowed to enter this draw");
  // Trigger-raised check_violation surfaces the human-readable message directly.
  if (code === "23514" || code === "P0001") return new Error(msg);
  return new Error(msg);
}

export const createDrawEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => createDrawEntrySchema.parse(i))
  .handler(async ({ data, context }) => {
    const entryColumns =
      "id, draw_id, customer_id, membership_id, entry_number, eligible, created_at";

    // Idempotency: if the caller already has an entry for this draw, return
    // it instead of attempting a duplicate insert. RLS scopes the read to
    // the caller's own rows, so this cannot leak other users' entries.
    const { data: existing, error: existingError } = await context.supabase
      .from("draw_entries")
      .select(entryColumns)
      .eq("draw_id", data.drawId)
      .eq("customer_id", context.userId)
      .maybeSingle();
    if (existingError) throw mapEntryError(existingError as PgError);
    if (existing) return existing;

    const { data: row, error } = await context.supabase
      .from("draw_entries")
      .insert({
        draw_id: data.drawId,
        customer_id: context.userId,
        membership_id: data.membershipId ?? null,
      })
      .select(entryColumns)
      .single();

    // Race condition: a concurrent insert won the unique-index race between
    // our pre-check and this insert. Re-read and return that row instead of
    // surfacing the duplicate-key error to the caller.
    if (error) {
      if ((error as PgError).code === "23505") {
        const { data: racedRow, error: racedError } = await context.supabase
          .from("draw_entries")
          .select(entryColumns)
          .eq("draw_id", data.drawId)
          .eq("customer_id", context.userId)
          .maybeSingle();
        if (racedError) throw mapEntryError(racedError as PgError);
        if (racedRow) return racedRow;
      }
      throw mapEntryError(error as PgError);
    }
    return row;
  });

