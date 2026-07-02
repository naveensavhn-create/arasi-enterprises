import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Mail, Phone, ShieldCheck, Users, Briefcase, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";
import { Logo } from "@/components/brand/Logo";
import { useSession, portalToRole, type AppRole } from "@/lib/auth";

const searchSchema = z.object({
  portal: z.enum(["customer", "promoter", "admin"]).catch("customer"),
  mode: z.enum(["signin", "signup", "forgot"]).optional(),
  ref: z.string().trim().min(4).max(32).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Arasi Enterprises" },
      { name: "description", content: "Access your Arasi Enterprises portal." },
    ],
  }),
  component: AuthPage,
});

const PORTAL_META: Record<AppRole, { title: string; icon: typeof Users; blurb: string }> = {
  customer: {
    title: "Customer Portal",
    icon: Users,
    blurb: "Manage your membership, installments and rewards.",
  },
  promoter: {
    title: "Promoter Portal",
    icon: Briefcase,
    blurb: "Register customers, collect installments and track commissions.",
  },
  admin: {
    title: "Administrator Portal",
    icon: ShieldCheck,
    blurb: "Full control over the Arasi platform.",
  },
};

function AuthPage() {
  const { portal, mode } = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const role = portalToRole(portal);
  const meta = PORTAL_META[role];

  // Redirect logged-in users to dashboard
  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [loading, user, navigate]);

  return (
    <div
      className="relative min-h-screen"
      style={{ background: "var(--gradient-hero-value)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 h-[500px] w-[500px] rounded-full opacity-20 blur-3xl"
        style={{ background: "var(--gradient-gold-value)" }}
      />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <div className="mb-6 flex w-full max-w-md items-center justify-between text-white/80">
          <Link to="/" className="inline-flex items-center gap-1 text-sm hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <Logo />
        </div>

        <div className="glass w-full max-w-md rounded-2xl p-8 shadow-[var(--shadow-card)]">
          <div className="mb-6 flex items-start gap-3">
            <div
              className="grid h-11 w-11 place-items-center rounded-xl"
              style={{ background: "var(--gradient-gold-value)", color: "var(--navy)" }}
            >
              <meta.icon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{meta.title}</h1>
              <p className="text-xs text-muted-foreground">{meta.blurb}</p>
            </div>
          </div>

          <PortalSwitcher current={role} />

          {mode === "forgot" ? (
            <ForgotPassword role={role} />
          ) : (
            <SignInSignUp role={role} initialMode={mode ?? "signin"} />
          )}
        </div>

        <p className="mt-6 text-xs text-white/50">
          Protected by industry-standard encryption. © {new Date().getFullYear()} Arasi Enterprises.
        </p>
      </div>
    </div>
  );
}

function PortalSwitcher({ current }: { current: AppRole }) {
  const items: { id: AppRole; label: string }[] = [
    { id: "customer", label: "Customer" },
    { id: "promoter", label: "Promoter" },
    { id: "admin", label: "Admin" },
  ];
  return (
    <div className="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
      {items.map((it) => (
        <Link
          key={it.id}
          to="/auth"
          search={{ portal: it.id }}
          className={
            "rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors " +
            (current === it.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

function SignInSignUp({ role, initialMode }: { role: AppRole; initialMode: "signin" | "signup" }) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const isAdminPortal = role === "admin";

  return (
    <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="signin">Sign in</TabsTrigger>
        <TabsTrigger value="signup" disabled={isAdminPortal}>
          Sign up
        </TabsTrigger>
      </TabsList>

      <TabsContent value="signin" className="mt-5">
        <SignInMethods role={role} />
      </TabsContent>
      <TabsContent value="signup" className="mt-5">
        {isAdminPortal ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Administrator accounts are provisioned internally. Please sign in.
          </p>
        ) : (
          <SignUpForm role={role} />
        )}
      </TabsContent>
    </Tabs>
  );
}

function SignInMethods({ role }: { role: AppRole }) {
  return (
    <Tabs defaultValue="email">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="email">
          <Mail className="mr-2 h-3.5 w-3.5" /> Email
        </TabsTrigger>
        <TabsTrigger value="phone">
          <Phone className="mr-2 h-3.5 w-3.5" /> Phone OTP
        </TabsTrigger>
      </TabsList>
      <TabsContent value="email" className="mt-4 space-y-4">
        <EmailPasswordForm role={role} />
      </TabsContent>
      <TabsContent value="phone" className="mt-4">
        <PhoneOtpForm />
      </TabsContent>
    </Tabs>
  );
}

const emailSchema = z.string().trim().email("Enter a valid email");
const passwordSchema = z.string().min(8, "At least 8 characters");
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Use international format e.g. +919876543210");

function EmailPasswordForm({ role }: { role: AppRole }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailR = emailSchema.safeParse(email);
    const pwR = passwordSchema.safeParse(password);
    if (!emailR.success) return toast.error(emailR.error.issues[0].message);
    if (!pwR.success) return toast.error(pwR.error.issues[0].message);

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailR.data,
        password: pwR.data,
      });
      if (error) throw error;
      // Remember me: keep session in localStorage (default), else in sessionStorage-like ephemeral
      if (!remember && typeof window !== "undefined") {
        // Move token to session storage so it doesn't persist across tabs closing
        const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
        if (key) {
          const val = window.localStorage.getItem(key);
          if (val) window.sessionStorage.setItem(key, val);
          window.localStorage.removeItem(key);
        }
      }
      toast.success("Welcome back");
      // enforce portal-role match check happens after redirect via dashboard router
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} /> Remember me
        </label>
        <Link
          to="/auth"
          search={{ portal: role, mode: "forgot" }}
          className="text-xs font-medium text-primary hover:underline"
        >
          Forgot password?
        </Link>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>
      <GoogleButton />
    </form>
  );
}

function SignUpForm({ role }: { role: AppRole }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailR = emailSchema.safeParse(email);
    const pwR = passwordSchema.safeParse(password);
    if (!name.trim()) return toast.error("Enter your full name");
    if (!emailR.success) return toast.error(emailR.error.issues[0].message);
    if (!pwR.success) return toast.error(pwR.error.issues[0].message);

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: emailR.data,
        password: pwR.data,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
          // NOTE: `role` intentionally omitted. Every new account starts as
          // 'customer' server-side (handle_new_user trigger). Promoter/admin
          // roles are granted only through admin-controlled flows — never
          // from client-supplied signup metadata.
          data: { full_name: name.trim() },
        },
      });
      if (error) throw error;
      toast.success("Account created — signing you in");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="su-email">Email</Label>
        <Input
          id="su-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="su-pw">Password</Label>
        <Input
          id="su-pw"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className="mt-1 text-[10px] text-muted-foreground">At least 8 characters.</p>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Create account
      </Button>
      <GoogleButton />
    </form>
  );
}

