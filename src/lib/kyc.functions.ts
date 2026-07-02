import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type KycStatus = "unsubmitted" | "pending" | "approved" | "rejected";

export type KycProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role?: "admin" | "promoter" | "customer" | null;
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
  kyc_status: KycStatus;
  kyc_submitted_at: string | null;
  kyc_reviewed_at: string | null;
  kyc_review_notes: string | null;
  referred_by_promoter_id?: string | null;
  referred_by_name?: string | null;
  referred_by_email?: string | null;
};

const KYC_COLUMNS =
  "id,email,full_name,phone,address_line1,address_line2,city,state,postal_code,country,aadhaar_number,aadhaar_address,aadhaar_front_url,aadhaar_back_url,kyc_status,kyc_submitted_at,kyc_reviewed_at,kyc_review_notes";

export const getMyKyc = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KycProfile | null> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select(KYC_COLUMNS)
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r) => r.role as string);
    const role: KycProfile["role"] = roles.includes("admin")
      ? "admin"
      : roles.includes("promoter")
        ? "promoter"
        : roles.includes("customer")
          ? "customer"
          : null;
    return { ...(data as KycProfile), role };
  });

const optionalTrim = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v && v.length ? v : null))
  .nullable();

const updateSchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional().nullable(),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .refine((v) => !v || /^[0-9+\-\s()]{7,20}$/.test(v), "Invalid phone number"),
  address_line1: optionalTrim,
  address_line2: optionalTrim,
  city: z.string().trim().max(80).optional().nullable(),
  state: z.string().trim().max(80).optional().nullable(),
  postal_code: z
    .string()
    .trim()
    .max(12)
    .optional()
    .nullable()
    .refine((v) => !v || /^[0-9A-Za-z\- ]{3,12}$/.test(v), "Invalid postal code"),
  country: z.string().trim().max(80).optional().nullable(),
  aadhaar_number: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => !v || /^\d{12}$/.test(v), "Aadhaar must be exactly 12 digits"),
  aadhaar_address: optionalTrim,
  aadhaar_front_url: optionalTrim,
  aadhaar_back_url: optionalTrim,
  submit: z.boolean().optional().default(false),
});

export const updateMyKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => updateSchema.parse(i))
  .handler(async ({ data, context }): Promise<KycProfile> => {
    const { submit, ...rest } = data;

    // If submitting, require the mandatory fields to be present in the merged record.
    if (submit) {
      const required = [
        "full_name",
        "phone",
        "address_line1",
        "city",
        "state",
        "postal_code",
        "aadhaar_number",
        "aadhaar_address",
        "aadhaar_front_url",
      ] as const;
      // Merge with existing to validate completeness
      const { data: existing } = await context.supabase
        .from("profiles")
        .select(KYC_COLUMNS)
        .eq("id", context.userId)
        .maybeSingle();
      const merged: Record<string, unknown> = { ...(existing ?? {}), ...rest };
      const missing = required.filter((f) => !merged[f] || String(merged[f]).trim() === "");
      if (missing.length) {
        throw new Error(
          `Please complete: ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}`,
        );
      }
    }

    const payload: Record<string, unknown> = { ...rest };
    if (submit) payload.kyc_status = "pending";

    const { data: row, error } = await (context.supabase.from("profiles") as any)
      .update(payload)
      .eq("id", context.userId)
      .select(KYC_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return row as KycProfile;
  });

export const listKycSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ status: z.enum(["pending", "approved", "rejected", "unsubmitted"]).optional() })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<KycProfile[]> => {
    const { data: rows, error } = await context.supabase.rpc("admin_list_kyc" as any, {
      _status: data.status ?? null,
    } as any);
    if (error) throw new Error(error.message);
    return (rows ?? []) as KycProfile[];
  });

const ALLOWED_ASSIGN_ROLES = ["promoter", "customer"] as const;

