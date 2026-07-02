import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";
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

const SITE_URL = "https://arasi-enterprises.lovable.app";
const PAGE_TITLE =
  "Arasi Enterprises — Advance Booking & Monthly Installment Membership";
const PAGE_DESCRIPTION =
  "Reserve your Arasi Enterprises membership with a one-time advance and settle in fixed monthly installments. Transparent schedules, receipted payments, and member entitlements — customer, promoter and administrator portals.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: PAGE_TITLE },
      { name: "description", content: PAGE_DESCRIPTION },
      {
        name: "keywords",
        content:
          "Arasi Enterprises, advance booking membership, monthly installment plan, membership programme, member rewards, customer portal, promoter portal",
      },
      { name: "robots", content: "index,follow" },
      { name: "author", content: "Arasi Enterprises" },

      // Open Graph
      { property: "og:title", content: PAGE_TITLE },
      { property: "og:description", content: PAGE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:site_name", content: "Arasi Enterprises" },
      { property: "og:locale", content: "en_IN" },

      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: PAGE_TITLE },
      { name: "twitter:description", content: PAGE_DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Arasi Enterprises",
          url: SITE_URL,
          description: PAGE_DESCRIPTION,
          slogan: "Your Dream, Our Commitment",
          areaServed: "IN",
        }),
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
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#020617]">
      {/*
        Ambient decorative glows.
        - Purely presentational (aria-hidden).
        - Softened for users who prefer reduced motion / reduced visual noise
          via `motion-reduce:opacity-0`, which also honours Windows / macOS
          "reduce transparency" heuristics that many browsers map to
          prefers-reduced-motion. The core layout remains fully legible
          without them.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25 transition-opacity motion-reduce:opacity-0"
      >
        <div
          className="absolute -left-[10%] -top-[10%] h-[55%] w-[55%] rounded-full"
          style={{ background: "#C5A059", filter: "blur(180px)" }}
        />
        <div
          className="absolute -bottom-[10%] -right-[10%] h-[45%] w-[45%] rounded-full"
          style={{ background: "#1E293B", filter: "blur(150px)" }}
        />
      </div>

      {/* Subtle vignette — also dropped for reduced-motion users */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 motion-reduce:opacity-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, rgba(2,6,23,0.6) 100%)",
        }}
      />

      {/* Skip link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[#C5A059] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#020617] focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>


      <header className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-6 sm:gap-6 sm:px-6 sm:py-8">
        <div className="min-w-0 [&_*]:!text-white [&_.text-muted-foreground]:!text-[#C5A059]/70">
          <Logo />
        </div>

        <Link
          to="/auth"
          search={{ portal: "customer" }}
          aria-label="Sign in to your Arasi Enterprises portal"
          className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-[#C5A059]/60 bg-[#C5A059]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#C5A059] shadow-[0_0_0_0_rgba(197,160,89,0)] transition-all duration-300 hover:border-[#C5A059] hover:bg-[#C5A059] hover:text-[#020617] hover:shadow-[0_8px_28px_-8px_rgba(197,160,89,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A059] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] motion-reduce:transition-none sm:px-5 sm:py-2.5 sm:text-[13px]"
        >
          Sign in
          <ArrowRight
            aria-hidden
            className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          />
        </Link>
      </header>


      <main
        id="main-content"
        className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center px-6 pb-24 pt-8 sm:pt-16"
      >
        {/* Hero */}
        <div className="mb-14 space-y-5 text-center sm:mb-20">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#C5A059]">
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
          <p className="mx-auto max-w-xl text-base font-light leading-relaxed text-white/80">
            An exclusive gateway to advance-booking memberships, monthly
            installments and distinguished member rewards.
          </p>
        </div>

        {/* Portal Grid */}
        <section aria-labelledby="portals-heading" className="w-full">
          <h2 id="portals-heading" className="sr-only">
            Choose your portal
          </h2>
          <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          {portals.map((p, idx) => (
            <Link
              key={p.id}
              to="/auth"
              search={{ portal: p.id }}
              className="group relative flex h-full flex-col border border-[#C5A059]/20 bg-[#0F172A]/40 p-8 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 hover:border-[#C5A059]/60 hover:bg-[#0F172A]/60 focus-visible:-translate-y-1 focus-visible:border-[#C5A059]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5A059] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] motion-reduce:transform-none motion-reduce:transition-none md:p-10"
            >
              {/* Top gold sweep on hover — decorative, disabled under reduced motion */}
              <div
                aria-hidden
                className="absolute left-0 top-0 h-px w-full scale-x-0 bg-gradient-to-r from-transparent via-[#C5A059]/70 to-transparent transition-transform duration-700 group-hover:scale-x-100 group-focus-visible:scale-x-100 motion-reduce:transition-none motion-reduce:group-hover:scale-x-0"
              />
              {/* Corner index — decorative */}
              <span
                aria-hidden
                className="absolute right-6 top-6 text-xs font-medium tracking-[0.25em] text-white/60"
                style={serif}
              >
                0{idx + 1}
              </span>

              <div className="mb-8 text-[#C5A059]" aria-hidden>
                <p.icon className="h-8 w-8" strokeWidth={1.25} />
              </div>
              <h3
                className="mb-4 text-2xl font-semibold text-white"
                style={serif}
              >
                {p.title}
              </h3>
              <p className="mb-10 flex-grow text-sm leading-relaxed text-white/80">
                {p.desc}
              </p>
              <div className="inline-flex items-center text-xs font-bold uppercase tracking-[0.2em] text-[#C5A059]">
                Continue
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" aria-hidden />
              </div>
            </Link>
          ))}
          </div>
        </section>


        {/* Programme benefits */}
        <section
          id="how-it-works"
          aria-labelledby="benefits-heading"
          className="mt-24 w-full sm:mt-32"
        >
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#C5A059]">
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
            <p className="mx-auto mt-5 max-w-xl text-sm font-light leading-relaxed text-white/80 sm:text-base">
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
                  className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#C5A059]"
                >
                  {s.tag}
                </span>
                <div className="mt-5 text-[#C5A059]" aria-hidden>
                  <s.icon className="h-7 w-7" strokeWidth={1.25} />
                </div>
                <h3
                  className="mt-5 text-xl font-semibold text-white sm:text-2xl"
                  style={serif}
                >
                  {s.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-white/80">
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
                <div className="text-[#C5A059]" aria-hidden>
                  <b.icon className="h-6 w-6" strokeWidth={1.25} />
                </div>
                <h3
                  className="mt-4 text-base font-semibold text-white"
                  style={serif}
                >
                  {b.title}
                </h3>
                <p className="mt-3 text-[13px] leading-relaxed text-white/80">
                  {b.body}
                </p>
              </div>
            ))}
          </div>

          {/* Assurance note */}
          <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-white/75">
            Arasi Enterprises is a membership-based advance booking programme.
            It is not an investment scheme and does not promise returns, profit
            sharing or guaranteed income of any kind. Entitlements and member
            benefits are governed by the plan document issued at the time of
            enrolment.
          </p>
        </section>

        {/* Footer accent */}
        <div className="mt-20 flex flex-col items-center gap-3">
          <div className="h-px w-24 bg-[#C5A059]/40" aria-hidden />
          <p className="text-[10px] uppercase tracking-[0.4em] text-white/70">
            Exclusively for Members
          </p>
        </div>
      </main>
    </div>
  );
}
