import { createFileRoute, Link } from "@tanstack/react-router";
import { LogOut, Users, Briefcase, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/Logo";
import { useSession, useCurrentRole, useSignOut } from "@/lib/auth";

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
  const { data: role, isLoading } = useCurrentRole(user);
  const signOut = useSignOut();
  const meta = role ? ROLE_META[role] : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium">{user?.email ?? user?.phone}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {isLoading ? "Loading role…" : role ?? "No role"}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
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
          <h2 className="text-sm font-semibold">Auth foundation is live</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Three portals, email + phone OTP, forgot password, remember-me, Google sign-in and
            role-based routing are all working. Next up: membership plans, installments and the
            admin panel shell.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Back to landing <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </main>
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
