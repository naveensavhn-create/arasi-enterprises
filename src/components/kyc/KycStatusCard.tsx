import { Link } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, ShieldAlert, ShieldQuestion, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMyKycStatus, normalizeKycStatus } from "./KycStatusBadge";

const COPY = {
  approved: {
    title: "KYC Approved",
    body: "Your identity is verified. You're eligible for memberships, draws, and payouts.",
    icon: ShieldCheck,
    accent: "text-emerald-500",
    ring: "ring-emerald-500/30",
    bg: "bg-emerald-500/5",
    cta: "View KYC details",
  },
  pending: {
    title: "KYC Pending review",
    body: "Thanks for submitting your documents. An admin will review them shortly.",
    icon: Clock,
    accent: "text-amber-500",
    ring: "ring-amber-500/30",
    bg: "bg-amber-500/5",
    cta: "View submission",
  },
  rejected: {
    title: "KYC Rejected",
    body: "Your last submission was rejected. Please review the notes and resubmit.",
    icon: ShieldAlert,
    accent: "text-destructive",
    ring: "ring-destructive/30",
    bg: "bg-destructive/5",
    cta: "Fix and resubmit",
  },
  unsubmitted: {
    title: "KYC Not submitted",
    body: "Complete KYC with your Aadhaar details to unlock memberships and rewards.",
    icon: ShieldQuestion,
    accent: "text-muted-foreground",
    ring: "ring-border",
    bg: "bg-muted/40",
    cta: "Start KYC",
  },
} as const;

export function KycStatusCard() {
  const { data, isLoading } = useMyKycStatus();

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading KYC status…</span>
      </div>
    );
  }

  const status = normalizeKycStatus(data?.kyc_status);
  const meta = COPY[status];
  const Icon = meta.icon;

  return (
    <div
      className={`flex flex-col gap-4 rounded-xl border border-border p-5 shadow-[var(--shadow-card)] ring-1 sm:flex-row sm:items-center sm:justify-between ${meta.bg} ${meta.ring}`}
    >
      <div className="flex items-start gap-4">
        <div className={`rounded-lg bg-background/70 p-2.5 ${meta.accent}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{meta.title}</h3>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{meta.body}</p>
          {status === "rejected" && data?.kyc_review_notes ? (
            <p className="mt-2 rounded-md border border-destructive/30 bg-background/70 px-2 py-1 text-xs text-destructive">
              Reviewer notes: {data.kyc_review_notes}
            </p>
          ) : null}
        </div>
      </div>
      <Button asChild size="sm" variant={status === "approved" ? "outline" : "default"}>
        <Link to="/kyc">
          {meta.cta}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
