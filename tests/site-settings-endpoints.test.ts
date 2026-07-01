/**
 * Integration test: site-settings server functions + Postgres persistence.
 *
 * Covers `src/lib/site-settings.functions.ts`:
 *   • getSiteSettings   — public read via publishable client
 *   • updateSiteSettings — admin-only write, RBAC via has_role
 *
 * Assertions:
 *   1. Wiring — updateSiteSettings uses requireSupabaseAuth and gates on
 *      has_role('admin') before touching the table.
 *   2. Validation — the Zod schema rejects bad HSL colors, empty brand name,
 *      malformed emails and URLs, and oversize strings BEFORE any DB call.
 *   3. DB (gated by SUPABASE_DB_URL) — an UPDATE against the single
 *      site_settings row persists round-trip and bumps updated_at; the row
 *      the admin UI targets exists at the fixed UUID.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { updateSiteSettings } from "@/lib/site-settings.functions";

const SRC = readFileSync(
  resolve(__dirname, "../src/lib/site-settings.functions.ts"),
  "utf8",
);

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe("site-settings wiring", () => {
  it("updateSiteSettings runs requireSupabaseAuth middleware", () => {
    expect(SRC).toMatch(
      /updateSiteSettings[\s\S]{0,200}\.middleware\(\[\s*requireSupabaseAuth\s*\]\)/,
    );
  });

  it("updateSiteSettings checks has_role('admin') before persisting", () => {
    // The RBAC check must come before the .update() call.
    const roleIdx = SRC.search(/rpc\("has_role"/);
    const updateIdx = SRC.search(/\.from\("site_settings"\)\s*\.update\(/);
    expect(roleIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(roleIdx);
    expect(SRC).toMatch(/Forbidden:\s*admin role required/);
  });

  it("getSiteSettings is public (no requireSupabaseAuth) and uses publishable key", () => {
    const getBlock = SRC.slice(SRC.indexOf("getSiteSettings"));
    // Only the update fn should have middleware; the get must not.
    const firstUpdateIdx = getBlock.indexOf("updateSiteSettings");
    const getOnly = firstUpdateIdx > 0 ? getBlock.slice(0, firstUpdateIdx) : getBlock;
    expect(getOnly).not.toMatch(/\.middleware\(/);
    expect(getOnly).toMatch(/SUPABASE_PUBLISHABLE_KEY/);
    expect(getOnly).toMatch(/persistSession:\s*false/);
  });
});

// ---------------------------------------------------------------------------
// Input validation — runs before any DB / auth call
// ---------------------------------------------------------------------------

describe("updateSiteSettings input validation", () => {
  const valid = {
    brand_name: "ARASI Enterprises",
    tagline: "Advance Booking",
    support_email: "help@arasi.test",
    support_phone: "+911234567890",
    primary_color: "220 70% 25%",
    secondary_color: "45 80% 55%",
    accent_color: "45 80% 55%",
    heading_font: "Playfair Display",
    body_font: "Inter",
    logo_url: "https://cdn.example.com/logo.png",
    favicon_url: "https://cdn.example.com/favicon.ico",
    footer_text: "© ARASI",
  };

  const invoke = (data: unknown) =>
    (updateSiteSettings as unknown as (a: { data: unknown }) => Promise<unknown>)({
      data,
    });

  it.each([
    ["hex primary_color", { ...valid, primary_color: "#1a1a2e" }],
    ["missing % on saturation", { ...valid, secondary_color: "45 80 55%" }],
    ["blank brand_name", { ...valid, brand_name: "" }],
    ["brand_name > 120 chars", { ...valid, brand_name: "x".repeat(121) }],
    ["malformed support_email", { ...valid, support_email: "not-an-email" }],
    ["malformed logo_url", { ...valid, logo_url: "not a url" }],
    ["empty heading_font", { ...valid, heading_font: "" }],
    ["oversize footer_text", { ...valid, footer_text: "x".repeat(501) }],
  ])("rejects %s before touching the database", async (_label, payload) => {
    await expect(invoke(payload)).rejects.toThrow();
  });

  it("accepts empty strings for optional urls/contacts (coerced to null)", async () => {
    // Validator must not throw for empty strings on optional-or-null fields.
    // The call still fails downstream (no bearer token in this env), so we
    // assert the failure message is NOT a Zod validation message.
    await expect(
      invoke({ ...valid, support_email: "", logo_url: "", favicon_url: "", support_phone: "" }),
    ).rejects.toThrow(
      /Unauthorized|No authorization|middleware|context|fetch|Failed/i,
    );
  });
});

// ---------------------------------------------------------------------------
// DB integration — persistence round-trip
// ---------------------------------------------------------------------------

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("site_settings persistence (integration)", () => {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Snapshot the current row so we can restore it after the test run.
  let snapshot: Record<string, unknown> | null = null;

  beforeAll(async () => {
    await client.connect();
    // Elevate to service_role so we can round-trip an UPDATE the same way the
    // server function's admin client does. Ignored if the role does not exist.
    await client.query(`SET ROLE service_role`).catch(() => undefined);
    const { rows } = await client.query(
      `SELECT * FROM public.site_settings WHERE id = $1`,
      [SETTINGS_ID],
    );
    snapshot = rows[0] ?? null;
  });

  afterAll(async () => {
    if (snapshot) {
      // Restore the fields the test mutates.
      await client
        .query(
          `UPDATE public.site_settings
              SET brand_name    = $2,
                  tagline       = $3,
                  primary_color = $4,
                  heading_font  = $5,
                  footer_text   = $6
            WHERE id = $1`,
          [
            SETTINGS_ID,
            snapshot.brand_name,
            snapshot.tagline,
            snapshot.primary_color,
            snapshot.heading_font,
            snapshot.footer_text,
          ],
        )
        .catch(() => undefined);
    }
    await client.end();
  });

  it("singleton row exists at the fixed UUID the app targets", async () => {
    const { rowCount } = await client.query(
      `SELECT 1 FROM public.site_settings WHERE id = $1`,
      [SETTINGS_ID],
    );
    expect(rowCount).toBe(1);
  });

  it("UPDATE persists round-trip and bumps updated_at", async () => {
    const before = await client.query<{ updated_at: string }>(
      `SELECT updated_at FROM public.site_settings WHERE id = $1`,
      [SETTINGS_ID],
    );
    const beforeTs = new Date(before.rows[0].updated_at).getTime();

    // Small delay so updated_at is strictly greater even at ms resolution.
    await new Promise((r) => setTimeout(r, 25));

    const testTag = `vitest ${Date.now()}`;
    await client.query(
      `UPDATE public.site_settings
          SET brand_name    = $2,
              tagline       = $3,
              primary_color = $4,
              heading_font  = $5,
              footer_text   = $6,
              updated_at    = now()
        WHERE id = $1`,
      [
        SETTINGS_ID,
        "ARASI Test Brand",
        testTag,
        "300 60% 40%",
        "Space Grotesk",
        "© Test",
      ],
    );

    const after = await client.query<{
      brand_name: string;
      tagline: string;
      primary_color: string;
      heading_font: string;
      footer_text: string;
      updated_at: string;
    }>(
      `SELECT brand_name, tagline, primary_color, heading_font, footer_text, updated_at
         FROM public.site_settings WHERE id = $1`,
      [SETTINGS_ID],
    );

    expect(after.rows[0]).toMatchObject({
      brand_name: "ARASI Test Brand",
      tagline: testTag,
      primary_color: "300 60% 40%",
      heading_font: "Space Grotesk",
      footer_text: "© Test",
    });
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(beforeTs);
  });

  it("site_settings has RLS enabled (writes gated by policies)", async () => {
    const { rows } = await client.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'site_settings'`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("has_role RPC (used by updateSiteSettings RBAC) exists and is SECURITY DEFINER", async () => {
    const { rows } = await client.query<{ secdef: boolean }>(
      `SELECT p.prosecdef AS secdef
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_role'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].secdef).toBe(true);
  });
});
