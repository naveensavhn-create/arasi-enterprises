import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  Gift,
  ShieldCheck,
  CalendarClock,
  CalendarCheck,
  ClipboardCopy,
  Wallet,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  Inbox,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { KycStatusCard } from "@/components/kyc/KycStatusCard";
import { NextDrawCard } from "@/components/dashboard/NextDrawCard";



type MembershipRow = {
  id: string;
  membership_number: string;
  member_display_id: string | null;
  coupon_no: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
  advance_paid: number;
  total_amount: number;
  paid_amount: number;
  user_id: string;
  membership_plans: { name: string; monthly_installment: number; duration_months: number } | null;
};

type Installment = {
  id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
  membership_id: string;
};


const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    n || 0,
  );

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const parts = d.slice(0, 10).split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
};

const statusMeta: Record<string, { label: string; tone: string }> = {
  active: { label: "Member", tone: "text-emerald-300" },
  pending: { label: "Pending", tone: "text-amber-300" },
  completed: { label: "Completed", tone: "text-sky-300" },
  cancelled: { label: "Cancelled", tone: "text-muted-foreground" },
  defaulted: { label: "Defaulted", tone: "text-red-300" },
};

export function CustomerDashboardBody() {
  const { session } = useSession();
  const userId = session?.user.id;
  const email = session?.user.email ?? "";
  const fullName =
    (session?.user.user_metadata as Record<string, string> | undefined)?.full_name ||
    email.split("@")[0] ||
    "Member";

  const membershipsQ = useQuery({
    queryKey: ["customer-dash-membership", userId],
    enabled: !!userId,
    queryFn: async (): Promise<MembershipRow[]> => {
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("memberships")
        .select(
          "id, membership_number, member_display_id, coupon_no, status, start_date, end_date, advance_paid, total_amount, paid_amount, user_id, membership_plans(name, monthly_installment, duration_months)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as MembershipRow[];
      // Defense-in-depth: RLS restricts this already, but reject any row
      // whose user_id does not match the signed-in user before rendering.
      const foreign = rows.find((r) => r.user_id !== userId);
      if (foreign) {
        throw new Error("Authorization check failed: membership does not belong to current user");
      }
      return rows;
    },
  });

  const membership = membershipsQ.data?.[0];

  const installmentsQ = useQuery({
    queryKey: ["customer-dash-installments", membership?.id, userId],
    enabled: !!membership?.id && !!userId && membership?.user_id === userId,
    queryFn: async (): Promise<Installment[]> => {
      if (!userId || !membership || membership.user_id !== userId) {
        throw new Error("Not authorized to view these installments");
      }
      const { data, error } = await supabase
        .from("installments")
        .select("id, sequence, due_date, amount, status, paid_at, membership_id")
        .eq("membership_id", membership.id)
        .order("sequence", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Installment[];
      const foreign = rows.find((r) => r.membership_id !== membership.id);
      if (foreign) {
        throw new Error("Authorization check failed: installment does not belong to current membership");
      }
      return rows;
    },
  });


  if (membershipsQ.isLoading) {
    return <DashboardSkeleton />;
  }

  if (membershipsQ.isError) {
    const err = membershipsQ.error as unknown;
    const message =
      (typeof err === "object" && err && "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : null) ?? "We couldn't load your dashboard.";
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="mx-auto max-w-3xl px-6 py-10"
        data-testid="dashboard-error"
      >
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="rounded-full bg-destructive/10 p-3 text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold">We couldn't load your dashboard</h2>
            <p className="max-w-md text-sm text-muted-foreground">{message}</p>
            <Button
              onClick={() => {
                void membershipsQ.refetch();
              }}
              disabled={membershipsQ.isFetching}
            >
              {membershipsQ.isFetching && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <KycStatusCard />
        <Card className="overflow-hidden border-dashed">
          <div
            className="h-1 w-full"
            style={{ background: "var(--gradient-gold-value)" }}
            aria-hidden="true"
          />
          <CardContent className="space-y-5 p-8 text-center">
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: "var(--gradient-gold-value)" }}
            >
              <Sparkles className="h-7 w-7 text-black/80" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Welcome, {fullName}</h2>
              <p className="text-sm text-muted-foreground">
                You don't have an active membership yet. Pick a plan and pay the advance
                — we'll generate your installment schedule automatically.
              </p>
            </div>

            <ol className="mx-auto grid max-w-md gap-2 text-left text-sm">
              <EmptyStep n={1} title="Browse membership plans" desc="Silver, Gold, Platinum or Diamond." />
              <EmptyStep n={2} title="Pay the one-time advance" desc="Secure checkout via Razorpay." />
              <EmptyStep n={3} title="Track monthly installments" desc="Reminders + auto-schedule here." />
            </ol>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild style={{ background: "var(--gradient-gold-value)" }}>
                <Link to="/customer/enroll">
                  Browse plans <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/customer/membership">Learn how it works</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }



  const installments = installmentsQ.data ?? [];
  const paidCount = installments.filter((i) => i.status === "paid").length;
  const totalCount = installments.length || membership.membership_plans?.duration_months || 0;
  const balanceCount = Math.max(totalCount - paidCount, 0);

  const now = new Date();
  const nextDue = installments
    .filter((i) => i.status !== "paid")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const lastPaid = installments
    .filter((i) => i.status === "paid" && i.paid_at)
    .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))[0];

  const totalDue = Math.max(Number(membership.total_amount) - Number(membership.paid_amount), 0);
  const progressPct = totalCount ? Math.round((paidCount / totalCount) * 100) : 0;

  const meta = statusMeta[membership.status] ?? statusMeta.pending;
  const eligibleForDraw = membership.status === "active" && paidCount >= 1;

  const copy = async (label: string, value: string | null | undefined) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Couldn't copy ${label}`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <KycStatusCard />
      {/* HERO */}

      <div
        className="relative overflow-hidden rounded-2xl border border-white/10 p-6 text-white shadow-[var(--shadow-card)] sm:p-8"
        style={{ background: "var(--gradient-hero-value)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: "var(--gradient-gold-value)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-gold-value)" }}
        />

        <div className="relative grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-white/60">Welcome back</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{fullName}</h1>
              <p className={`mt-1 text-sm font-semibold ${meta.tone}`}>{meta.label}</p>
            </div>

            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <button
                type="button"
                onClick={() => copy("ID No", membership.member_display_id)}
                className="group flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
              >
                <span>
                  <span className="text-[10px] uppercase tracking-widest text-white/50">ID No</span>
                  <span className="mt-0.5 block font-mono text-base text-white">
                    {membership.member_display_id ?? "—"}
                  </span>
                </span>
                <ClipboardCopy className="h-3.5 w-3.5 opacity-40 transition group-hover:opacity-100" />
              </button>
              <button
                type="button"
                onClick={() => copy("Coupon No", membership.coupon_no)}
                className="group flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
              >
                <span>
                  <span className="text-[10px] uppercase tracking-widest text-white/50">Coupon No</span>
                  <span className="mt-0.5 block font-mono text-base text-white">
                    {membership.coupon_no ?? "—"}
                  </span>
                </span>
                <ClipboardCopy className="h-3.5 w-3.5 opacity-40 transition group-hover:opacity-100" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <p className="text-xs uppercase tracking-widest text-white/50">Total Due</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{inr(totalDue)}</p>
                <Progress
                  value={progressPct}
                  className="mt-2 h-1.5 bg-white/10 [&>div]:bg-emerald-400"
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-white/50">Commission</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">₹0</p>
                <div
                  className="mt-2 h-1.5 rounded-full"
                  style={{ background: "var(--gradient-gold-value)", opacity: 0.6 }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            {eligibleForDraw && (
              <div className="relative w-full max-w-xs rounded-xl border border-amber-300/40 bg-black/30 p-4 text-center shadow-lg backdrop-blur">
                <Gift className="mx-auto h-8 w-8 text-amber-300" />
                <p className="mt-2 text-sm font-semibold text-amber-100">Congratulations!</p>
                <p className="text-xs text-white/70">
                  You are now eligible for the Surprise Gift Draw.
                </p>
                <Button asChild size="sm" className="mt-3" variant="secondary">
                  <Link to="/customer/lucky-draw">View draw</Link>
                </Button>
              </div>
            )}

            <div
              className="relative flex h-32 w-32 items-center justify-center rounded-full border-4 border-amber-300/50 shadow-xl"
              style={{ background: "var(--gradient-gold-value)" }}
            >
              <div className="text-center">
                <ShieldCheck className="mx-auto h-8 w-8 text-black/80" />
                <p className="mt-1 text-xs font-bold uppercase tracking-widest text-black/80">
                  {meta.label}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dates row */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DateCard
          icon={<CalendarCheck className="h-4 w-4" />}
          label="Last Paid Date"
          value={fmtDate(lastPaid?.paid_at ?? null)}
        />
        <DateCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Next Due Date"
          value={fmtDate(nextDue?.due_date ?? null)}
          highlight={
            !!nextDue && new Date(nextDue.due_date) < now
              ? "Overdue"
              : nextDue
                ? "Upcoming"
                : undefined
          }
        />
      </div>


      {/* Installments — loading / error / empty / summary */}
      {installmentsQ.isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your installment schedule…
          </CardContent>
        </Card>
      ) : installmentsQ.isError ? (
        <Card
          role="alert"
          aria-live="polite"
          className="border-destructive/40"
          data-testid="installments-error"
        >
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-destructive/10 p-2 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium">Couldn't load installments</p>
                <p className="text-xs text-muted-foreground">
                  {installmentsQ.error instanceof Error
                    ? installmentsQ.error.message
                    : "Please try again."}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void installmentsQ.refetch();
              }}
              disabled={installmentsQ.isFetching}
            >
              {installmentsQ.isFetching && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : installments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Inbox className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium">No installments generated yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {membership.status === "pending"
                ? "Your schedule will appear here as soon as your advance payment is confirmed."
                : "We couldn't find any installments for this membership. If you paid the advance recently, please refresh in a moment."}
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link to="/customer/membership">View membership</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <CountCard
            icon={<Wallet className="h-4 w-4" />}
            value={totalCount}
            label="Total Installments"
          />
          <CountCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            value={paidCount}
            label="Paid"
            tone="text-emerald-500"
          />
          <CountCard
            icon={<Clock className="h-4 w-4" />}
            value={balanceCount}
            label="Balance Due"
            tone="text-amber-500"
          />
        </div>
      )}


      {/* Lucky draw status */}
      <NextDrawCard ctaTo="/customer/lucky-draw" />

      {/* Quick actions */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-sm font-medium">
              {membership.membership_plans?.name ?? "Membership"} •{" "}
              <span className="text-muted-foreground font-mono text-xs">
                {membership.membership_number}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Started {fmtDate(membership.start_date)} • {inr(Number(membership.paid_amount))} of{" "}
              {inr(Number(membership.total_amount))} paid
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/customer/installments">View installments</Link>
            </Button>
            <Button asChild size="sm" style={{ background: "var(--gradient-gold-value)" }}>
              <Link to="/customer/membership">Membership details</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DateCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-full bg-primary/10 p-3 text-primary">{icon}</div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        </div>
        {highlight && (
          <Badge
            variant="outline"
            className={
              highlight === "Overdue"
                ? "border-red-500/30 bg-red-500/10 text-red-500"
                : "border-amber-500/30 bg-amber-500/10 text-amber-500"
            }
          >
            {highlight}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function CountCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-full bg-primary/10 p-3 ${tone ?? "text-primary"}`}>{icon}</div>
        <div>
          <p className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>
            {value} <span className="text-sm font-normal text-muted-foreground">count</span>
          </p>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyStep({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md border bg-card/50 p-3">
      <span
        className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold text-black/80"
        style={{ background: "var(--gradient-gold-value)" }}
        aria-hidden="true"
      >
        {n}
      </span>
      <div>
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="space-y-6 px-6 py-6"
      role="status"
      aria-live="polite"
      aria-label="Loading your dashboard"
    >
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-24 w-24 rounded-full sm:block" />
          </div>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
      <span className="sr-only">Loading your dashboard…</span>
    </div>
  );
}
