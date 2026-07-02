import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Arasi Enterprises" },
      { name: "description", content: "Choose a new password for your Arasi account." },
    ],
  }),
  component: ResetPassword,
});

const pwSchema = z.string().min(8, "At least 8 characters");

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase places the recovery token in the URL hash and calls onAuthStateChange
    // with 'PASSWORD_RECOVERY' once the session is established.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // Also check if there's already a session (link just clicked)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = pwSchema.safeParse(password);
    if (!r.success) return toast.error(r.error.issues[0].message);
    if (password !== confirm) return toast.error("Passwords do not match");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: r.data });
      if (error) throw error;
      toast.success("Password updated");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen" style={{ background: "var(--gradient-hero-value)" }}>
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass w-full max-w-md rounded-2xl p-8 shadow-[var(--shadow-card)]">
          <Logo className="mb-6" />
          <h1 className="text-lg font-semibold">Choose a new password</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {ready
              ? "Enter a strong password to complete the reset."
              : "Validating your reset link…"}
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <div>
              <Label htmlFor="pw">New password</Label>
              <Input
                id="pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={!ready}
              />
            </div>
            <div>
              <Label htmlFor="pw2">Confirm password</Label>
              <Input
                id="pw2"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                disabled={!ready}
              />
            </div>
            <Button type="submit" variant="success" className="w-full" disabled={!ready || submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
