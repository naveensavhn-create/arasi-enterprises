// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { ReferralChain, type ReferralChainNode } from "@/components/admin/ReferralChain";

afterEach(() => cleanup());

const promoter = (
  overrides: Partial<ReferralChainNode> & Pick<ReferralChainNode, "id">,
): ReferralChainNode => ({
  id: overrides.id,
  full_name: overrides.full_name ?? "Anon Promoter",
  display_id: overrides.display_id ?? null,
  referral_code: overrides.referral_code ?? null,
  role: overrides.role ?? "promoter",
  missing: overrides.missing,
});

describe("ReferralChain", () => {
  it("renders the empty state when no referrer exists", () => {
    render(<ReferralChain chain={[]} />);
    const empty = screen.getByTestId("referral-chain-empty");
    expect(empty).toBeTruthy();
    expect(empty.getAttribute("role")).toBe("status");
    expect(empty.textContent ?? "").toMatch(/no referrer/i);
    expect(screen.queryByTestId("referral-chain")).toBeNull();
  });

  it("renders a single immediate referrer with display id and code", () => {
    render(
      <ReferralChain
        chain={[
          promoter({
            id: "u1",
            full_name: "Priya Sharma",
            display_id: "PR-10023",
            referral_code: "PRIYA10",
          }),
        ]}
      />,
    );
    const list = screen.getByTestId("referral-chain");
    const nodes = within(list).getAllByTestId("referral-chain-node");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].textContent).toMatch(/Immediate referrer:/);
    expect(nodes[0].textContent).toMatch(/Priya Sharma/);
    expect(nodes[0].textContent).toMatch(/PR-10023/);
    expect(nodes[0].textContent).toMatch(/PRIYA10/);
  });

  it("renders a full multi-level chain in order with level labels", () => {
    render(
      <ReferralChain
        chain={[
          promoter({ id: "L1", full_name: "Level One", display_id: "PR-1" }),
          promoter({ id: "L2", full_name: "Level Two", display_id: "PR-2" }),
          promoter({ id: "L3", full_name: "Level Three", display_id: "PR-3" }),
        ]}
      />,
    );
    const list = screen.getByTestId("referral-chain");
    const nodes = within(list).getAllByTestId("referral-chain-node");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].textContent).toMatch(/Immediate referrer:/);
    expect(nodes[0].textContent).toMatch(/Level One/);
    expect(nodes[1].textContent).toMatch(/Level 2:/);
    expect(nodes[1].textContent).toMatch(/Level Two/);
    expect(nodes[2].textContent).toMatch(/Level 3:/);
    expect(nodes[2].textContent).toMatch(/Level Three/);
    // Order preserved as passed (immediate → root).
    const idxOne = nodes[0].textContent!.indexOf("Level One");
    const idxTwo = nodes[1].textContent!.indexOf("Level Two");
    expect(idxOne).toBeGreaterThanOrEqual(0);
    expect(idxTwo).toBeGreaterThanOrEqual(0);
  });

  it("marks broken links as Missing parent and preserves the raw id", () => {
    render(
      <ReferralChain
        chain={[
          promoter({ id: "L1", full_name: "Priya Sharma", display_id: "PR-1" }),
          {
            id: "deleted-uuid-1234",
            full_name: null,
            display_id: null,
            referral_code: null,
            missing: true,
          },
        ]}
      />,
    );
    const missing = screen.getByTestId("referral-chain-missing");
    expect(missing.textContent).toMatch(/Missing parent/i);
    expect(missing.textContent).toMatch(/deleted-uuid-1234/);
    // Regular node still present alongside broken link.
    expect(screen.getAllByTestId("referral-chain-node")).toHaveLength(1);
  });

  it("falls back to em dash when a node has no name", () => {
    render(
      <ReferralChain
        chain={[
          { id: "u1", full_name: null, display_id: null, referral_code: null },
        ]}
      />,
    );
    const node = screen.getByTestId("referral-chain-node");
    expect(node.textContent).toMatch(/—/);
  });

  it("exposes an accessible list label", () => {
    render(<ReferralChain chain={[promoter({ id: "u1" })]} />);
    expect(screen.getByLabelText("Referral chain")).toBeTruthy();
  });
});
