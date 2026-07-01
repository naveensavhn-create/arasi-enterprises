import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const sb: any = ctx.supabase;
  const { data, error } = await sb.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listMembershipsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string; search?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    let q = sb
      .from("memberships")
      .select(
        "id, membership_number, member_display_id, coupon_no, user_id, plan_id, promoter_id, status, start_date, end_date, advance_paid, total_amount, paid_amount, notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds: string[] = Array.from(
      new Set(
        (rows ?? []).flatMap((r: any) => [r.user_id, r.promoter_id].filter(Boolean) as string[]),
      ),
    );
    const planIds: string[] = Array.from(new Set((rows ?? []).map((r: any) => r.plan_id as string)));

    const [profilesRes, plansRes] = await Promise.all([
      userIds.length
        ? sb.from("profiles").select("id, full_name, email, phone").in("id", userIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      planIds.length
        ? sb.from("membership_plans").select("id, name, code").in("id", planIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (plansRes.error) throw new Error(plansRes.error.message);

    const pMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    const planMap = new Map((plansRes.data ?? []).map((p: any) => [p.id, p]));

    let enriched = (rows ?? []).map((r: any) => ({
      ...r,
      customer: pMap.get(r.user_id) ?? null,
      promoter: r.promoter_id ? pMap.get(r.promoter_id) ?? null : null,
      plan: planMap.get(r.plan_id) ?? null,
    }));

    if (data.search) {
      const s = data.search.toLowerCase();
      enriched = enriched.filter(
        (r: any) =>
          r.membership_number?.toLowerCase().includes(s) ||
          r.member_display_id?.toLowerCase().includes(s) ||
          r.coupon_no?.toLowerCase().includes(s) ||
          r.customer?.full_name?.toLowerCase().includes(s) ||
          r.customer?.email?.toLowerCase().includes(s) ||
          r.plan?.name?.toLowerCase().includes(s),
      );
    }
    return enriched;
  });

export const listCustomerOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: roles, error: rErr } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "customer")
      .limit(2000);
    if (rErr) throw new Error(rErr.message);
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (!ids.length) return [];
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", ids)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listPromoterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: roles, error: rErr } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "promoter")
      .limit(2000);
    if (rErr) throw new Error(rErr.message);
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (!ids.length) return [];
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listActivePlanOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("membership_plans")
      .select("id, code, name, duration_months, monthly_installment, advance_amount, total_value")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createSchema = z.object({
  user_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  promoter_id: z.string().uuid().nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  advance_paid: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
  activate: z.boolean().optional(),
});

