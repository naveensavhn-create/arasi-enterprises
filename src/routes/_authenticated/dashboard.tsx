import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Users, Briefcase, ShieldCheck, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { useSession, useCurrentRole } from "@/lib/auth";
import { readLastVisited } from "@/lib/last-visited";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard — Arasi Enterprises" }],
  }),
  component: Dashboard,
});

const ROLE_META = {
  admin: {
    label: "Administrator",
    icon: ShieldCheck,
    desc: "Full platform control coming next: customers, plans, payments, rewards, lucky draw, reports.",
  },
  promoter: {
    label: "Promoter",
    icon: Briefcase,
    desc: "Register customers, collect installments and track your commissions.",
  },
  customer: {
    label: "Customer",
    icon: Users,
    desc: "Your membership, installments, rewards and referrals live here.",
  },
} as const;

function Dashboard() {
  const { user } = useSession();
  const { data: role } = useCurrentRole(user);
  const meta = role ? ROLE_META[role] : null;
  const navigate = useNavigate();

  // Resume at the last visited role page after login.
  useEffect(() => {
    if (!user || !role) return;
    const last = readLastVisited(user.id, role);
    if (last && last !== "/dashboard") {
      navigate({ to: last, replace: true });
    }
  }, [user?.id, role, navigate]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div
        className="relative overflow-hidden rounded-2xl p-8 text-navy-foreground shadow-[var(--shadow-card)]"
        style={{ background: "var(--gradient-hero-value)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl"
          style={{ background: "var(--gradient-gold-value)" }}
        />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.25em] text-white/60">Welcome back</p>
          <h1 className="mt-2 text-3xl font-semibold">
            {meta ? meta.label + " Dashboard" : "Setting things up…"}
          </h1>
          {meta && <p className="mt-2 max-w-xl text-sm text-white/70">{meta.desc}</p>}
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PlaceholderCard title="Memberships" body="Coming in the next module." />
        <PlaceholderCard title="Payments" body="Razorpay integration lands next." />
        <PlaceholderCard title="Rewards & Lucky Draw" body="Wired after payments." />
      </div>

      <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Sidebar shell is live</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Role-based navigation now renders in the collapsible sidebar. Sidebar items are
          placeholders until each module ships.
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Back to landing <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
