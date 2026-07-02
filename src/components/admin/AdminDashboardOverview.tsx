import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Users,
  UserCog,
  Wallet,
  Percent,
  Trophy,
  Clock,
  AlertTriangle,
  ShieldAlert,
  CalendarClock,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAdminDashboardStats } from "@/lib/admin-stats.functions";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type Tone = "default" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  default: "border-border bg-card",
  success: "border-emerald-500/30 bg-emerald-500/5",
  warning: "border-amber-500/30 bg-amber-500/5",
  danger: "border-destructive/30 bg-destructive/5",
  info: "border-primary/30 bg-primary/5",
};

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = "default",
  to,
}: {
  title: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  to?: string;
}) {
  const inner = (
    <Card className={`h-full transition hover:shadow-md ${TONE[tone]}`}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function AdminDashboardOverview() {
  const fn = useServerFn(getAdminDashboardStats);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "dashboard-stats"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm"
      >
        <p className="font-medium text-destructive">Couldn't load dashboard stats.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {error instanceof Error ? error.message : "Please try again."}
        </p>
        <button
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          onClick={() => refetch()}
        >
          Retry <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Promoters"
          value={data.promoters.toLocaleString("en-IN")}
          hint="Active promoter accounts"
          icon={UserCog}
          tone="info"
          to="/admin/promoters"
        />
        <StatCard
          title="Customers"
          value={data.customers.toLocaleString("en-IN")}
          hint="Registered customers"
          icon={Users}
          tone="info"
          to="/admin/customers"
        />
        <StatCard
          title="Revenue collected"
          value={INR.format(data.totalRevenue)}
          hint="All successful payments"
          icon={Wallet}
          tone="success"
          to="/admin/payments"
        />
        <StatCard
          title="Promoter commissions"
          value={INR.format(data.commissions.total)}
          hint={
            <span>
              Paid {INR.format(data.commissions.paid)} · Pending{" "}
              <span className="text-amber-600 dark:text-amber-400">
                {INR.format(data.commissions.pending)}
              </span>
            </span>
          }
          icon={Percent}
          tone="default"
          to="/admin/commissions"
        />

        <StatCard
          title="Pending from customers"
          value={INR.format(data.pendingAmount)}
          hint="Installments due but not paid"
          icon={Clock}
          tone="warning"
          to="/admin/payments"
        />
        <StatCard
          title="Missed / overdue"
          value={INR.format(data.overdueAmount)}
          hint="Installments past their due date"
          icon={AlertTriangle}
          tone="danger"
          to="/admin/payments"
        />
        <StatCard
          title="KYC pending review"
          value={data.kycPending.toLocaleString("en-IN")}
          hint={`${data.kycNotSubmitted.toLocaleString("en-IN")} not yet submitted`}
          icon={ShieldAlert}
          tone={data.kycPending > 0 ? "warning" : "default"}
          to="/admin/approvals"
        />
        <StatCard
          title="Next lucky draw"
          value={data.nextDraw ? fmtDate(data.nextDraw.draw_at) : "None scheduled"}
          hint={
            data.nextDraw ? (
              <span className="inline-flex items-center gap-1">
                {data.nextDraw.name}
                <Badge variant="outline" className="ml-1 capitalize">
                  {data.nextDraw.status}
                </Badge>
              </span>
            ) : (
              "Create one from Lucky Draw"
            )
          }
          icon={CalendarClock}
          tone="info"
          to="/admin/lucky-draw"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold">Latest draw & winners</CardTitle>
          <Trophy className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {data.latestDraw ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-medium">{data.latestDraw.name}</p>
                <p className="text-xs text-muted-foreground">
                  Drawn {fmtDate(data.latestDraw.drawn_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums">
                  {data.latestDraw.winners}
                </p>
                <p className="text-xs text-muted-foreground">winners announced</p>
              </div>
              <Link
                to="/admin/draw-results"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View results <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No completed draws yet. Winners appear here once a draw is finalised.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
