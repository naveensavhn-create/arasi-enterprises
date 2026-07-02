/**
 * Locks the assigned-role badge label mapping used across KYC UIs.
 *
 * The `role` on a profile is the `public.app_role` enum
 * (`admin` | `promoter` | `customer`). The badge shown to admins and to
 * approved users must render human-friendly labels:
 *   admin    → "Administrator"
 *   promoter → "Promoter"
 *   customer → "Customer"
 *
 * Guards against typos ("Admin", "Cust", i18n placeholders) and drift if
 * the enum ever grows a new variant without a matching label.
 */

import { describe, expect, it } from "vitest";
import { ROLE_LABEL } from "@/components/kyc/KycStatusCard";
import type { AppRole } from "@/lib/kyc-audit";

describe("ROLE_LABEL (KYC assigned-role badge)", () => {
  it.each<[AppRole, string]>([
    ["admin", "Administrator"],
    ["promoter", "Promoter"],
    ["customer", "Customer"],
  ])("maps %s → %s", (role, label) => {
    expect(ROLE_LABEL[role]).toBe(label);
  });

  it("covers every app_role enum variant exactly once", () => {
    const roles: AppRole[] = ["admin", "promoter", "customer"];
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...roles].sort());
  });

  it("never falls back to the raw enum value", () => {
    for (const [key, label] of Object.entries(ROLE_LABEL)) {
      expect(label).not.toBe(key);
      expect(label.length).toBeGreaterThan(0);
      // Labels are Capitalized display strings, not enum tokens.
      expect(label[0]).toBe(label[0]?.toUpperCase());
    }
  });
});
