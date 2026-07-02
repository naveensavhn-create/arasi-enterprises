import { describe, it, expect } from "vitest";
import { adminUpdateProfileSchema } from "@/lib/user-profile.functions";

const base = {
  userId: "00000000-0000-4000-8000-000000000000",
  reason: "Updating contact info",
};

function parse(input: Record<string, unknown>) {
  return adminUpdateProfileSchema.safeParse({ ...base, ...input });
}

function errorFor(res: ReturnType<typeof parse>, path: string): string | undefined {
  if (res.success) return undefined;
  return res.error.issues.find((i) => i.path.join(".") === path)?.message;
}

describe("adminUpdateProfileSchema — email validation", () => {
  it.each([
    ["plainstring"],
    ["missing@tld"],
    ["@nouser.com"],
    ["user@.com"],
    ["user@domain"],
    ["user name@domain.com"],
    ["fake@fake"],
  ])("rejects invalid email %s", (email) => {
    const res = parse({ email, phone: "9876543210" });
    expect(res.success).toBe(false);
    expect(errorFor(res, "email")).toBe("Invalid email address");
  });

  it("accepts a valid email", () => {
    const res = parse({ email: "user@example.com", phone: "9876543210" });
    expect(res.success).toBe(true);
  });

  it("treats empty string and null as no-change (nullable)", () => {
    for (const email of ["", null]) {
      const res = parse({ email, phone: "9876543210" });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.email).toBeNull();
    }
  });
});

describe("adminUpdateProfileSchema — phone validation", () => {
  it.each([
    ["123456789"], // 9 digits — too short
    ["98765"],
    ["abcdefghij"],
    ["12-34-56"],
    ["+91 98765"], // 7 digits after normalization
    ["1234567890123456"], // 16 digits — too long
  ])("rejects invalid phone %s", (phone) => {
    const res = parse({ email: "u@example.com", phone });
    expect(res.success).toBe(false);
    expect(errorFor(res, "phone")).toBe("Phone must be 10–15 digits (optional leading +)");
  });

  it.each([
    ["9876543210"],
    ["+919876543210"],
    ["+1 415 555 0132"],
    ["415-555-0132"],
  ])("accepts valid phone %s", (phone) => {
    const res = parse({ email: "u@example.com", phone });
    expect(res.success).toBe(true);
  });

  it("treats empty and null phone as no-change", () => {
    for (const phone of ["", null]) {
      const res = parse({ email: "u@example.com", phone });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.phone).toBeNull();
    }
  });
});

describe("adminUpdateProfileSchema — reason and combined failures", () => {
  it("requires a reason of at least 5 chars", () => {
    const res = adminUpdateProfileSchema.safeParse({
      userId: base.userId,
      reason: "hi",
      email: "u@example.com",
      phone: "9876543210",
    });
    expect(res.success).toBe(false);
    expect(errorFor(res, "reason")).toMatch(/min 5 characters/i);
  });

  it("surfaces both email and phone errors together", () => {
    const res = parse({ email: "not-an-email", phone: "123456789" });
    expect(res.success).toBe(false);
    expect(errorFor(res, "email")).toBe("Invalid email address");
    expect(errorFor(res, "phone")).toBe("Phone must be 10–15 digits (optional leading +)");
  });
});
