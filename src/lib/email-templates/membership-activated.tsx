import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import {
  brand as defaultBrand,
  styles,
  formatTimestamp,
  resolveBrand,
  BrandHeader,
  type BrandOverrides,
} from "./_shared";

export interface MembershipActivatedProps {
  recipientName?: string;
  membershipNumber: string;
  planName: string;
  advancePaid: number;
  monthlyInstallment: number;
  durationMonths: number;
  totalAmount: number;
  startDate: string; // ISO date
  endDate?: string | null; // ISO date
  activatedAt: string; // ISO timestamp
  nextDueDate?: string | null; // ISO date
  nextDueAmount?: number | null;
  currency?: string; // default INR
  dashboardUrl?: string;
  brand?: BrandOverrides;
}

const fmt = (amount: number, ccy = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: ccy,
    maximumFractionDigits: 2,
  }).format(amount);

const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      dateStyle: "long",
    });
  } catch {
    return iso;
  }
};

const MembershipActivated: React.FC<MembershipActivatedProps> = ({
  recipientName,
  membershipNumber,
  planName,
  advancePaid,
  monthlyInstallment,
  durationMonths,
  totalAmount,
  startDate,
  endDate,
  activatedAt,
  nextDueDate,
  nextDueAmount,
  currency = "INR",
  dashboardUrl,
}) => {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your {planName} membership at {brand.name} is now active.
      </Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Section style={styles.header}>
              <Text style={styles.brandName}>{brand.name}</Text>
              <Text style={styles.tagline}>{brand.tagline}</Text>
            </Section>

            <Heading as="h1" style={styles.h1}>
              Welcome — your {planName} membership is active
            </Heading>
            <Text style={styles.p}>{greeting}</Text>
            <Text style={styles.p}>
              We've received your advance payment and activated your membership.
              Below is a summary of your plan and next billing details — please
              keep this email for your records.
            </Text>

            <Section style={styles.detailBox}>
              <Text style={styles.detailLabel}>Membership number</Text>
              <Text style={styles.detailValue}>
                <strong style={{ color: "#f5d97a" }}>{membershipNumber}</strong>
              </Text>

              <Text style={styles.detailLabel}>Plan</Text>
              <Text style={styles.detailValue}>{planName}</Text>

              <Text style={styles.detailLabel}>Advance paid</Text>
              <Text style={styles.detailValue}>
                {fmt(advancePaid, currency)}
              </Text>

              <Text style={styles.detailLabel}>Monthly installment</Text>
              <Text style={styles.detailValue}>
                {fmt(monthlyInstallment, currency)} × {durationMonths} months
              </Text>

              <Text style={styles.detailLabel}>Total plan value</Text>
              <Text style={styles.detailValue}>
                {fmt(totalAmount, currency)}
              </Text>

              <Text style={styles.detailLabel}>Membership period</Text>
              <Text style={styles.detailValue}>
                {fmtDate(startDate)} → {fmtDate(endDate)}
              </Text>

              <Text style={styles.detailLabel}>Activated on</Text>
              <Text style={styles.detailValue}>
                {formatTimestamp(activatedAt)}
              </Text>
            </Section>

            {nextDueDate ? (
              <Section style={styles.detailBox}>
                <Text style={styles.detailLabel}>Next installment due</Text>
                <Text style={styles.detailValue}>
                  <strong>{fmtDate(nextDueDate)}</strong>
                  {typeof nextDueAmount === "number"
                    ? ` — ${fmt(nextDueAmount, currency)}`
                    : ""}
                </Text>
                <Text style={styles.muted}>
                  You'll receive a reminder before each due date. You can also
                  pay any installment early from your dashboard.
                </Text>
              </Section>
            ) : null}

            {dashboardUrl ? (
              <Text style={{ ...styles.p, margin: "8px 0 4px" }}>
                <a href={dashboardUrl} style={styles.button}>
                  View my membership
                </a>
              </Text>
            ) : null}

            <Hr style={styles.divider} />
            <Text style={styles.muted}>
              Questions about your membership or billing? Reply to this email or
              write to {brand.supportEmail}.
            </Text>
          </Section>

          <Text style={styles.footer}>
            © {new Date().getFullYear()} {brand.name}. This is an automated
            confirmation for membership {membershipNumber}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default MembershipActivated;

export const template = {
  component: MembershipActivated,
  subject: `[${brand.name}] Your membership is active`,
  displayName: "Membership activated",
  previewData: {
    recipientName: "Priya Sharma",
    membershipNumber: "ARE-2607-A1B2C3",
    planName: "Gold",
    advancePaid: 25000,
    monthlyInstallment: 5000,
    durationMonths: 12,
    totalAmount: 85000,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    activatedAt: new Date().toISOString(),
    nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    nextDueAmount: 5000,
    currency: "INR",
    dashboardUrl: "https://app.arasienterprises.com/customer/membership",
  } satisfies MembershipActivatedProps,
};