function PhoneOtpForm() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [submitting, setSubmitting] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const r = phoneSchema.safeParse(phone);
    if (!r.success) return toast.error(r.error.issues[0].message);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: r.data });
      if (error) throw error;
      toast.success("Code sent to " + r.data);
      setStep("otp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return toast.error("Enter the 6-digit code");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone, token: otp, type: "sms" });
      if (error) throw error;
      toast.success("Verified");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} className="space-y-3">
        <div>
          <Label htmlFor="phone">Phone number</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919876543210"
            required
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Include country code. We will send a 6-digit code by SMS.
          </p>
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <Label>Enter 6-digit code</Label>
        <InputOTP maxLength={6} value={otp} onChange={setOtp}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Verify &amp; sign in
      </Button>
      <button
        type="button"
        onClick={() => setStep("phone")}
        className="w-full text-xs text-muted-foreground hover:text-foreground"
      >
        Change phone number
      </button>
    </form>
  );
}

function ForgotPassword({ role }: { role: AppRole }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = emailSchema.safeParse(email);
    if (!r.success) return toast.error(r.error.issues[0].message);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(r.data, {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/reset-password`
            : undefined,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Reset link sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset link");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Reset your password</h2>
        <p className="text-xs text-muted-foreground">
          Enter your account email and we'll send a secure reset link.
        </p>
      </div>
      {sent ? (
        <div className="rounded-md border border-success/40 bg-success/10 p-3 text-xs text-success-foreground">
          If an account exists for {email}, a reset link has been sent. Check your inbox.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
      <Link
        to="/auth"
        search={{ portal: role }}
        className="block text-center text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to sign in
      </Link>
    </div>
  );
}

function GoogleButton() {
  const [loading, setLoading] = useState(false);
  async function onClick() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      if (result.error) throw result.error;
      // Redirected or session set — nothing else to do
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <div className="my-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.5 14.7 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z"/></svg>
        )}
        Continue with Google
      </Button>
    </>
  );
}
