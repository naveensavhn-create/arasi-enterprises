import { createFileRoute } from "@tanstack/react-router";
import { Users, Briefcase, ShieldCheck } from "lucide-react";
import { useSession, useCurrentRole } from "@/lib/auth";
import { CustomerDashboardBody } from "@/components/customer/CustomerDashboardBody";
import { KycStatusCard } from "@/components/kyc/KycStatusCard";
import { NextDrawCard } from "@/components/dashboard/NextDrawCard";
import { AdminDashboardOverview } from "@/components/admin/AdminDashboardOverview";


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
    desc: "Full platform control: customers, plans, payments, rewards, lucky draw, reports.",
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

  if (role === "customer") {
    return <CustomerDashboardBody />;
  }






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

      <div className="mt-8">
        <KycStatusCard />
      </div>

      {role === "admin" && (
        <div className="mt-8">
          <AdminDashboardOverview />
        </div>
      )}

      {role === "promoter" && (
        <div className="mt-8">
          <NextDrawCard ctaTo="/promoter/lucky-draw" />
        </div>
      )}
    </div>
  );
}

