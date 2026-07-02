import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Logo } from "@/components/brand/Logo";
import { useSiteSettings } from "@/components/providers/SiteSettingsProvider";
import type { ReceiptRow } from "@/lib/receipts.functions";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function ReceiptView({ receipt }: { receipt: ReceiptRow }) {
  const [qr, setQr] = useState<string>("");

  useEffect(() => {
    const verifyUrl = `${window.location.origin}/receipts/${receipt.receipt_number}`;
    QRCode.toDataURL(verifyUrl, { width: 160, margin: 1 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [receipt.receipt_number]);

  return (
    <div className="print-receipt mx-auto max-w-3xl bg-white p-10 text-slate-900 shadow-sm">
      {receipt.voided_at && (
        <div className="mb-4 rounded border-2 border-red-500 bg-red-50 p-3 text-center text-red-700 font-semibold uppercase tracking-widest">
          Voided · {fmt(receipt.voided_at)}
          {receipt.void_reason && <div className="mt-1 text-xs normal-case font-normal">{receipt.void_reason}</div>}
        </div>
      )}

      <header className="flex items-start justify-between border-b pb-6">
        <div>
          <Logo />
          <p className="mt-2 text-xs text-slate-500">
            ARASI Enterprises · Payment Receipt
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-slate-500">Receipt No.</div>
          <div className="mt-1 font-mono text-lg font-semibold">{receipt.receipt_number}</div>
          <div className="mt-2 text-xs text-slate-500">Issued</div>
          <div className="text-sm">{fmt(receipt.issued_at)}</div>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Received From</div>
          <div className="mt-1 font-semibold">{receipt.customer_name ?? "—"}</div>
          {receipt.customer_email && <div className="text-slate-600">{receipt.customer_email}</div>}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="text-slate-500">Membership ID</div>
            <div className="font-mono">{receipt.member_display_id ?? receipt.membership_number ?? "—"}</div>
            <div className="text-slate-500">Coupon No.</div>
            <div className="font-mono">{receipt.coupon_no ?? "—"}</div>
            <div className="text-slate-500">Plan</div>
            <div>{receipt.plan_name ?? "—"}</div>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Payment Details</div>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="text-slate-500">For</div>
            <div>
              {receipt.installment_sequence
                ? `Installment #${receipt.installment_sequence}${receipt.installment_due_date ? ` (due ${receipt.installment_due_date})` : ""}`
                : "Advance / Enrollment"}
            </div>
            <div className="text-slate-500">Method</div>
            <div className="uppercase">{receipt.payment_method ?? "Razorpay"}</div>
            <div className="text-slate-500">Transaction ID</div>
            <div className="font-mono break-all">{receipt.transaction_id ?? "—"}</div>
            <div className="text-slate-500">Collected By</div>
            <div>{receipt.promoter_name ?? "Direct / Online"}</div>
            <div className="text-slate-500">Status</div>
            <div className={receipt.voided_at ? "text-red-600 font-semibold" : "text-emerald-700 font-semibold"}>
              {receipt.voided_at ? "VOID" : "PAID"}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-lg border-2 border-slate-900 p-6">
        <div className="flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-widest text-slate-500">Amount Paid</div>
          <div className="text-3xl font-bold tabular-nums">{inr(receipt.amount)}</div>
        </div>
      </section>

      <footer className="mt-8 flex items-end justify-between border-t pt-6 text-xs text-slate-500">
        <div>
          <div className="mb-1">Verify at</div>
          <div className="font-mono text-[10px] break-all">
            {typeof window !== "undefined" ? `${window.location.origin}/receipts/${receipt.receipt_number}` : `/receipts/${receipt.receipt_number}`}
          </div>
          <div className="mt-6 border-t border-dashed border-slate-400 pt-1 w-56 text-center">
            Authorized Signature
          </div>
        </div>
        <div className="flex flex-col items-center">
          {qr && <img src={qr} alt="Verification QR" width={120} height={120} />}
          <div className="mt-1 text-[10px] uppercase tracking-widest">Scan to verify</div>
        </div>
      </footer>

      <p className="mt-6 text-center text-[10px] text-slate-400">
        This is a system-generated receipt. For queries contact support@arasi.example.
      </p>
    </div>
  );
}
