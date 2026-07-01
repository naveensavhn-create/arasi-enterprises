/**
 * Server-only helper: reconcile a single payment against Razorpay's API
 * and record a `payment_reconciliations` row. Safe to call from webhook
 * handlers — never throws (errors are captured as reconciliation notes).
 */

function mapProviderStatus(providerStatus: string | null | undefined): string | null {
  if (!providerStatus) return null;
  const s = providerStatus.toLowerCase();
  if (s === "captured") return "paid";
  if (s === "refunded") return "refunded";
  if (s === "failed") return "failed";
  if (s === "authorized") return "attempted";
  if (s === "created") return "created";
  return s;
}

async function fetchRazorpayPayment(
  paymentId: string,
  keyId: string,
  keySecret: string,
) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Razorpay ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as {
    id: string;
    status: string;
    amount: number;
    currency: string;
    method: string | null;
    error_code: string | null;
    error_description: string | null;
    order_id: string;
  };
}

async function fetchRazorpayOrderPayments(
  orderId: string,
  keyId: string,
  keySecret: string,
) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(
    `https://api.razorpay.com/v1/orders/${orderId}/payments`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { items?: Array<{ id: string; status: string }> };
  return body.items ?? [];
}

export type AutoReconcileInput = {
  paymentId: string;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  eventId?: string | null;
};

export type AutoReconcileOutcome =
  | { status: "matched" | "mismatch" | "error" | "skipped"; note: string }
  | { status: "disabled"; note: string };

/**
 * Look up the payment, hit Razorpay, and record a reconciliation row.
 * Never throws — the webhook must not be failed by reconciliation issues.
 */
export async function reconcileSinglePayment(
  supabaseAdmin: any,
  input: AutoReconcileInput,
): Promise<AutoReconcileOutcome> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return { status: "disabled", note: "Razorpay API keys not configured" };
  }

  try {
    // Re-fetch the current stored payment so we compare against the latest
    // status (the webhook has already persisted its update by this point).
    const { data: payment, error: pErr } = await supabaseAdmin
      .from("payments")
      .select("id, status, provider_order_id, provider_payment_id")
      .eq("id", input.paymentId)
      .maybeSingle();
    if (pErr || !payment) {
      return { status: "error", note: `Payment lookup failed: ${pErr?.message ?? "not found"}` };
    }

    let providerPaymentId =
      input.providerPaymentId ?? payment.provider_payment_id ?? null;
    const orderId = input.providerOrderId ?? payment.provider_order_id ?? null;

    if (!providerPaymentId && orderId) {
      try {
        const items = await fetchRazorpayOrderPayments(orderId, keyId, keySecret);
        if (items && items.length > 0) {
          const captured = items.find((it) => it.status === "captured");
          providerPaymentId = (captured ?? items[0]).id;
        }
      } catch {
        /* fall through */
      }
    }

    if (!providerPaymentId) {
      const row = {
        payment_id: payment.id,
        stored_status: payment.status,
        provider_status: null,
        mismatch: false,
        note: `Auto (webhook${input.eventId ? ` ${input.eventId}` : ""}): no provider payment id yet — skipped`,
        checked_by: null,
      };
      await supabaseAdmin.from("payment_reconciliations").insert(row);
      return { status: "skipped", note: row.note };
    }

    const remote = await fetchRazorpayPayment(providerPaymentId, keyId, keySecret);
    const mappedRemote = mapProviderStatus(remote.status);
    const isMismatch = mappedRemote !== null && mappedRemote !== payment.status;

    const row = {
      payment_id: payment.id,
      stored_status: payment.status,
      provider_status: remote.status,
      provider_amount: remote.amount / 100,
      provider_method: remote.method,
      provider_error: remote.error_code
        ? `${remote.error_code}: ${remote.error_description ?? ""}`
        : null,
      mismatch: isMismatch,
      note: isMismatch
        ? `Auto (webhook${input.eventId ? ` ${input.eventId}` : ""}): Stored=${payment.status} · Razorpay=${remote.status} (→${mappedRemote})`
        : `Auto (webhook${input.eventId ? ` ${input.eventId}` : ""}): in sync (${remote.status})`,
      checked_by: null,
    };

    const { error: iErr } = await supabaseAdmin
      .from("payment_reconciliations")
      .insert(row);
    if (iErr) return { status: "error", note: `Insert failed: ${iErr.message}` };

    return { status: isMismatch ? "mismatch" : "matched", note: row.note };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await supabaseAdmin.from("payment_reconciliations").insert({
        payment_id: input.paymentId,
        stored_status: "unknown",
        provider_status: null,
        mismatch: false,
        note: `Auto (webhook${input.eventId ? ` ${input.eventId}` : ""}) error: ${message}`,
        checked_by: null,
      });
    } catch {
      /* swallow */
    }
    return { status: "error", note: message };
  }
}