const setKycDecisionSchema = z.object({
  userId: z.string().uuid("Invalid user id"),
  approve: z.boolean(),
  notes: z.string().trim().max(500).optional().nullable(),
  assignRole: z
    .union([z.enum(ALLOWED_ASSIGN_ROLES), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v == null ? null : v))
    .refine(
      (v) => v === null || (ALLOWED_ASSIGN_ROLES as readonly string[]).includes(v),
      { message: `Membership role must be one of: ${ALLOWED_ASSIGN_ROLES.join(", ")}` },
    ),
});

export const setKycDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => {
    const parsed = setKycDecisionSchema.safeParse(i);
    if (!parsed.success) {
      // Prefer the first field-level message so the UI can surface it verbatim.
      const first = parsed.error.issues[0];
      throw new Error(first?.message ?? "Invalid input");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    if (data.assignRole && !data.approve) {
      throw new Error("Role can only be assigned when rejecting is disabled — approve first.");
    }
    // Defense-in-depth: block admin escalation even if a client crafts a payload
    // that bypassed the enum (the DB also rejects this).
    if ((data.assignRole as string | null) === "admin") {
      throw new Error("The 'admin' role cannot be granted through KYC approval.");
    }
    // Prevent silently downgrading an existing admin.
    if (data.assignRole) {
      const { data: targetIsAdmin } = await context.supabase.rpc("has_role", {
        _user_id: data.userId,
        _role: "admin",
      });
      if (targetIsAdmin) {
        throw new Error("This user is an admin — their role cannot be changed via KYC.");
      }
    }
    const { error } = await context.supabase.rpc("admin_set_kyc_decision" as any, {
      _user_id: data.userId,
      _approve: data.approve,
      _notes: data.notes ?? null,
      _assign_role: data.assignRole ?? null,
    } as any);
    if (error) throw new Error(error.message);

    // Fire-and-log the branded KYC decision email. Failures are captured
    // in `kyc_email_notifications` so admins can retry from the log.
    try {
      const [{ data: target }, { data: actor }] = await Promise.all([
        context.supabase
          .from("profiles")
          .select("email,full_name")
          .eq("id", data.userId)
          .maybeSingle(),
        context.supabase
          .from("profiles")
          .select("email,full_name")
          .eq("id", context.userId)
          .maybeSingle(),
      ]);
      if (target?.email) {
        const { enqueueKycDecisionEmail } = await import(
          "@/lib/email/send-kyc-decision.server"
        );
        await enqueueKycDecisionEmail({
          decision: data.approve ? "approved" : "rejected",
          recipientEmail: target.email as string,
          recipientName: (target.full_name as string | null) ?? undefined,
          reviewerName: (actor?.full_name as string | null) ?? undefined,
          reviewerEmail: (actor?.email as string | null) ?? undefined,
          reviewedAt: new Date().toISOString(),
          reviewNotes: data.notes ?? null,
          assignedRole: data.assignRole ?? null,
          targetUserId: data.userId,
          triggeredBy: context.userId,
        });
      }
    } catch (e) {
      // Never fail the decision RPC if the email log/send fails —
      // the failure is already recorded in kyc_email_notifications.
      console.warn("KYC decision email enqueue failed:", e);
    }

    return { ok: true };
  });

// Create a short-lived signed URL for a stored KYC file. Owner or admin only.
export const getKycSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ path: z.string().min(1).max(500), forUserId: z.string().uuid().optional() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    // Only owner or admin can request
    const targetUserId = data.forUserId ?? context.userId;
    if (targetUserId !== context.userId) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Forbidden");
    }
    // The bucket path must start with the owner's uid folder — protect against poking others'
    const first = data.path.split("/")[0];
    if (first !== targetUserId) throw new Error("Path does not belong to the specified user");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("kyc-documents")
      .createSignedUrl(data.path, 300);
    if (error || !signed) throw new Error(error?.message ?? "Failed to sign URL");
    return { url: signed.signedUrl };
  });
