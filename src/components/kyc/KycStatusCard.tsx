import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Clock,
  Loader2,
  BadgeCheck,
  MapPin,
  Home,
  UserCircle2,
  CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyKycStatus, normalizeKycStatus } from "./KycStatusBadge";
import type { KycProfile } from "@/lib/kyc.functions";

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

export const ROLE_LABEL: Record<NonNullable<KycProfile["role"]>, string> = {
  admin: "Administrator",
  promoter: "Promoter",
  customer: "Customer",
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function ApprovedSummary({ data }: { data: KycProfile }) {
  const addressLines = [
    data.address_line1,
    data.address_line2,
    [data.city, data.state, data.postal_code].filter(Boolean).join(", "),
    data.country,
  ].filter(Boolean) as string[];

  const reviewedAt = formatDate(data.kyc_reviewed_at);
  const role = data.role ?? null;

  return (
    <div className="mt-4 rounded-lg border border-emerald-500/20 bg-background/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
        <h4 className="text-sm font-semibold">Membership details</h4>
        {role ? (
          <Badge variant="secondary" className="ml-auto capitalize">
            {ROLE_LABEL[role]}
          </Badge>
        ) : null}
      </div>

      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        {data.full_name ? (
          <div className="flex items-start gap-2">
            <UserCircle2 className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <div>
              <dt className="text-muted-foreground">Full name</dt>
              <dd className="font-medium text-foreground">{data.full_name}</dd>
            </div>
          </div>
        ) : null}

        {data.city || data.state ? (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <div>
              <dt className="text-muted-foreground">City / State</dt>
              <dd className="font-medium text-foreground">
                {[data.city, data.state].filter(Boolean).join(", ")}
              </dd>
            </div>
          </div>
        ) : null}

        {addressLines.length ? (
          <div className="flex items-start gap-2 sm:col-span-2">
            <Home className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <div>
              <dt className="text-muted-foreground">Address on file</dt>
              <dd className="font-medium text-foreground whitespace-pre-line">
                {addressLines.join("\n")}
              </dd>
            </div>
          </div>
        ) : null}

        {reviewedAt ? (
          <div className="flex items-start gap-2 sm:col-span-2">
            <CalendarCheck
              className="mt-0.5 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <dt className="text-muted-foreground">Approved on</dt>
              <dd className="font-medium text-foreground">{reviewedAt}</dd>
            </div>
          </div>
        ) : null}
      </dl>

      {data.kyc_review_notes ? (
        <p className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 text-xs text-muted-foreground">
          Reviewer notes: <span className="text-foreground">{data.kyc_review_notes}</span>
        </p>
      ) : null}
    </div>
  );
}

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
      className={`flex flex-col gap-4 rounded-xl border border-border p-5 shadow-[var(--shadow-card)] ring-1 ${meta.bg} ${meta.ring}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

      {status === "approved" && data ? <ApprovedSummary data={data} /> : null}
    </div>
  );
}
