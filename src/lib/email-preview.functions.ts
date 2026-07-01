import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  kind: z.enum(["promote", "revoke"]),
  recipientName: z.string().trim().max(120).optional(),
  actorName: z.string().trim().max(120).optional(),
  actorEmail: z.string().trim().email().max(255).optional(),
  previousRole: z.enum(["admin", "promoter", "customer"]).optional(),
  newRole: z.enum(["admin", "promoter", "customer"]).optional(),
  changedAt: z.string().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const renderRoleChangeEmailPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) throw new Error(error.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const React = await import("react");
    const { render } = await import("@react-email/render");

    const changedAt = data.changedAt ?? new Date().toISOString();
    const previousRole = data.previousRole ?? (data.kind === "promote" ? "customer" : "admin");
    const newRole = data.newRole ?? (data.kind === "promote" ? "admin" : "customer");
    const reason =
      data.reason ??
      (data.kind === "promote"
        ? "Trusted operator — needs admin access to manage plans and memberships."
        : "Role rotation as part of quarterly access review.");

    const common = {
      recipientName: data.recipientName ?? "Priya Sharma",
      actorName: data.actorName ?? "Arjun Verma",
      actorEmail: data.actorEmail ?? "arjun@arasienterprises.com",
      previousRole,
      newRole,
      changedAt,
      reason,
    };

    let html: string;
    let subject: string;
    if (data.kind === "promote") {
      const mod = await import("@/lib/email-templates/admin-role-promoted");
      html = await render(React.createElement(mod.default, common));
      subject = "[ARASI Enterprises] Your role has been upgraded";
    } else {
      const mod = await import("@/lib/email-templates/admin-role-revoked");
      html = await render(React.createElement(mod.default, common));
      subject = "[ARASI Enterprises] Your admin access has been revoked";
    }

    return { html, subject, sample: common };
  });
