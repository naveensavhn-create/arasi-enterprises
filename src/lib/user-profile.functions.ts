import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PROFILE_COLS =
  "id,email,full_name,phone,address_line1,address_line2,city,state,postal_code,country,aadhaar_number,aadhaar_address,aadhaar_front_url,aadhaar_back_url,kyc_status,kyc_submitted_at,kyc_reviewed_at,kyc_review_notes,referred_by_promoter_id,created_at,updated_at";

export type AdminProfileDetail = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  aadhaar_number: string | null;
  aadhaar_address: string | null;
  aadhaar_front_url: string | null;
  aadhaar_back_url: string | null;
  kyc_status: "unsubmitted" | "pending" | "approved" | "rejected";
  kyc_submitted_at: string | null;
  kyc_reviewed_at: string | null;
  kyc_review_notes: string | null;
  referred_by_promoter_id: string | null;
  referred_by_name: string | null;
  referred_by_email: string | null;
  referred_by_display_id: string | null;
  role: "admin" | "promoter" | "customer" | null;
  customer_display_id: number | null;
  promoter_display_id: string | null;
  promoter_referral_code: string | null;
  membership_number: string | null;
  membership_status: string | null;
  member_display_id: string | null;
  coupon_no: string | null;
  created_at: string;
  updated_at: string | null;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required.");
}

export const adminGetUserProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<AdminProfileDetail> => {
    await assertAdmin(context);
    const s = context.supabase;

    const { data: p, error: pe } = await s
      .from("profiles").select(PROFILE_COLS).eq("id", data.userId).maybeSingle();
    if (pe) throw new Error(pe.message);
    if (!p) throw new Error("Profile not found");

    const [{ data: roleRows }, { data: cid }, { data: pid }, { data: mem }] = await Promise.all([
      s.from("user_roles").select("role").eq("user_id", data.userId),
      s.from("customer_ids").select("display_id").eq("user_id", data.userId).maybeSingle(),
      s.from("promoter_ids").select("display_id,referral_code").eq("user_id", data.userId).maybeSingle(),
      s.from("memberships")
        .select("membership_number,status,member_display_id,coupon_no")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const roles = ((roleRows ?? []) as Array<{ role: string }>).map((r) => r.role);
    const role: AdminProfileDetail["role"] = roles.includes("admin")
      ? "admin"
      : roles.includes("promoter") ? "promoter"
      : roles.includes("customer") ? "customer"
      : null;

    let referred_by_name: string | null = null;
    let referred_by_email: string | null = null;
    let referred_by_display_id: string | null = null;
    const refId = (p as any).referred_by_promoter_id as string | null;
    if (refId) {
      const [{ data: rp }, { data: rpid }] = await Promise.all([
        s.from("profiles").select("full_name,email").eq("id", refId).maybeSingle(),
        s.from("promoter_ids").select("display_id").eq("user_id", refId).maybeSingle(),
      ]);
      referred_by_name = (rp as any)?.full_name ?? null;
      referred_by_email = (rp as any)?.email ?? null;
      referred_by_display_id = (rpid as any)?.display_id ?? null;
    }

    return {
      ...(p as any),
      role,
      customer_display_id: (cid as any)?.display_id ?? null,
      promoter_display_id: (pid as any)?.display_id ?? null,
      promoter_referral_code: (pid as any)?.referral_code ?? null,
      membership_number: (mem as any)?.membership_number ?? null,
      membership_status: (mem as any)?.status ?? null,
      member_display_id: (mem as any)?.member_display_id ?? null,
      coupon_no: (mem as any)?.coupon_no ?? null,
      referred_by_name,
      referred_by_email,
      referred_by_display_id,
    } as AdminProfileDetail;
  });

const optStr = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((v) => (v == null || v === "" ? null : v));

const phoneField = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((v) => (v == null || v === "" ? null : v))
  .refine(
    (v) => v === null || v === undefined || /^\+?[0-9]{10,15}$/.test(v.replace(/[\s-]/g, "")),
    "Phone must be 10–15 digits (optional leading +)",
  );

export const adminUpdateProfileSchema = z.object({
  userId: z.string().uuid(),
  full_name: optStr,
  email: z.union([z.string().trim().email("Invalid email address"), z.literal(""), z.null()]).optional()
    .transform((v) => (v == null || v === "" ? null : v)),
  phone: phoneField,
  address_line1: optStr,
  address_line2: optStr,
  city: optStr,
  state: optStr,
  postal_code: optStr,
  country: optStr,
  aadhaar_number: z.union([z.string().trim(), z.null()]).optional()
    .transform((v) => (v == null || v === "" ? null : v))
    .refine((v) => v === null || v === undefined || /^[0-9]{12}$/.test(v), "Aadhaar must be 12 digits"),
  aadhaar_address: optStr,
  referred_by_promoter_id: z.union([z.string().uuid(), z.null()]).optional(),
  clear_referrer: z.boolean().optional(),
  reason: z.string().trim().min(5, "Reason is required (min 5 characters)").max(500),
});

const updateSchema = adminUpdateProfileSchema;


export const adminUpdateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => updateSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("admin_update_profile" as any, {
      _user_id: data.userId,
      _full_name: data.full_name ?? null,
      _email: data.email ?? null,
      _phone: data.phone ?? null,
      _address_line1: data.address_line1 ?? null,
      _address_line2: data.address_line2 ?? null,
      _city: data.city ?? null,
      _state: data.state ?? null,
      _postal_code: data.postal_code ?? null,
      _country: data.country ?? null,
      _aadhaar_number: data.aadhaar_number ?? null,
      _aadhaar_address: data.aadhaar_address ?? null,
      _referred_by: data.referred_by_promoter_id ?? null,
      _clear_referrer: data.clear_referrer ?? false,
      _reason: data.reason,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type MyPromoterReferral = {
  display_id: string;
  referral_code: string;
  referral_url: string;
  referred_count: number;
};

export const getMyPromoterReferral = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ origin: z.string().url().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<MyPromoterReferral | null> => {
    const { data: pid, error } = await context.supabase
      .from("promoter_ids")
      .select("display_id,referral_code")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!pid) return null;
    const { count } = await context.supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("referred_by_promoter_id", context.userId);
    const origin = (data?.origin ?? "").replace(/\/$/, "");
    return {
      display_id: (pid as any).display_id,
      referral_code: (pid as any).referral_code,
      referral_url: `${origin}/auth?portal=customer&mode=signup&ref=${(pid as any).referral_code}`,
      referred_count: count ?? 0,
    };
  });

export const applyReferralCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ code: z.string().trim().min(4).max(32) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ promoter_id: string | null }> => {
    const { data: res, error } = await context.supabase.rpc(
      "apply_referral_code" as any,
      { _code: data.code } as any,
    );
    if (error) throw new Error(error.message);
    return { promoter_id: (res as string) ?? null };
  });
