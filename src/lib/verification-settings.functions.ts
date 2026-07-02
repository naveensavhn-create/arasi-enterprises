/**
 * Verification Settings module — server functions.
 *
 * All handlers are admin-only. Credentials are stored encrypted at rest
 * (AES-256-GCM, see crypto.server.ts) and never returned to the client in
 * plaintext — the UI receives only a boolean `has_credentials` and, per
 * field, a masked preview.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  VERIFICATION_PROVIDERS,
  type VerificationType,
  type VerificationRequirement,
  buildTestForProvider,
} from "@/lib/verification-providers";

// ---------- Types (JSON-serializable across the RPC boundary) --------------

type SerializableConfigValue = string | number | boolean | null;
export type VerificationSettingRow = {
  id: string;
  verification_type: VerificationType;
  provider: string;
  enabled: boolean;
  requirement: VerificationRequirement;
  sandbox_mode: boolean;
  config: Record<string, SerializableConfigValue>;
  has_credentials: boolean;
  credential_preview: Record<string, string>;
  last_test_at: string | null;
  last_test_status: "success" | "failure" | null;
  last_test_message: string | null;
  last_test_latency_ms: number | null;
  last_success_at: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type VerificationFlowStep = {
  id: string;
  step_key: string;
  label: string;
  position: number;
  enabled: boolean;
  is_system: boolean;
};

export type VerificationDashboardEntry = {
  verification_type: VerificationType;
  provider: string;
  enabled: boolean;
  requirement: VerificationRequirement;
  sandbox_mode: boolean;
  status: "active" | "disabled" | "misconfigured";
  last_test_at: string | null;
  last_test_status: "success" | "failure" | null;
  last_test_message: string | null;
  last_success_at: string | null;
  has_credentials: boolean;
};

// ---------- Helpers --------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: any): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden: admin role required.");
}

function maskCredentialPreview(credentials: Record<string, string>): Record<string, string> {
  const preview: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value !== "string" || value.length === 0) continue;
    const trimmed = value.replace(/\s+/g, "");
    preview[key] =
      trimmed.length <= 4
        ? "•".repeat(trimmed.length)
        : `${"•".repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
  }
  return preview;
}

function bytesToPgHex(bytes: Buffer): string {
  return `\\x${bytes.toString("hex")}`;
}

function normalizeBytea(raw: unknown): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw === "string") {
    const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
    if (/^[0-9a-fA-F]*$/.test(hex) && hex.length > 0 && hex.length % 2 === 0) {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
  }
  return null;
}

async function decryptCredentials(
  payload: Uint8Array | null,
  verificationType: VerificationType,
): Promise<Record<string, string>> {
  if (!payload) return {};
  const { decryptField } = await import("@/lib/crypto.server");
  const json = decryptField(payload, `verification_settings.credentials:${verificationType}`);
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

type RawRow = {
  id: string;
  verification_type: string;
  provider: string;
  enabled: boolean;
  requirement: string;
  sandbox_mode: boolean;
  config: unknown;
  credentials: unknown;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  last_test_latency_ms: number | null;
  last_success_at: string | null;
  updated_at: string;
  updated_by: string | null;
};

async function toClientRow(raw: RawRow): Promise<VerificationSettingRow> {
  const bytes = normalizeBytea(raw.credentials);
  const decrypted = await decryptCredentials(bytes, raw.verification_type as VerificationType);
  const configIn = (raw.config ?? {}) as Record<string, unknown>;
  const config: Record<string, SerializableConfigValue> = {};
  for (const [k, v] of Object.entries(configIn)) {
    if (v == null) config[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") config[k] = v;
    else config[k] = String(v);
  }
  return {
    id: raw.id,
    verification_type: raw.verification_type as VerificationType,
    provider: raw.provider,
    enabled: raw.enabled,
    requirement: raw.requirement as VerificationRequirement,
    sandbox_mode: raw.sandbox_mode,
    config,
    has_credentials: Object.keys(decrypted).length > 0,
    credential_preview: maskCredentialPreview(decrypted),
    last_test_at: raw.last_test_at,
    last_test_status: raw.last_test_status as "success" | "failure" | null,
    last_test_message: raw.last_test_message,
    last_test_latency_ms: raw.last_test_latency_ms,
    last_success_at: raw.last_success_at,
    updated_at: raw.updated_at,
    updated_by: raw.updated_by,
  };
}

async function loadRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  verificationType: VerificationType,
): Promise<RawRow | null> {
  const { data, error } = await supabase
    .from("verification_settings")
    .select(
      "id, verification_type, provider, enabled, requirement, sandbox_mode, config, credentials, last_test_at, last_test_status, last_test_message, last_test_latency_ms, last_success_at, updated_at, updated_by",
    )
    .eq("verification_type", verificationType)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as RawRow | null) ?? null;
}

async function auditLog(
  actorId: string,
  action: string,
  metadata: Record<string, unknown>,
  reason: string,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: actor } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", actorId)
      .maybeSingle();
    await supabaseAdmin.from("admin_audit_log").insert({
      actor_id: actorId,
      actor_email: actor?.email ?? null,
      target_user_id: null,
      target_email: null,
      action,
      role_before: null,
      role_after: null,
      reason,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: metadata as any,
    });
  } catch (err) {
    console.warn("verification_settings audit log failed", err);
  }
}

// ---------- Read: dashboard --------------------------------------------------

export const getVerificationDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VerificationDashboardEntry[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("verification_settings")
      .select(
        "verification_type, provider, enabled, requirement, sandbox_mode, credentials, last_test_at, last_test_status, last_test_message, last_success_at",
      )
      .order("verification_type", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      verification_type: string;
      provider: string;
      enabled: boolean;
      requirement: string;
      sandbox_mode: boolean;
      credentials: unknown;
      last_test_at: string | null;
      last_test_status: string | null;
      last_test_message: string | null;
      last_success_at: string | null;
    }>;
    return Promise.all(
      rows.map(async (r) => {
        const bytes = normalizeBytea(r.credentials);
        const decrypted = await decryptCredentials(bytes, r.verification_type as VerificationType);
        const hasCredentials = Object.keys(decrypted).length > 0;
        const status: VerificationDashboardEntry["status"] = !r.enabled
          ? "disabled"
          : hasCredentials
            ? "active"
            : "misconfigured";
        return {
          verification_type: r.verification_type as VerificationType,
          provider: r.provider,
          enabled: r.enabled,
          requirement: r.requirement as VerificationRequirement,
          sandbox_mode: r.sandbox_mode,
          status,
          last_test_at: r.last_test_at,
          last_test_status: r.last_test_status as "success" | "failure" | null,
          last_test_message: r.last_test_message,
          last_success_at: r.last_success_at,
          has_credentials: hasCredentials,
        };
      }),
    );
  });

// ---------- Read: list -----------------------------------------------------

export const listVerificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VerificationSettingRow[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("verification_settings")
      .select(
        "id, verification_type, provider, enabled, requirement, sandbox_mode, config, credentials, last_test_at, last_test_status, last_test_message, last_test_latency_ms, last_success_at, updated_at, updated_by",
      )
      .order("verification_type", { ascending: true });
    if (error) throw new Error(error.message);
    return Promise.all(((data ?? []) as RawRow[]).map(toClientRow));
  });

// ---------- Write: upsert --------------------------------------------------

const upsertSchema = z.object({
  verification_type: z.enum(["mobile_otp", "email"]),
  provider: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  requirement: z.enum(["mandatory", "optional", "disabled"]),
  sandbox_mode: z.boolean(),
  config: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  credentials: z.record(z.string().max(4000)).default({}),
});

export const upsertVerificationSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<VerificationSettingRow> => {
    await assertAdmin(context);

    const providerDef = VERIFICATION_PROVIDERS[data.verification_type].find(
      (p) => p.id === data.provider,
    );
    if (!providerDef) {
      throw new Error(
        `Unknown provider "${data.provider}" for ${data.verification_type}. Supported: ${VERIFICATION_PROVIDERS[data.verification_type].map((p) => p.id).join(", ")}`,
      );
    }

    const cleanedConfig: Record<string, SerializableConfigValue> = {};
    for (const field of providerDef.configFields) {
      const v = data.config[field.key];
      if (v !== undefined && v !== null && v !== "") cleanedConfig[field.key] = v;
    }

    const existing = await loadRow(context.supabase, data.verification_type);
    const existingCreds = existing
      ? await decryptCredentials(normalizeBytea(existing.credentials), data.verification_type)
      : {};

    const nextCreds: Record<string, string> = { ...existingCreds };
    for (const field of providerDef.credentialFields) {
      const incoming = data.credentials[field.key];
      if (typeof incoming === "string" && incoming.length > 0) nextCreds[field.key] = incoming;
    }
    // Drop credential keys unknown to the current provider (happens on provider switch).
    for (const key of Object.keys(nextCreds)) {
      if (!providerDef.credentialFields.some((f) => f.key === key)) delete nextCreds[key];
    }

    if (data.enabled && Object.keys(nextCreds).length === 0 && providerDef.requiresCredentials) {
      throw new Error("Cannot enable this method: provider credentials are missing.");
    }

    let encryptedHex: string | null = null;
    if (Object.keys(nextCreds).length > 0) {
      const { encryptField } = await import("@/lib/crypto.server");
      const buf = encryptField(
        JSON.stringify(nextCreds),
        `verification_settings.credentials:${data.verification_type}`,
      );
      if (buf) encryptedHex = bytesToPgHex(buf);
    }

    const payload: Record<string, unknown> = {
      verification_type: data.verification_type,
      provider: data.provider,
      enabled: data.enabled,
      requirement: data.requirement,
      sandbox_mode: data.sandbox_mode,
      config: cleanedConfig,
      updated_by: context.userId,
      credentials: encryptedHex,
    };

    const { data: saved, error } = await context.supabase
      .from("verification_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: "verification_type" })
      .select(
        "id, verification_type, provider, enabled, requirement, sandbox_mode, config, credentials, last_test_at, last_test_status, last_test_message, last_test_latency_ms, last_success_at, updated_at, updated_by",
      )
      .single();
    if (error) throw new Error(error.message);

    const before = existing
      ? {
          provider: existing.provider,
          enabled: existing.enabled,
          requirement: existing.requirement,
          sandbox_mode: existing.sandbox_mode,
          config: existing.config,
          credential_keys: Object.keys(existingCreds),
        }
      : null;
    const after = {
      provider: data.provider,
      enabled: data.enabled,
      requirement: data.requirement,
      sandbox_mode: data.sandbox_mode,
      config: cleanedConfig,
      credential_keys: Object.keys(nextCreds),
    };
    await auditLog(
      context.userId,
      "verification_settings.updated",
      { verification_type: data.verification_type, before, after },
      `Updated ${data.verification_type} verification (${data.provider}, ${data.enabled ? "enabled" : "disabled"}, ${data.requirement})`,
    );

    return toClientRow(saved as RawRow);
  });

// ---------- Write: test connection -----------------------------------------

const testSchema = z.object({ verification_type: z.enum(["mobile_otp", "email"]) });

export const testVerificationConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => testSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; message: string; latency_ms: number; status_code: number | null }> => {
      await assertAdmin(context);
      const row = await loadRow(context.supabase, data.verification_type);
      if (!row) throw new Error("Verification setting not found. Save it first.");
      const providerDef = VERIFICATION_PROVIDERS[data.verification_type].find(
        (p) => p.id === row.provider,
      );
      if (!providerDef) throw new Error(`Unknown provider "${row.provider}".`);
      const credentials = await decryptCredentials(
        normalizeBytea(row.credentials),
        data.verification_type,
      );

      const request = buildTestForProvider(
        row.provider,
        credentials,
        (row.config ?? {}) as Record<string, unknown>,
      );
      const started = Date.now();
      let result: { ok: boolean; message: string; latency_ms: number; status_code: number | null };
      if (!request) {
        result = {
          ok: false,
          message:
            "No test endpoint is available for this provider from the server runtime. Configuration is stored, but connectivity must be validated on first live send.",
          latency_ms: 0,
          status_code: null,
        };
      } else {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          const resp = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: controller.signal,
          });
          clearTimeout(timer);
          const latency = Date.now() - started;
          const text = await resp.text();
          const ok = resp.ok && request.isSuccess(resp.status, text);
          result = {
            ok,
            message: ok
              ? `Provider responded ${resp.status} in ${latency} ms.`
              : `Provider returned HTTP ${resp.status}: ${text.slice(0, 200) || "no body"}`,
            latency_ms: latency,
            status_code: resp.status,
          };
        } catch (err) {
          result = {
            ok: false,
            message: err instanceof Error ? err.message : "Network error while contacting provider.",
            latency_ms: Date.now() - started,
            status_code: null,
          };
        }
      }

      const nowIso = new Date().toISOString();
      await context.supabase
        .from("verification_settings")
        .update({
          last_test_at: nowIso,
          last_test_status: result.ok ? "success" : "failure",
          last_test_message: result.message.slice(0, 500),
          last_test_latency_ms: result.latency_ms,
          ...(result.ok ? { last_success_at: nowIso } : {}),
        })
        .eq("verification_type", data.verification_type);

      await auditLog(
        context.userId,
        "verification_settings.tested",
        {
          verification_type: data.verification_type,
          provider: row.provider,
          ok: result.ok,
          latency_ms: result.latency_ms,
          status_code: result.status_code,
        },
        `Tested ${data.verification_type} provider ${row.provider} — ${result.ok ? "success" : "failure"}`,
      );
      return result;
    },
  );

// ---------- Flow steps -----------------------------------------------------

export const listVerificationFlowSteps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VerificationFlowStep[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("verification_flow_steps")
      .select("id, step_key, label, position, enabled, is_system")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as VerificationFlowStep[];
  });

const flowUpdateSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().uuid(),
        position: z.number().int().min(0).max(9999),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

export const updateVerificationFlowSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => flowUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<VerificationFlowStep[]> => {
    await assertAdmin(context);
    const { data: existing, error: exErr } = await context.supabase
      .from("verification_flow_steps")
      .select("id, step_key, is_system, enabled, position");
    if (exErr) throw new Error(exErr.message);
    const byId = new Map(
      ((existing ?? []) as Array<{ id: string; step_key: string; is_system: boolean; enabled: boolean; position: number }>).map(
        (r) => [r.id, r],
      ),
    );

    const sorted = [...data.steps].sort((a, b) => a.position - b.position);
    const changes: Array<{ id: string; position: number; enabled: boolean; updated_by: string }> = [];
    sorted.forEach((step, idx) => {
      const row = byId.get(step.id);
      if (!row) return;
      const enabled = row.is_system ? true : step.enabled;
      changes.push({
        id: step.id,
        position: (idx + 1) * 10,
        enabled,
        updated_by: context.userId,
      });
    });

    for (const change of changes) {
      const { error } = await context.supabase
        .from("verification_flow_steps")
        .update({
          position: change.position,
          enabled: change.enabled,
          updated_by: change.updated_by,
        })
        .eq("id", change.id);
      if (error) throw new Error(error.message);
    }

    await auditLog(
      context.userId,
      "verification_flow.updated",
      { steps: changes },
      `Updated verification flow (${changes.length} steps)`,
    );

    const { data: refreshed, error: rErr } = await context.supabase
      .from("verification_flow_steps")
      .select("id, step_key, label, position, enabled, is_system")
      .order("position", { ascending: true });
    if (rErr) throw new Error(rErr.message);
    return (refreshed ?? []) as VerificationFlowStep[];
  });
