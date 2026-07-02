import { Users, AlertTriangle, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single link in a referral chain from immediate parent → root.
 *
 * `missing: true` means the row references a promoter_id that no longer
 * resolves to a profile (deleted/soft-deleted account). Callers should still
 * pass the raw id so admins can see the broken link explicitly.
 */
export type ReferralChainNode = {
  id: string;
  full_name: string | null;
  display_id: string | null;
  referral_code: string | null;
  role?: "promoter" | "admin" | "customer" | null;
  missing?: boolean;
};

export type ReferralChainProps = {
  /** Ordered from immediate parent (index 0) up to the root. */
  chain: ReferralChainNode[];
  className?: string;
};

/**
 * Renders the full upline (referral chain) for a customer or promoter.
 *
 * States handled:
 *   - Empty chain → "No referrer" empty state.
 *   - Single parent → one row with an "Immediate referrer" label.
 *   - Multi-level → each ancestor rendered with an arrow separator.
 *   - Missing/broken parent → row marked as "Missing parent" with a warning
 *     icon, preserving the raw id so admins can investigate.
 */
export function ReferralChain({ chain, className }: ReferralChainProps) {
  if (!chain || chain.length === 0) {
    return (
      <div
        role="status"
        aria-label="Referral chain empty"
        className={cn(
          "flex items-center gap-2 rounded border bg-muted/30 p-2 text-xs text-muted-foreground",
          className,
        )}
        data-testid="referral-chain-empty"
      >
        <Users className="h-4 w-4" aria-hidden />
        No referrer — this account was not referred by a promoter.
      </div>
    );
  }

  return (
    <ol
      aria-label="Referral chain"
      className={cn("space-y-1 rounded border bg-muted/20 p-2", className)}
      data-testid="referral-chain"
    >
      {chain.map((node, i) => (
        <li
          key={`${node.id}-${i}`}
          data-testid={node.missing ? "referral-chain-missing" : "referral-chain-node"}
          className="flex items-center gap-2 text-xs"
        >
          {i > 0 && (
            <ArrowUp
              className="h-3 w-3 shrink-0 text-muted-foreground"
              aria-label="referred by"
            />
          )}
          {node.missing ? (
            <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              <span className="font-medium">Missing parent</span>
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                ({node.id})
              </span>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">
                {i === 0 ? "Immediate referrer:" : `Level ${i + 1}:`}
              </span>
              <span className="font-medium">{node.full_name ?? "—"}</span>
              {node.display_id && (
                <span className="text-muted-foreground">({node.display_id})</span>
              )}
              {node.referral_code && (
                <code className="rounded bg-muted px-1 font-mono text-[10px]">
                  {node.referral_code}
                </code>
              )}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
