import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Users,
  Briefcase,
  ShieldCheck,
  CalendarClock,
  Wallet,
  FileCheck2,
  BellRing,
  Gift,
  Landmark,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";

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

const serif = { fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif" };

const portals = [
  {
    id: "customer" as const,
    title: "Customer Portal",
    desc: "Access your personal portfolio, manage installment plans, and view exclusive membership rewards.",
    icon: Users,
  },
  {
    id: "promoter" as const,
    title: "Promoter Portal",
    desc: "Register new members, facilitate collection of installments, and track your commission performance.",
    icon: Briefcase,
  },
  {
    id: "admin" as const,
    title: "Administrator Portal",
    desc: "Oversee ecosystem operations, manage plan structures, and audit comprehensive platform reports.",
    icon: ShieldCheck,
  },
];

function Landing() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#020617]">
      {/* Ambient gilded glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25">
        <div
          className="absolute -left-[10%] -top-[10%] h-[55%] w-[55%] rounded-full"
          style={{ background: "#C5A059", filter: "blur(180px)" }}
        />
        <div
          className="absolute -bottom-[10%] -right-[10%] h-[45%] w-[45%] rounded-full"
          style={{ background: "#1E293B", filter: "blur(150px)" }}
        />
      </div>

      {/* Subtle vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, rgba(2,6,23,0.6) 100%)",
        }}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-8">
        <div className="[&_*]:!text-white [&_.text-muted-foreground]:!text-[#C5A059]/70">
          <Logo />
        </div>

        <Link
          to="/auth"
          search={{ portal: "customer" }}
          className="border-b border-transparent pb-1 text-sm font-medium tracking-wide text-white/80 transition-colors hover:border-[#C5A059] hover:text-[#C5A059]"
        >
          Sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center px-6 pb-24 pt-8 sm:pt-16">
        {/* Hero */}
        <div className="mb-14 space-y-5 text-center sm:mb-20">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#C5A059]">
            Established Trust · Since 2024
          </p>
          <h1
            className="text-4xl font-bold leading-[1.1] text-white sm:text-5xl md:text-6xl"
            style={serif}
          >
            Building Dreams,
            <br className="hidden md:block" /> Creating{" "}
            <span className="italic text-[#C5A059]">Opportunities</span>
          </h1>
          <p className="mx-auto max-w-xl text-base font-light leading-relaxed text-white/60">
            An exclusive gateway to advance-booking memberships, monthly
            installments and distinguished member rewards.
          </p>
        </div>

        {/* Portal Grid */}
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          {portals.map((p, idx) => (
            <Link
              key={p.id}
              to="/auth"
              search={{ portal: p.id }}
              className="group relative flex h-full flex-col border border-[#C5A059]/20 bg-[#0F172A]/40 p-8 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 hover:border-[#C5A059]/60 hover:bg-[#0F172A]/60 md:p-10"
            >
              {/* Top gold sweep on hover */}
              <div
                aria-hidden
                className="absolute left-0 top-0 h-px w-full scale-x-0 bg-gradient-to-r from-transparent via-[#C5A059]/70 to-transparent transition-transform duration-700 group-hover:scale-x-100"
              />
              {/* Corner index */}
              <span
                className="absolute right-6 top-6 text-xs font-medium tracking-[0.25em] text-white/25"
                style={serif}
              >
                0{idx + 1}
              </span>

              <div className="mb-8 text-[#C5A059]">
                <p.icon className="h-8 w-8" strokeWidth={1.25} />
              </div>
              <h3
                className="mb-4 text-2xl font-semibold text-white"
                style={serif}
              >
                {p.title}
              </h3>
              <p className="mb-10 flex-grow text-sm leading-relaxed text-white/55">
                {p.desc}
              </p>
              <div className="inline-flex items-center text-xs font-bold uppercase tracking-[0.2em] text-[#C5A059]">
                Continue
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </div>

        {/* Programme benefits */}
        <section
          id="how-it-works"
          aria-labelledby="benefits-heading"
          className="mt-24 w-full sm:mt-32"
        >
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#C5A059]">
              How the Programme Works
            </p>
            <h2
              id="benefits-heading"
              className="mt-4 text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl"
              style={serif}
            >
              Advance booking, paid on a{" "}
              <span className="italic text-[#C5A059]">monthly plan</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-sm font-light leading-relaxed text-white/60 sm:text-base">
              Reserve your entitlement today with a modest advance, then settle
              the balance in fixed monthly installments. Every payment is
              receipted, every schedule is transparent, and the plan is
              designed around predictable household budgeting — not speculation.
            </p>
          </div>

          {/* Two-column: booking & installments */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
            {[
              {
                tag: "Step 01",
                title: "Reserve with an advance booking",
                icon: CalendarClock,
                body:
                  "A one-time advance secures your membership number and locks in the plan terms on the day of enrolment. Your position, entitlement and price are recorded up front, in writing.",
              },
              {
                tag: "Step 02",
                title: "Settle in fixed monthly installments",
                icon: Wallet,
                body:
                  "The remaining amount is divided into equal monthly installments over the plan tenure. Amounts, due dates and the closing month are printed on your schedule from day one — no revisions, no surprises.",
              },
            ].map((s) => (
              <div
                key={s.tag}
                className="relative flex h-full flex-col border border-[#C5A059]/20 bg-[#0F172A]/40 p-8 backdrop-blur-sm md:p-10"
              >
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#C5A059]/80"
                >
                  {s.tag}
                </span>
                <div className="mt-5 text-[#C5A059]">
                  <s.icon className="h-7 w-7" strokeWidth={1.25} />
                </div>
                <h3
                  className="mt-5 text-xl font-semibold text-white sm:text-2xl"
                  style={serif}
                >
                  {s.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-white/60">
                  {s.body}
                </p>
              </div>
            ))}
          </div>

          {/* Benefits grid */}
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 md:mt-10 md:grid-cols-4">
            {[
              {
                icon: FileCheck2,
                title: "Written schedule",
                body: "Every plan comes with a printable installment schedule and a serially numbered receipt for each payment.",
              },
              {
                icon: BellRing,
                title: "Timely reminders",
                body: "Automated email and SMS reminders help you stay on schedule without penalties or awkward follow-ups.",
              },
              {
                icon: Landmark,
                title: "Secure payments",
                body: "Payments are processed through regulated payment gateways and reconciled to your account in real time.",
              },
              {
                icon: Gift,
                title: "Member entitlements",
                body: "On completion of the plan tenure you receive the entitlement recorded at booking, along with any published member benefits.",
              },
            ].map((b) => (
              <div
                key={b.title}
                className="flex h-full flex-col border border-[#C5A059]/15 bg-[#0F172A]/30 p-6 backdrop-blur-sm"
              >
                <div className="text-[#C5A059]">
                  <b.icon className="h-6 w-6" strokeWidth={1.25} />
                </div>
                <h4
                  className="mt-4 text-base font-semibold text-white"
                  style={serif}
                >
                  {b.title}
                </h4>
                <p className="mt-3 text-[13px] leading-relaxed text-white/55">
                  {b.body}
                </p>
              </div>
            ))}
          </div>

          {/* Assurance note */}
          <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-white/45">
            Arasi Enterprises is a membership-based advance booking programme.
            It is not an investment scheme and does not promise returns, profit
            sharing or guaranteed income of any kind. Entitlements and member
            benefits are governed by the plan document issued at the time of
            enrolment.
          </p>
        </section>

        {/* Footer accent */}
        <div className="mt-20 flex flex-col items-center gap-3">
          <div className="h-px w-24 bg-[#C5A059]/40" />
          <p className="text-[10px] uppercase tracking-[0.4em] text-white/30">
            Exclusively for Members
          </p>
        </div>
      </main>
    </div>
  );
}
