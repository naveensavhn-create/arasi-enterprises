import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReferralChainNode = {
  id: string;
  full_name: string | null;
  display_id: string | null;
  referral_code: string | null;
  role: "promoter" | "customer" | "admin" | "unknown";
  /** True when the parent id was set on the child but no matching profile could be loaded. */
  missing?: boolean;
};

export type ReferralChainResult = {
  /** The user the chain was requested for. */
  subject: {
    id: string;
    full_name: string | null;
    role: "promoter" | "customer" | "admin" | "unknown";
    has_referrer: boolean;
  };
  /** Chain from the immediate referrer (index 0) up to the root ancestor. */
  chain: ReferralChainNode[];
  /** True when the walk stopped because of a cycle. */
  truncated_cycle: boolean;
  /** True when the walk hit the safety depth cap. */
  truncated_depth: boolean;
};

const MAX_DEPTH = 32;

const input = z.object({
  userId: z.string().uuid("Invalid user id"),
});

export const getReferralChain = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => input.parse(raw))
  .handler(async ({ data, context }): Promise<ReferralChainResult> => {
    const supabase = context.supabase;

    // AuthZ: admin OR the subject themselves.
    if (data.userId !== context.userId) {
      const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (roleErr) throw new Error(roleErr.message);
      if (!isAdmin) throw new Error("Forbidden");
    }

    const { data: subject, error: subjErr } = await supabase
      .from("profiles")
      .select("id, full_name, referred_by_promoter_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (subjErr) throw new Error(subjErr.message);
    if (!subject) throw new Error("User not found");

    // Resolve subject role.
    const subjectRole = await resolveRole(supabase, subject.id);

    const result: ReferralChainResult = {
      subject: {
        id: subject.id,
        full_name: subject.full_name ?? null,
        role: subjectRole,
        has_referrer: !!subject.referred_by_promoter_id,
      },
      chain: [],
      truncated_cycle: false,
      truncated_depth: false,
    };

    let cursor: string | null = subject.referred_by_promoter_id ?? null;
    const seen = new Set<string>([subject.id]);

    while (cursor) {
      if (seen.has(cursor)) {
        result.truncated_cycle = true;
        break;
      }
      if (result.chain.length >= MAX_DEPTH) {
        result.truncated_depth = true;
        break;
      }
      seen.add(cursor);

      const [{ data: parent, error: pErr }, { data: idRow, error: idErr }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, referred_by_promoter_id")
            .eq("id", cursor)
            .maybeSingle(),
          supabase
            .from("promoter_ids")
            .select("display_id, referral_code")
            .eq("user_id", cursor)
            .maybeSingle(),
        ]);
      if (pErr) throw new Error(pErr.message);
      if (idErr) throw new Error(idErr.message);

      if (!parent) {
        result.chain.push({
          id: cursor,
          full_name: null,
          display_id: null,
          referral_code: null,
          role: "unknown",
          missing: true,
        });
        break;
      }

      const role = await resolveRole(supabase, parent.id);
      result.chain.push({
        id: parent.id,
        full_name: parent.full_name ?? null,
        display_id: idRow?.display_id ?? null,
        referral_code: idRow?.referral_code ?? null,
        role,
      });

      cursor = parent.referred_by_promoter_id ?? null;
    }

    return result;
  });

async function resolveRole(
  supabase: any,
  userId: string,
): Promise<ReferralChainNode["role"]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) return "unknown";
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  if (roles.includes("admin")) return "admin";
  if (roles.includes("promoter")) return "promoter";
  if (roles.includes("customer")) return "customer";
  return "unknown";
}
