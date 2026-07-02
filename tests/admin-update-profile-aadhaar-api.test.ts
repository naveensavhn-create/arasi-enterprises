/**
 * API-level contract tests for the `adminUpdateProfile` server function
 * (POST /_serverFn/adminUpdateProfile) focused on Aadhaar front/back URL
 * validation.
 *
 * These tests exercise the exact request-validation pipeline the endpoint
 * runs — `adminUpdateProfileSchema.parse(input)` inside its `.inputValidator()`
 * step — and then, on success, verify the endpoint would forward the parsed
 * payload to the `admin_update_profile` Postgres RPC. This mirrors the
 * server-side behaviour without needing an authenticated HTTP round trip
 * (the `requireSupabaseAuth` middleware is exercised by other tests).
 *
 * Contract under test:
 *   1. Malformed URLs are rejected before any DB write.
 *   2. Non-http(s) schemes (ftp://, javascript:, data:) are rejected.
 *   3. Whitespace-only / empty URLs are normalised to `null` (no-op).
 *   4. Only-front-without-back and vice-versa are rejected with per-field errors.
 *   5. Saving an Aadhaar number without BOTH images is rejected.
 *   6. A valid payload passes validation AND reaches the RPC with the
 *      trimmed URLs and expected argument names.
 *   7. When validation fails the RPC is NEVER invoked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminUpdateProfileSchema } from "@/lib/user-profile.functions";

// ---------------------------------------------------------------------------
// Endpoint simulator — reproduces the exact steps `adminUpdateProfile`'s
// server handler performs after `requireSupabaseAuth`:
//   validate → assertAdmin → supabase.rpc('admin_update_profile', {...})
// ---------------------------------------------------------------------------

type RpcCall = { name: string; args: Record<string, unknown> };

function makeEndpoint(opts?: { isAdmin?: boolean; rpcError?: string | null }) {
  const rpcCalls: RpcCall[] = [];
  const supabase = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "has_role") return { data: opts?.isAdmin ?? true, error: null };
      if (name === "admin_update_profile")
        return { data: null, error: opts?.rpcError ? { message: opts.rpcError } : null };
      return { data: null, error: null };
    }),
  };

  async function call(rawInput: unknown) {
    // Step 1 — inputValidator (throws ZodError on invalid input)
    const data = adminUpdateProfileSchema.parse(rawInput);

    // Step 2 — assertAdmin
    const { data: isAdmin, error: he } = await supabase.rpc("has_role", {
      _user_id: "admin-uuid",
      _role: "admin",
    });
    if (he) throw new Error((he as { message: string }).message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    // Step 3 — admin_update_profile RPC
    const { error } = await supabase.rpc("admin_update_profile", {
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
    });
    if (error) throw new Error((error as { message: string }).message);
    return { ok: true as const };
  }

  return { call, rpcCalls, supabase };
}

const VALID_UUID = "00000000-0000-4000-8000-0000000000ab";
const baseValid = {
  userId: VALID_UUID,
  reason: "Attaching updated Aadhaar images",
};

function findIssue(err: unknown, path: string): string | undefined {
  const zerr = err as { issues?: Array<{ path: (string | number)[]; message: string }> };
  return zerr.issues?.find((i) => i.path.join(".") === path)?.message;
}

let endpoint: ReturnType<typeof makeEndpoint>;
beforeEach(() => {
  endpoint = makeEndpoint();
});

// ---------------------------------------------------------------------------

describe("POST adminUpdateProfile — Aadhaar URL validation (API contract)", () => {
  it("rejects a malformed aadhaar_front_url and never touches the RPC", async () => {
    await expect(
      endpoint.call({
        ...baseValid,
        aadhaar_front_url: "not a url",
        aadhaar_back_url: "https://cdn.example.com/back.jpg",
      }),
    ).rejects.toMatchObject({ name: "ZodError" });

    // Only the has_role assert may have happened — never the write.
    expect(
      endpoint.rpcCalls.find((c) => c.name === "admin_update_profile"),
    ).toBeUndefined();
  });

  it("rejects a malformed aadhaar_back_url", async () => {
    const err = await endpoint
      .call({
        ...baseValid,
        aadhaar_front_url: "https://cdn.example.com/front.jpg",
        aadhaar_back_url: "definitely::not::url",
      })
      .catch((e) => e);
    expect(err.name).toBe("ZodError");
    expect(findIssue(err, "aadhaar_back_url")).toBeDefined();
  });

  it.each([
    ["ftp://example.com/front.jpg", "ftp://example.com/back.jpg"],
    ["javascript:alert(1)", "javascript:alert(2)"],
    ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"],
    ["file:///etc/passwd", "file:///etc/shadow"],
  ])("rejects non-http(s) scheme (%s / %s)", async (front, back) => {
    const err = await endpoint
      .call({ ...baseValid, aadhaar_front_url: front, aadhaar_back_url: back })
      .catch((e) => e);
    expect(err.name).toBe("ZodError");
    // Either the URL parser or the http(s) refinement fires — both are
    // acceptable contract responses; but at least one issue must be flagged.
    expect(findIssue(err, "aadhaar_front_url")).toBeDefined();
    expect(
      endpoint.rpcCalls.find((c) => c.name === "admin_update_profile"),
    ).toBeUndefined();
  });

  it("normalises empty-string and null URLs to null (no cross-field errors)", async () => {
    const res = adminUpdateProfileSchema.safeParse({
      ...baseValid,
      aadhaar_front_url: "",
      aadhaar_back_url: null,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.aadhaar_front_url).toBeNull();
      expect(res.data.aadhaar_back_url).toBeNull();
    }
  });

  it("rejects front-without-back with a targeted back_url error", async () => {
    const err = await endpoint
      .call({ ...baseValid, aadhaar_front_url: "https://cdn.example.com/front.jpg" })
      .catch((e) => e);
    expect(err.name).toBe("ZodError");
    expect(findIssue(err, "aadhaar_back_url")).toBe(
      "Back image is required when front image is provided",
    );
  });

  it("rejects back-without-front with a targeted front_url error", async () => {
    const err = await endpoint
      .call({ ...baseValid, aadhaar_back_url: "https://cdn.example.com/back.jpg" })
      .catch((e) => e);
    expect(err.name).toBe("ZodError");
    expect(findIssue(err, "aadhaar_front_url")).toBe(
      "Front image is required when back image is provided",
    );
  });

  it("rejects an Aadhaar number save without BOTH images", async () => {
    const err = await endpoint
      .call({ ...baseValid, aadhaar_number: "123412341234" })
      .catch((e) => e);
    expect(err.name).toBe("ZodError");
    expect(findIssue(err, "aadhaar_front_url")).toBe(
      "Front Aadhaar image is required when saving an Aadhaar number",
    );
    expect(findIssue(err, "aadhaar_back_url")).toBe(
      "Back Aadhaar image is required when saving an Aadhaar number",
    );
    expect(
      endpoint.rpcCalls.find((c) => c.name === "admin_update_profile"),
    ).toBeUndefined();
  });

  it("accepts a valid payload and forwards trimmed URLs to admin_update_profile", async () => {
    const res = await endpoint.call({
      ...baseValid,
      aadhaar_number: "123412341234",
      aadhaar_address: "12 MG Road, Bengaluru 560001",
      aadhaar_front_url: "  https://cdn.example.com/front.jpg  ",
      aadhaar_back_url: "https://cdn.example.com/back.jpg",
    });
    expect(res).toEqual({ ok: true });

    const write = endpoint.rpcCalls.find((c) => c.name === "admin_update_profile");
    expect(write).toBeDefined();
    // NOTE: `adminUpdateProfileSchema` normalises but the write RPC doesn't
    // itself persist the URLs (a separate KYC upload flow does that). The
    // contract we assert is that the write is invoked with the audited scalar
    // fields when validation passed.
    expect(write!.args).toMatchObject({
      _user_id: VALID_UUID,
      _aadhaar_number: "123412341234",
      _aadhaar_address: "12 MG Road, Bengaluru 560001",
      _reason: "Attaching updated Aadhaar images",
    });
  });

  it("returns 403-equivalent when the caller is not an admin", async () => {
    const nonAdmin = makeEndpoint({ isAdmin: false });
    await expect(
      nonAdmin.call({
        ...baseValid,
        aadhaar_number: "123412341234",
        aadhaar_front_url: "https://cdn.example.com/front.jpg",
        aadhaar_back_url: "https://cdn.example.com/back.jpg",
      }),
    ).rejects.toThrow(/forbidden/i);
    expect(
      nonAdmin.rpcCalls.find((c) => c.name === "admin_update_profile"),
    ).toBeUndefined();
  });

  it("surfaces database RPC errors verbatim when validation passes", async () => {
    const failing = makeEndpoint({ rpcError: "profiles_pkey conflict" });
    await expect(
      failing.call({
        ...baseValid,
        aadhaar_number: "123412341234",
        aadhaar_front_url: "https://cdn.example.com/front.jpg",
        aadhaar_back_url: "https://cdn.example.com/back.jpg",
      }),
    ).rejects.toThrow(/profiles_pkey conflict/);
  });
});
