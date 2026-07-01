import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { createEnrollmentOrder, verifyEnrollmentPayment } from "@/lib/enrollment.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/customer/enroll")({
  head: () => ({ meta: [{ title: "Enroll — Arasi" }] }),
  component: EnrollPage,
});

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay?: any;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

type Plan = {
  id: string;
  name: string;
  description: string | null;
  advance_amount: number;
  monthly_installment: number;
  duration_months: number;
  total_value: number | null;
  benefits: string[] | null;
};

function EnrollPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [payingId, setPayingId] = useState<string | null>(null);
  const createOrder = useServerFn(createEnrollmentOrder);
  const verifyPayment = useServerFn(verifyEnrollmentPayment);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["enroll-plans"],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("membership_plans")
        .select("id, name, description, advance_amount, monthly_installment, duration_months, total_value, benefits")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as unknown as Plan[];
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["my-profile-enroll", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", session!.user.id)
        .maybeSingle();
      return data;
    },
  });

  async function handleEnroll(plan: Plan) {
    setPayingId(plan.id);
    try {
      const scriptOk = await loadCheckoutScript();
      if (!scriptOk) throw new Error("Failed to load Razorpay Checkout");

      const order = await createOrder({ data: { planId: plan.id } });

      if (order.skipPayment) {
        toast.success("Enrollment activated");
        navigate({ to: "/customer/membership" });
        return;
      }

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Arasi Enterprises",
        description: `${order.planName} — Advance booking`,
        order_id: order.orderId,
        prefill: {
          name: profile?.full_name ?? "",
          email: profile?.email ?? session?.user.email ?? "",
          contact: profile?.phone ?? "",
        },
        theme: { color: "#0a1f44" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: async (resp: any) => {
          try {
            await verifyPayment({
              data: {
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              },
            });
            toast.success("Payment received — activating your membership…");
            setTimeout(() => navigate({ to: "/customer/membership" }), 1200);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Verification failed");
          }
        },
        modal: { ondismiss: () => setPayingId(null) },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rzp.on("payment.failed", (r: any) => {
        toast.error(r?.error?.description ?? "Payment failed");
      });
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enrollment failed");
    } finally {
      setPayingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading plans…
      </div>
    );
  }

  const rows = plans ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Choose your plan</h1>
        <p className="text-sm text-muted-foreground">
          Pay the advance to book your slot. Monthly installments are auto-scheduled after activation.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader><CardTitle>No plans available</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Please check back later or contact an administrator.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const total = Number(p.total_value ?? p.advance_amount + p.monthly_installment * p.duration_months);
            return (
              <Card key={p.id} className="glass flex flex-col">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                  </div>
                  {p.description && (
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                  )}
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Stat label="Advance" value={`₹${Number(p.advance_amount).toLocaleString("en-IN")}`} accent />
                    <Stat
                      label={`Monthly × ${p.duration_months}`}
                      value={`₹${Number(p.monthly_installment).toLocaleString("en-IN")}`}
                    />
                    <Stat label="Total" value={`₹${total.toLocaleString("en-IN")}`} />
                  </div>

                  {p.benefits && p.benefits.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {p.benefits.slice(0, 4).map((b, i) => (
                        <li key={i} className="flex gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-2">
                    <Badge variant="outline">INR</Badge>
                    <Button
                      onClick={() => handleEnroll(p)}
                      disabled={payingId === p.id}
                      style={{ background: "var(--gradient-gold-value)" }}
                    >
                      {payingId === p.id ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening…</>
                      ) : (
                        <>Enroll — Pay ₹{Number(p.advance_amount).toLocaleString("en-IN")}</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Already enrolled?{" "}
        <Link to="/customer/membership" className="underline">View my membership</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${accent ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}
