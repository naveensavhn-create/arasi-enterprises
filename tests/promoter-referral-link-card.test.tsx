// @vitest-environment jsdom
/**
 * Unit tests for the promoter portal's <PromoterReferralLinkCard />.
 *
 * Verifies:
 *   - The referral URL returned by getMyPromoterReferral is rendered
 *     verbatim inside the card (link generation surface).
 *   - The referral code and referred-count badge render.
 *   - Clicking "Copy link" writes the URL to navigator.clipboard and
 *     surfaces a success toast.
 *   - Clicking the code copy button writes the plain code (not the URL).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const successToast = vi.fn();
const errorToast = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => successToast(...a), error: (...a: unknown[]) => errorToast(...a) },
}));

const FIXTURE = {
  display_id: "12345",
  referral_code: "ABCD1234EF",
  referral_url: "https://app.example.com/auth?portal=customer&mode=signup&ref=ABCD1234EF",
  referred_count: 7,
};

vi.mock("@/lib/user-profile.functions", () => ({
  getMyPromoterReferral: vi.fn(),
}));

const fnSpy = vi.fn(async () => FIXTURE);
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => fnSpy,
}));

import { PromoterReferralLinkCard } from "@/components/promoter/PromoterReferralLinkCard";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PromoterReferralLinkCard />
    </QueryClientProvider>,
  );
}

const writeText = vi.fn(async () => undefined);
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText },
});

beforeEach(() => {
  fnSpy.mockClear();
  successToast.mockClear();
  errorToast.mockClear();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("PromoterReferralLinkCard", () => {
  it("renders the generated referral URL, code, ID and referred count", async () => {
    renderCard();
    expect(await screen.findByText(FIXTURE.referral_url)).toBeTruthy();
    expect(screen.getByText(FIXTURE.referral_code)).toBeTruthy();
    expect(screen.getByText(`ID ${FIXTURE.display_id}`)).toBeTruthy();
    expect(screen.getByText(`${FIXTURE.referred_count} referred`)).toBeTruthy();
  });

  it("copies the referral URL to the clipboard on 'Copy link'", async () => {
    const user = userEvent.setup();
    renderCard();
    const btn = await screen.findByRole("button", { name: /copy link/i });
    await user.click(btn);
    expect(writeText).toHaveBeenCalledWith(FIXTURE.referral_url);
    expect(successToast).toHaveBeenCalledWith("Link copied");
  });

  it("copies the raw referral code (not the URL) on the code button", async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(FIXTURE.referral_code);
    // The code section has a small ghost copy button; pick the last copy button.
    const copyButtons = screen.getAllByRole("button").filter((b) =>
      b.querySelector("svg.lucide-copy") !== null,
    );
    const codeCopy = copyButtons[copyButtons.length - 1];
    await user.click(codeCopy);
    expect(writeText).toHaveBeenCalledWith(FIXTURE.referral_code);
    expect(successToast).toHaveBeenCalledWith("Code copied");
  });

  it("surfaces an error toast if the clipboard write fails", async () => {
    (writeText as any) = vi.fn(async () => { throw new Error("denied"); });
    const user = userEvent.setup();
    renderCard();
    const btn = await screen.findByRole("button", { name: /copy link/i });
    await user.click(btn);
    expect(errorToast).toHaveBeenCalledWith("Copy failed");
  });
});
