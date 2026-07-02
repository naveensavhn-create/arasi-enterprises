import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import { listCommissionsAdmin, listMyCommissions, type CommissionRow } from "@/lib/commissions.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";

const searchSchema = z.object({
  promoterId: z.string().uuid().optional(),
  status: z.enum(["all", "pending", "approved", "paid", "rejected"]).optional().default("all"),
  from: z.string().optional(),
  to: z.string().optional(),
  autoprint: z.coerce.boolean().optional().default(false),
});

export const Route = createFileRoute("/_authenticated/commission-statement")({
  head: () => ({ meta: [{ title: "Commission Statement" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: Page,
});

function Page() {
  const search = useSearch({ from: "/_authenticated/commission-statement" });
  const listMine = useServerFn(listMyCommissions);
  const listAdmin = useServerFn(listCommissionsAdmin);

  const { data: me } = useQuery({
    queryKey: ["me-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: 60_000,
  });
  const { data: isAdmin } = useQuery({
    queryKey: ["me-is-admin", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data } = await supabase.rpc("has_role", { _user_id: me!.id, _role: "admin" });
      return !!data;
    },
  });

  const useAdmin = isAdmin && search.promoterId && search.promoterId !== me?.id;

  const { data: rows, isLoading } = useQuery<CommissionRow[]>({
    queryKey: ["commission-statement", useAdmin, search],
    enabled: isAdmin !== undefined,
    queryFn: () =>
      useAdmin
        ? listAdmin({ data: { status: search.status, promoterId: search.promoterId, from: search.from, to: search.to, limit: 500 } })
        : listMine({ data: { status: search.status, from: search.from, to: search.to, limit: 500 } }),
  });

  const grouped = useMemo(() => {
    const t = { pending: 0, approved: 0, paid: 0, rejected: 0, all: 0, gross: 0 };
    (rows ?? []).forEach((r) => {
      const amt = Number(r.commission_amount);
      t[r.status] += amt;
      t.all += amt;
      t.gross += Number(r.installment_amount);
    });
    return t;
  }, [rows]);

  const promoterName = rows?.[0]?.promoter_name ?? "—";

  useEffect(() => {
    if (search.autoprint && rows && rows.length >= 0 && !isLoading) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [search.autoprint, rows, isLoading]);

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="text-sm text-neutral-600">Commission statement preview</div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Print / Save as PDF
        </Button>
      </div>

      <div className="mx-auto max-w-4xl p-8">
        <header className="mb-6 flex items-start justify-between border-b pb-4">
          <div>
            <div className="text-lg font-bold">ARASI ENTERPRISES</div>
            <div className="text-xs text-neutral-600">Promoter Commission Statement</div>
          </div>
          <div className="text-right text-xs">
            <div>Generated: {new Date().toLocaleString()}</div>
            <div>Promoter: <span className="font-semibold">{promoterName}</span></div>
            {search.from || search.to ? (
              <div>Period: {search.from ?? "…"} → {search.to ?? "…"}</div>
            ) : null}
            <div>Status filter: {search.status}</div>
          </div>
        </header>

        {isLoading ? (
          <div className="flex items-center gap-2 py-16 text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading statement…
          </div>
        ) : (
          <>
            <section className="mb-6 grid grid-cols-4 gap-3 text-sm">
              <SummaryTile label="Pending" value={grouped.pending} />
              <SummaryTile label="Approved" value={grouped.approved} />
              <SummaryTile label="Paid" value={grouped.paid} />
              <SummaryTile label="Total" value={grouped.all} strong />
            </section>

            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y bg-neutral-100 text-left">
                  <th className="px-2 py-1.5">Ledger #</th>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Customer</th>
                  <th className="px-2 py-1.5">Membership</th>
                  <th className="px-2 py-1.5 text-right">Collection</th>
                  <th className="px-2 py-1.5 text-right">Rate</th>
                  <th className="px-2 py-1.5 text-right">Commission</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Ref</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.id} className="border-b align-top">
                    <td className="px-2 py-1.5 font-mono">{r.ledger_number}</td>
                    <td className="px-2 py-1.5">{new Date(r.payment_date).toLocaleDateString()}</td>
                    <td className="px-2 py-1.5">{r.customer_name ?? "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{r.membership_number ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">₹{Number(r.installment_amount).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-1.5 text-right">{Number(r.commission_percent).toFixed(2)}%</td>
                    <td className="px-2 py-1.5 text-right font-semibold">₹{Number(r.commission_amount).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-1.5 capitalize">{r.status}</td>
                    <td className="px-2 py-1.5 font-mono">{r.paid_reference ?? "—"}</td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-neutral-500">No entries for the selected filters.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-2 py-2" colSpan={4}>Totals</td>
                  <td className="px-2 py-2 text-right">₹{grouped.gross.toLocaleString("en-IN")}</td>
                  <td />
                  <td className="px-2 py-2 text-right">₹{grouped.all.toLocaleString("en-IN")}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>

            <footer className="mt-10 border-t pt-3 text-[10px] text-neutral-500">
              Commissions are calculated automatically from the promoter's current rank at the time of collection.
              This document is a system-generated statement of the commission ledger and does not require a signature.
            </footer>
          </>
        )}
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}

function SummaryTile({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded border p-2 ${strong ? "bg-neutral-900 text-white" : "bg-neutral-50"}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-1 text-base font-bold">₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
    </div>
  );
}
