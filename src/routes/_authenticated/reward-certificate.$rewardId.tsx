import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { getRewardById } from "@/lib/rewards.functions";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Award } from "lucide-react";
import { formatDateTime } from "@/lib/format-datetime";

export const Route = createFileRoute("/_authenticated/reward-certificate/$rewardId")({
  head: () => ({ meta: [{ title: "Reward Certificate — Arasi" }] }),
  component: CertificatePage,
});

function CertificatePage() {
  const { rewardId } = useParams({ from: "/_authenticated/reward-certificate/$rewardId" });
  const getFn = useServerFn(getRewardById);
  const { data, isLoading } = useQuery({
    queryKey: ["reward-cert", rewardId],
    queryFn: () => getFn({ data: { id: rewardId } }),
  });

  useEffect(() => {
    // Ensure background prints
    document.body.classList.add("print-cert");
    return () => document.body.classList.remove("print-cert");
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading certificate…
      </div>
    );
  }
  if (!data) {
    return <div className="p-8 text-center text-muted-foreground">Certificate not found.</div>;
  }

  const title = data.tier?.certificate_title || data.tier?.name || "Reward Certificate";
  const body =
    data.tier?.certificate_body ||
    "This certificate acknowledges your milestone in the Arasi Enterprises membership program.";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/customer/rewards">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Print / Save PDF
        </Button>
      </div>

      <div className="mx-auto max-w-3xl">
        <div
          className="relative border-[10px] border-double rounded-lg p-10 bg-gradient-to-br from-amber-50 to-white text-slate-900 shadow-xl"
          style={{ borderColor: "#c9a54a" }}
        >
          <div className="absolute top-4 right-4 opacity-10">
            <Award className="h-40 w-40" />
          </div>
          <div className="text-center space-y-2">
            <div className="text-xs uppercase tracking-[0.3em] text-amber-700">Arasi Enterprises</div>
            <h1 className="text-4xl font-serif font-bold text-amber-800">Certificate of Achievement</h1>
            <div className="text-sm text-slate-600">This is proudly presented to</div>
            <div className="text-3xl font-serif italic text-slate-900 py-2">
              {data.customer_name ?? "Valued Member"}
            </div>
            <div className="max-w-2xl mx-auto text-slate-700 py-2">
              <p className="text-lg font-medium">{title}</p>
              <p className="text-sm mt-2">{body}</p>
            </div>
            <div className="flex justify-around pt-8 text-xs text-slate-600">
              <div>
                <div className="border-t border-slate-400 pt-1 px-6">Membership</div>
                <div className="font-mono">{data.membership_number ?? "—"}</div>
              </div>
              <div>
                <div className="border-t border-slate-400 pt-1 px-6">Reward #</div>
                <div className="font-mono">{data.reward_number}</div>
              </div>
              <div>
                <div className="border-t border-slate-400 pt-1 px-6">Awarded</div>
                <div>{formatDateTime(data.unlocked_at)}</div>
              </div>
            </div>
            <div className="pt-6 text-[10px] text-slate-500 uppercase tracking-widest">
              Arasi Enterprises · Advance Booking & Monthly Installment Program
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .print-cert nav, .print-cert aside, .print-cert header { display: none !important; }
        }
      `}</style>
    </div>
  );
}
