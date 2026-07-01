import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Clock } from "lucide-react";
import { getMyKyc, type KycStatus } from "@/lib/kyc.functions";
import { cn } from "@/lib/utils";

export type NormalizedKycStatus = "unsubmitted" | "pending" | "approved" | "rejected";

const META: Record<
  NormalizedKycStatus,
  { label: string; icon: typeof ShieldCheck; className: string; ring: string }
> = {
  approved: {
    label: "KYC Approved",
    icon: ShieldCheck,
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-500/30",
  },
  pending: {
    label: "KYC Pending",
    icon: Clock,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ring: "ring-amber-500/30",
  },
  rejected: {
    label: "KYC Rejected",
    icon: ShieldAlert,
    className: "bg-destructive/10 text-destructive",
    ring: "ring-destructive/30",
  },
  unsubmitted: {
    label: "KYC Not submitted",
    icon: ShieldQuestion,
    className: "bg-muted text-muted-foreground",
    ring: "ring-border",
  },
};

export function useMyKycStatus(enabled = true) {
  const fetchKyc = useServerFn(getMyKyc);
  return useQuery({
    queryKey: ["my-kyc-status"],
    queryFn: () => fetchKyc(),
    enabled,
    staleTime: 30_000,
  });
}

export function normalizeKycStatus(s: KycStatus | null | undefined): NormalizedKycStatus {
  if (s === "approved" || s === "pending" || s === "rejected") return s;
  return "unsubmitted";
}

type Props = {
  status: KycStatus | null | undefined;
  size?: "sm" | "md";
  asLink?: boolean;
  className?: string;
};

export function KycStatusBadge({ status, size = "sm", asLink = true, className }: Props) {
  const normalized = normalizeKycStatus(status);
  const meta = META[normalized];
  const Icon = meta.icon;

  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 transition-colors",
        meta.className,
        meta.ring,
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        asLink && "hover:brightness-110",
        className,
      )}
      title={meta.label}
      aria-label={meta.label}
    >
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
      <span className={size === "sm" ? "hidden sm:inline" : ""}>{meta.label}</span>
    </span>
  );

  if (!asLink) return content;
  return (
    <Link to="/kyc" className="shrink-0">
      {content}
    </Link>
  );
}

export function HeaderKycStatus() {
  const { data, isLoading } = useMyKycStatus();
  if (isLoading || !data) return null;
  return <KycStatusBadge status={data.kyc_status} />;
}
