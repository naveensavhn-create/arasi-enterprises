import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  createRazorpayOrderForInstallment,
  verifyRazorpayPayment,
} from "@/lib/razorpay.functions";

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

interface Props {
  installmentId: string;
  amount: number;
  sequence: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  disabled?: boolean;
}

export function PayInstallmentButton({
  installmentId,
  amount,
  sequence,
  customerName,
  customerEmail,
  customerPhone,
  disabled,
}: Props) {
  const [loading, setLoading] = useState(false);
  const createOrder = useServerFn(createRazorpayOrderForInstallment);
  const verify = useServerFn(verifyRazorpayPayment);
  const qc = useQueryClient();

  async function handlePay() {
    setLoading(true);
    try {
      const scriptOk = await loadCheckoutScript();
      if (!scriptOk) throw new Error("Failed to load Razorpay Checkout");

      const order = await createOrder({ data: { installmentId } });

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Arasi Enterprises",
        description: `Installment #${sequence} — ${order.membershipNumber}`,
        order_id: order.orderId,
        prefill: {
          name: customerName ?? "",
          email: customerEmail ?? "",
          contact: customerPhone ?? "",
        },
        theme: { color: "#0a1f44" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: async (response: any) => {
          try {
            await verify({
              data: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
            });
            toast.success("Payment received. Confirming with bank…");
            // Webhook finalizes as paid; poll refresh shortly
            setTimeout(() => qc.invalidateQueries(), 1500);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Verification failed");
          }
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rzp.on("payment.failed", (resp: any) => {
        toast.error(resp?.error?.description ?? "Payment failed");
      });

      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to start payment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" onClick={handlePay} disabled={disabled || loading}>
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing…
        </>
      ) : (
        <>Pay ₹{amount.toLocaleString("en-IN")}</>
      )}
    </Button>
  );
}