export const createMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const { data: row, error } = await sb
      .from("memberships")
      .insert({
        user_id: data.user_id,
        plan_id: data.plan_id,
        promoter_id: data.promoter_id ?? null,
        start_date: data.start_date,
        advance_paid: data.advance_paid ?? 0,
        paid_amount: data.advance_paid ?? 0,
        notes: data.notes ?? null,
        status: data.activate ? "active" : "pending",
      })
      .select("id, membership_number")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  promoter_id: z.string().uuid().nullable().optional(),
  status: z.enum(["pending", "active", "completed", "cancelled", "defaulted"]).optional(),
  notes: z.string().max(1000).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, ...patch } = data;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    const sb: any = context.supabase;
    const { error } = await sb.from("memberships").update(clean).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const activateMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("memberships")
      .update({ status: "active" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const cancelMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("memberships")
      .update({ status: "cancelled" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Bulk CSV Import ----------

const importRowSchema = z.object({
  row_number: z.number().int().positive(),
  customer_email: z.string().trim().toLowerCase().email(),
  plan_code: z.string().trim().min(1).max(64),
  promoter_email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD"),
  advance_paid: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
  activate: z.boolean().optional(),
});

const importSchema = z.object({
  rows: z.array(z.unknown()).min(1).max(500),
  dry_run: z.boolean().optional(),
});

export type ImportRowResult = {
  row_number: number;
  ok: boolean;
  membership_id?: string;
  membership_number?: string;
  error?: string;
  customer_email?: string;
  plan_code?: string;
};

export const bulkImportMemberships = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => importSchema.parse(d))
  .handler(async ({ data, context }): Promise<{
    total: number;
    valid: number;
    invalid: number;
    inserted: number;
    dry_run: boolean;
    results: ImportRowResult[];
  }> => {
    await assertAdmin(context);
    const sb: any = context.supabase;

    // Parse and per-row validate first
    const parsed: {
      row_number: number;
      raw: any;
      parsed?: z.infer<typeof importRowSchema>;
      error?: string;
    }[] = data.rows.map((raw: any, idx) => {
      const withNumber = { row_number: idx + 1, ...(raw as object) };
      const r = importRowSchema.safeParse(withNumber);
      if (!r.success) {
        return {
          row_number: idx + 1,
          raw,
          error: r.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; "),
        };
      }
      return { row_number: idx + 1, raw, parsed: r.data };
    });

    // Collect lookups
    const customerEmails = Array.from(
      new Set(parsed.filter((p) => p.parsed).map((p) => p.parsed!.customer_email)),
    );
    const promoterEmails = Array.from(
      new Set(
        parsed
          .filter((p) => p.parsed?.promoter_email)
          .map((p) => p.parsed!.promoter_email!) as string[],
      ),
    );
    const planCodes = Array.from(
      new Set(parsed.filter((p) => p.parsed).map((p) => p.parsed!.plan_code)),
    );

    const [profRes, plansRes, rolesRes] = await Promise.all([
      customerEmails.length || promoterEmails.length
        ? sb
            .from("profiles")
            .select("id, email")
            .in("email", Array.from(new Set([...customerEmails, ...promoterEmails])))
        : Promise.resolve({ data: [] as any[], error: null }),
      planCodes.length
        ? sb
            .from("membership_plans")
            .select("id, code, is_active")
            .in("code", planCodes)
        : Promise.resolve({ data: [] as any[], error: null }),
      Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (profRes.error) throw new Error(profRes.error.message);
    if (plansRes.error) throw new Error(plansRes.error.message);

    const emailToId = new Map<string, string>(
      (profRes.data ?? []).map((p: any) => [String(p.email).toLowerCase(), p.id as string]),
    );
    const planByCode = new Map<string, { id: string; is_active: boolean }>(
      (plansRes.data ?? []).map((p: any) => [String(p.code), { id: p.id, is_active: p.is_active }]),
    );

    const allIds = Array.from(new Set(Array.from(emailToId.values())));
    let rolesByUser = new Map<string, Set<string>>();
    if (allIds.length) {
      const { data: roles, error: rErr } = await sb
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", allIds);
      if (rErr) throw new Error(rErr.message);
      for (const r of roles ?? []) {
        const set = rolesByUser.get(r.user_id) ?? new Set<string>();
        set.add(r.role);
        rolesByUser.set(r.user_id, set);
      }
    }

    const results: ImportRowResult[] = [];
    const inserts: {
      row_number: number;
      user_id: string;
      plan_id: string;
      promoter_id: string | null;
      start_date: string;
      advance_paid: number;
      notes: string | null;
      status: "pending" | "active";
      customer_email: string;
      plan_code: string;
    }[] = [];

    for (const p of parsed) {
      if (!p.parsed) {
        results.push({ row_number: p.row_number, ok: false, error: p.error });
        continue;
      }
      const r = p.parsed;
      const errs: string[] = [];
      const customerId = emailToId.get(r.customer_email);
      if (!customerId) errs.push(`customer_email not found (${r.customer_email})`);
      else if (!rolesByUser.get(customerId)?.has("customer"))
        errs.push(`user ${r.customer_email} is not a customer`);
      let promoterId: string | null = null;
      if (r.promoter_email) {
        const pid = emailToId.get(r.promoter_email);
        if (!pid) errs.push(`promoter_email not found (${r.promoter_email})`);
        else if (!rolesByUser.get(pid)?.has("promoter"))
          errs.push(`user ${r.promoter_email} is not a promoter`);
        else promoterId = pid;
      }
      const plan = planByCode.get(r.plan_code);
      if (!plan) errs.push(`plan_code not found (${r.plan_code})`);
      else if (!plan.is_active) errs.push(`plan ${r.plan_code} is inactive`);

      if (errs.length) {
        results.push({
          row_number: p.row_number,
          ok: false,
          error: errs.join("; "),
          customer_email: r.customer_email,
          plan_code: r.plan_code,
        });
        continue;
      }

      inserts.push({
        row_number: p.row_number,
        user_id: customerId!,
        plan_id: plan!.id,
        promoter_id: promoterId,
        start_date: r.start_date,
        advance_paid: r.advance_paid ?? 0,
        notes: r.notes ?? null,
        status: r.activate ? "active" : "pending",
        customer_email: r.customer_email,
        plan_code: r.plan_code,
      });
    }

    const valid = inserts.length;
    const invalid = results.length;

    if (!data.dry_run && inserts.length) {
      for (const ins of inserts) {
        const { data: row, error } = await sb
          .from("memberships")
          .insert({
            user_id: ins.user_id,
            plan_id: ins.plan_id,
            promoter_id: ins.promoter_id,
            start_date: ins.start_date,
            advance_paid: ins.advance_paid,
            paid_amount: ins.advance_paid,
            notes: ins.notes,
            status: ins.status,
          })
          .select("id, membership_number")
          .single();
        if (error) {
          results.push({
            row_number: ins.row_number,
            ok: false,
            error: error.message,
            customer_email: ins.customer_email,
            plan_code: ins.plan_code,
          });
        } else {
          results.push({
            row_number: ins.row_number,
            ok: true,
            membership_id: row.id,
            membership_number: row.membership_number,
            customer_email: ins.customer_email,
            plan_code: ins.plan_code,
          });
        }
      }
    } else {
      for (const ins of inserts) {
        results.push({
          row_number: ins.row_number,
          ok: true,
          customer_email: ins.customer_email,
          plan_code: ins.plan_code,
        });
      }
    }

    results.sort((a, b) => a.row_number - b.row_number);
    const inserted = data.dry_run ? 0 : results.filter((r) => r.ok && r.membership_id).length;
    return {
      total: parsed.length,
      valid,
      invalid,
      inserted,
      dry_run: !!data.dry_run,
      results,
    };
  });
