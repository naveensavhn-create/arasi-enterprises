import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getReceiptByNumber } from "@/lib/receipts.functions";
import { ReceiptView } from "@/components/receipts/ReceiptView";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/receipts/$receiptNumber")({
  component: ReceiptPage,
});

function ReceiptPage() {
  const { receiptNumber } = Route.useParams();
  const navigate = useNavigate();
  const fetchReceipt = useServerFn(getReceiptByNumber);

  const q = useQuery({
    queryKey: ["receipt", receiptNumber],
    queryFn: () => fetchReceipt({ data: { receiptNumber } }),
  });

  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl px-4 print:hidden">
        <div className="mb-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/customer/receipts" })}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Button size="sm" onClick={() => window.print()} disabled={!q.data}>
            <Printer className="mr-1 h-4 w-4" /> Print / Save as PDF
          </Button>
        </div>
      </div>
      {q.isLoading && <p className="text-center text-sm text-muted-foreground">Loading receipt…</p>}
      {q.error && (
        <p className="text-center text-sm text-red-500">{(q.error as Error).message}</p>
      )}
      {q.data && <ReceiptView receipt={q.data} />}
    </div>
  );
}
