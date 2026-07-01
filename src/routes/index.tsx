import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Users, Briefcase, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Arasi Enterprises — Choose your portal" },
      {
        name: "description",
        content:
          "Sign in to the Arasi Enterprises membership platform as a customer, promoter or administrator.",
      },
    ],
  }),
  component: Landing,
});

const portals = [
  {
    id: "customer" as const,
    title: "Customer",
    desc: "View memberships, pay installments, track rewards.",
    icon: Users,
  },
  {
    id: "promoter" as const,
    title: "Promoter",
    desc: "Register customers, collect installments, view commissions.",
    icon: Briefcase,
  },
  {
    id: "admin" as const,
    title: "Administrator",
    desc: "Manage the entire platform, plans, rewards and reports.",
    icon: ShieldCheck,
  },
];

function Landing() {
  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "var(--gradient-hero-value)" }}
    >
      {/* Ambient gold glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[500px] w-[500px] rounded-full opacity-30 blur-3xl"
        style={{ background: "var(--gradient-gold-value)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 bottom-0 h-[400px] w-[400px] rounded-full opacity-20 blur-3xl"
        style={{ background: "var(--gradient-gold-value)" }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-navy-foreground">
        <Logo />
        <Button asChild variant="ghost" className="text-navy-foreground hover:bg-white/10 hover:text-navy-foreground">
          <Link to="/auth" search={{ portal: "customer" }}>
            Sign in <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-12 text-navy-foreground">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" /> Advance Booking &amp; Installment Membership
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Welcome to <span className="text-gradient-gold">Arasi Enterprises</span>
          </h1>
          <p className="mt-4 text-base text-white/70 sm:text-lg">
            Your Dream, Our Commitment. Choose your portal to continue.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {portals.map((p) => (
            <Link
              key={p.id}
              to="/auth"
              search={{ portal: p.id }}
              className="glass group relative flex flex-col rounded-2xl p-6 transition-all hover:-translate-y-1 hover:shadow-[var(--shadow-gold)]"
            >
              <div
                className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ background: "var(--gradient-gold-value)", color: "var(--navy)" }}
              >
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-white">{p.title} Portal</h3>
              <p className="mt-1 text-sm text-white/60">{p.desc}</p>
              <div className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-[var(--gold)]">
                Continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
