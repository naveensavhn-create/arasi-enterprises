import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import type { AppRole } from "@/lib/auth";

type NavTarget = {
  label: string;
  to: string;
  keywords?: string;
  group: string;
  roles: AppRole[];
};

const TARGETS: NavTarget[] = [
  // Admin
  { label: "Customers", to: "/admin/customers", group: "People", roles: ["admin"], keywords: "users members" },
  { label: "Promoters", to: "/admin/promoters", group: "People", roles: ["admin"] },
  { label: "Plans", to: "/admin/plans", group: "Catalog", roles: ["admin"], keywords: "membership pricing" },
  { label: "Memberships", to: "/admin/memberships", group: "Catalog", roles: ["admin"] },
  { label: "Payments", to: "/admin/payments", group: "Finance", roles: ["admin"], keywords: "ledger razorpay" },
  { label: "Reports", to: "/admin/reports", group: "Insights", roles: ["admin"], keywords: "kpi analytics" },
  { label: "Rewards", to: "/admin/rewards", group: "Programs", roles: ["admin"] },
  { label: "Lucky Draw", to: "/admin/lucky-draw", group: "Programs", roles: ["admin"] },
  { label: "Admin Settings", to: "/admin/settings", group: "Admin", roles: ["admin"] },
  // Promoter
  { label: "My Customers", to: "/promoter/customers", group: "Business", roles: ["promoter"] },
  { label: "Collections", to: "/promoter/collections", group: "Business", roles: ["promoter"] },
  { label: "Commissions", to: "/promoter/commissions", group: "Business", roles: ["promoter"] },
  { label: "Portfolio", to: "/promoter/portfolio", group: "Business", roles: ["promoter"] },
  // Customer
  { label: "My Membership", to: "/customer/membership", group: "Account", roles: ["customer"] },
  { label: "Enroll in Plan", to: "/customer/enroll", group: "Account", roles: ["customer"], keywords: "plans subscribe" },
  { label: "Payment History", to: "/customer/payments", group: "Account", roles: ["customer"] },
  { label: "Rewards", to: "/customer/rewards", group: "Programs", roles: ["customer"] },
  { label: "Lucky Draw", to: "/customer/lucky-draw", group: "Programs", roles: ["customer"] },
  { label: "Referrals", to: "/customer/referrals", group: "Programs", roles: ["customer"] },
];

export function GlobalSearch({ role }: { role: AppRole | null | undefined }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = useMemo(
    () => (role ? TARGETS.filter((t) => t.roles.includes(role)) : []),
    [role],
  );

  const grouped = useMemo(() => {
    const g: Record<string, NavTarget[]> = {};
    for (const it of items) (g[it.group] ||= []).push(it);
    return g;
  }, [items]);

  const go = (to: string) => {
    setOpen(false);
    navigate({ to });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-9 gap-2 px-2 sm:px-3"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
        <span className="hidden text-xs text-muted-foreground sm:inline">Search…</span>
        <kbd className="ml-1 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search customers, plans, reports…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {Object.entries(grouped).map(([group, list], i) => (
            <div key={group}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup heading={group}>
                {list.map((t) => (
                  <CommandItem
                    key={t.to}
                    value={`${t.label} ${t.keywords ?? ""} ${t.to}`}
                    onSelect={() => go(t.to)}
                  >
                    {t.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
