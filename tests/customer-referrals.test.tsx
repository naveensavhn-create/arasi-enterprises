// @vitest-environment jsdom
/**
 * Unit tests for the customer portal's /customer/referrals page.
 *
 * Verifies:
 *   - The referral code is derived from the signed-in session user id
 *     (first 8 chars, uppercased).
 *   - The referral URL is generated against window.location.origin.
 *   - Both "Copy" buttons write the appropriate value to the clipboard
 *     and show a success toast.
 *   - The "Your referrals" list renders its empty-state message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const OWNER_ID = "abcdef12-3456-7890-abcd-ef1234567890";
const EXPECTED_CODE = OWNER_ID.slice(0, 8).toUpperCase(); // "ABCDEF12"

vi.mock("@/lib/auth", () => ({
  useSession: () => ({ session: { user: { id: OWNER_ID, email: "c@example.com" } } }),
}));

const successToast = vi.fn();
const errorToast = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => successToast(...a), error: (...a: unknown[]) => errorToast(...a) },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

// Import after mocks so the route module picks them up.
import { Route } from "@/routes/_authenticated/customer/referrals";

// `Route` here is the options object returned by our mocked createFileRoute.
const CustomerReferralsPage = (Route as unknown as { component: () => JSX.Element }).component;

const writeText = vi.fn(async () => undefined);
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText },
});

beforeEach(() => {
  successToast.mockClear();
  errorToast.mockClear();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("Customer referrals page", () => {
  it("derives the referral code from the session user id", () => {
    render(<CustomerReferralsPage />);
    const codeInput = screen.getAllByDisplayValue(EXPECTED_CODE)[0] as HTMLInputElement;
    expect(codeInput).toBeTruthy();
    expect(codeInput.readOnly).toBe(true);
  });

  it("generates the share URL against window.location.origin", () => {
    render(<CustomerReferralsPage />);
    const expectedUrl = `${window.location.origin}/?ref=${EXPECTED_CODE}`;
    const linkInput = screen.getByDisplayValue(expectedUrl) as HTMLInputElement;
    expect(linkInput).toBeTruthy();
    expect(linkInput.readOnly).toBe(true);
  });

  it("copies the code and URL to the clipboard from their respective buttons", async () => {
    const user = userEvent.setup();
    render(<CustomerReferralsPage />);

    const copyButtons = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-copy") !== null);
    // First = code, second = URL (in DOM order).
    await user.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(EXPECTED_CODE);

    await user.click(copyButtons[1]);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      `${window.location.origin}/?ref=${EXPECTED_CODE}`,
    );

    expect(successToast).toHaveBeenCalledWith("Copied to clipboard");
    expect(successToast).toHaveBeenCalledTimes(2);
  });

  it("renders the referral list section with its empty-state message", () => {
    render(<CustomerReferralsPage />);
    expect(screen.getByText(/your referrals/i)).toBeTruthy();
    expect(
      screen.getByText(/referral tracking will show here/i),
    ).toBeTruthy();
  });
});
