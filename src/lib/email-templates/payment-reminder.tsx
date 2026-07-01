import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { brand as defaultBrand, colors as defaultColors, styles as base } from "./_shared";

export interface PaymentReminderBrand {
  name?: string;
  tagline?: string;
  supportEmail?: string;
  logoUrl?: string | null;
  primaryColor?: string; // hex, e.g. "#d4af37"
  accentColor?: string;
  headingFont?: string;
  bodyFont?: string;
}

export interface PaymentReminderProps {
  recipientName?: string;
  membershipNumber?: string | null;
  memberDisplayId?: string | null;
  planName?: string | null;

  invoiceNumber?: string | null;      // e.g. "INV-2607-045"
  installmentSequence?: number | null; // e.g. 3 (of 12)
  installmentTotal?: number | null;    // e.g. 12
  amountDue: number;
  currency?: string; // default INR
  dueDate: string;   // ISO date

  payUrl?: string;
  dashboardUrl?: string;

  brand?: PaymentReminderBrand;
}

const fmtAmount = (amount: number, ccy = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: ccy,
    maximumFractionDigits: 0,
  }).format(amount);

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { dateStyle: "long" });
  } catch {
    return iso;
  }
};

const daysUntil = (iso: string) => {
  try {
    const target = new Date(iso).setHours(0, 0, 0, 0);
    const today = new Date().setHours(0, 0, 0, 0);
    return Math.round((target - today) / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
};

const PaymentReminder: React.FC<PaymentReminderProps> = ({
  recipientName,
  membershipNumber,
  memberDisplayId,
  planName,
  invoiceNumber,
  installmentSequence,
  installmentTotal,
  amountDue,
  currency = "INR",
  dueDate,
  payUrl,
  dashboardUrl,
  brand,
}) => {
  // Resolve brand tokens from site settings, falling back to shared defaults.
  const b = {
    name: brand?.name ?? defaultBrand.name,
    tagline: brand?.tagline ?? defaultBrand.tagline,
    supportEmail: brand?.supportEmail ?? defaultBrand.supportEmail,
    logoUrl: brand?.logoUrl ?? null,
    primary: brand?.primaryColor ?? defaultColors.gold,
    accent: brand?.accentColor ?? defaultColors.goldSoft,
    headingFont: brand?.headingFont,
    bodyFont: brand?.bodyFont,
  };

  // Compose styles that override brand-sensitive tokens per-recipient.
  const main = {
    ...base.main,
    fontFamily: b.bodyFont
      ? `${b.bodyFont}, ${base.main.fontFamily}`
      : base.main.fontFamily,
  };
  const brandName = { ...base.brandName, color: b.primary };
  const heading = {
    ...base.h1,
    fontFamily: b.headingFont
      ? `${b.headingFont}, ${base.main.fontFamily}`
      : base.main.fontFamily,
  };
  const button = {
    ...base.button,
    backgroundColor: b.primary,
  };
  const accentStrong = { color: b.accent };

  const days = daysUntil(dueDate);
  const dueLabel =
    days === null
      ? `Due ${fmtDate(dueDate)}`
      : days > 1
        ? `Due in ${days} days · ${fmtDate(dueDate)}`
        : days === 1
          ? `Due tomorrow · ${fmtDate(dueDate)}`
          : days === 0
            ? `Due today · ${fmtDate(dueDate)}`
            : `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} · ${fmtDate(dueDate)}`;

  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  const seqLabel =
    installmentSequence && installmentTotal
      ? `Installment ${installmentSequence} of ${installmentTotal}`
      : installmentSequence
        ? `Installment ${installmentSequence}`
        : "Monthly installment";

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Gentle reminder — {seqLabel.toLowerCase()} of {fmtAmount(amountDue, currency)} {dueLabel.toLowerCase()}.
      </Preview>
      <Body style={main}>
        <Container style={base.container}>
          <Section style={base.card}>
            <Section style={base.header}>
              {b.logoUrl ? (
                <Img
                  src={b.logoUrl}
                  alt={b.name}
                  height="36"
                  style={{ display: "block", marginBottom: "8px" }}
                />
              ) : null}
              <Text style={brandName}>{b.name}</Text>
              <Text style={base.tagline}>{b.tagline}</Text>
            </Section>

            <Heading as="h1" style={heading}>
              A gentle reminder about your upcoming payment
            </Heading>
            <Text style={base.p}>{greeting}</Text>
            <Text style={base.p}>
              This is a friendly reminder that your {planName ? `${planName} ` : ""}
              membership installment is coming up. No action is needed if you've
              already paid — otherwise, you can settle it in a couple of taps
              from your dashboard.
            </Text>

            <Section style={base.detailBox}>
              <Text style={base.detailLabel}>Amount due</Text>
              <Text style={{ ...base.detailValue, fontSize: "20px" }}>
                <strong style={accentStrong}>{fmtAmount(amountDue, currency)}</strong>
              </Text>

              <Text style={base.detailLabel}>Due date</Text>
              <Text style={base.detailValue}>
                <strong>{dueLabel}</strong>
              </Text>

              <Text style={base.detailLabel}>Installment</Text>
              <Text style={base.detailValue}>{seqLabel}</Text>

              {invoiceNumber ? (
                <>
                  <Text style={base.detailLabel}>Invoice</Text>
                  <Text style={base.detailValue}>{invoiceNumber}</Text>
                </>
              ) : null}

              {membershipNumber || memberDisplayId ? (
                <>
                  <Text style={base.detailLabel}>Membership</Text>
                  <Text style={base.detailValue}>
                    {membershipNumber ?? memberDisplayId}
                    {memberDisplayId && membershipNumber ? (
                      <span style={{ color: defaultColors.textMuted }}>
                        {" "}
                        · {memberDisplayId}
                      </span>
                    ) : null}
                  </Text>
                </>
              ) : null}
            </Section>

            {payUrl || dashboardUrl ? (
              <Text style={{ ...base.p, margin: "8px 0 4px" }}>
                <a href={payUrl ?? dashboardUrl!} style={button}>
                  {payUrl ? "Pay this installment" : "Open my dashboard"}
                </a>
              </Text>
            ) : null}

            {payUrl && dashboardUrl ? (
              <Text style={base.muted}>
                Prefer to review first?{" "}
                <a href={dashboardUrl} style={{ color: b.primary }}>
                  View from your dashboard
                </a>
                .
              </Text>
            ) : null}

            <Hr style={base.divider} />
            <Text style={base.muted}>
              Already paid in the last day or two? Please ignore this note — our
              records update shortly after your bank confirms. For anything
              else, reply to this email or write to {b.supportEmail}.
            </Text>
          </Section>

          <Text style={base.footer}>
            © {new Date().getFullYear()} {b.name}. This is a friendly reminder,
            not a demand for payment.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default PaymentReminder;

export const template = {
  component: PaymentReminder,
  subject: `[${defaultBrand.name}] Gentle reminder — your monthly installment is coming up`,
  displayName: "Payment reminder (monthly)",
  previewData: {
    recipientName: "Priya Sharma",
    membershipNumber: "ARE-2607-A1B2C3",
    memberDisplayId: "GO-482913",
    planName: "Gold",
    invoiceNumber: "INV-2607-045",
    installmentSequence: 3,
    installmentTotal: 12,
    amountDue: 5000,
    currency: "INR",
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    dashboardUrl: "https://app.arasienterprises.com/customer/installments",
  } satisfies PaymentReminderProps,
};
