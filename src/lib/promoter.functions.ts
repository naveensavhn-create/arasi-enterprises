import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReferredCustomer = {
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
  aadhaar_address: string | null;
  has_aadhaar_docs: boolean;
  kyc_status: "unsubmitted" | "pending" | "approved" | "rejected";
  kyc_submitted_at: string | null;
  kyc_reviewed_at: string | null;
  kyc_review_notes: string | null;
  created_at: string;
  membership_number: string | null;
  membership_status: string | null;
  member_display_id: string | null;
  coupon_no: string | null;
};

export type PromoterOption = { id: string; full_name: string; email: string };

export const listMyReferredCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReferredCustomer[]> => {
    const { data, error } = await context.supabase.rpc(
      "promoter_list_my_customers" as any,
    );
    if (error) throw new Error(error.message);
    return (data ?? []) as ReferredCustomer[];
  });

export const submitReferralForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        note: z.string().trim().max(1000).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ kyc_status: string }> => {
    const { data: res, error } = await context.supabase.rpc(
      "promoter_submit_referral_for_review" as any,
      { _user_id: data.userId, _note: data.note ?? null } as any,
    );
    if (error) throw new Error(error.message);
    return { kyc_status: (res as string) ?? "pending" };
  });

const registerSchema = z.object({
  email: z.string().trim().email().max(255),
  full_name: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .refine((v) => !v || /^[0-9+\-\s()]{7,20}$/.test(v), "Invalid phone"),
  address_line1: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  state: z.string().trim().max(80).optional().nullable(),
  postal_code: z.string().trim().max(12).optional().nullable(),
  send_invite: z.boolean().optional().default(true),
});

function randomPassword() {
  const bytes = new Uint8Array(18);
  (globalThis.crypto ?? require("crypto").webcrypto).getRandomValues(bytes);
  return "Ar$" + Buffer.from(bytes).toString("base64url").slice(0, 20);
}

export const registerCustomerAsPromoter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => registerSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string; temporary_password: string | null }> => {
    // Authorization: caller must be a promoter (or admin)
    const [{ data: isPromoter }, { data: isAdmin }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "promoter" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    ]);
    if (!isPromoter && !isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tempPassword = randomPassword();
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        role: "customer",
      },
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Failed to create user");
    }
    const newUserId = created.data.user.id;

    // Populate profile fields + link referrer
    const { error: pErr } = await (supabaseAdmin.from("profiles") as any)
      .update({
        full_name: data.full_name,
        phone: data.phone ?? null,
        address_line1: data.address_line1 ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        postal_code: data.postal_code ?? null,
        referred_by_promoter_id: context.userId,
      })
      .eq("id", newUserId);
    if (pErr) throw new Error(pErr.message);

    return {
      id: newUserId,
      temporary_password: data.send_invite ? tempPassword : null,
    };
  });

export const adminSetCustomerPromoter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        promoterId: z.string().uuid().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_set_customer_promoter" as any, {
      _user_id: data.userId,
      _promoter_id: data.promoterId,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListPromoters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoterOption[]> => {
    const { data, error } = await context.supabase.rpc("admin_list_promoters" as any);
    if (error) throw new Error(error.message);
    return (data ?? []) as PromoterOption[];
  });
