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
import { brand, colors, styles, formatTimestamp } from "./_shared";

export interface KycDecisionProps {
  /** Name of the customer/promoter whose KYC was reviewed. */
  recipientName?: string;
  /** Outcome of the review. */
  decision: "approved" | "rejected";
  /** Full name of the admin who reviewed the KYC. */
  reviewerName?: string;
  /** Email of the admin who reviewed the KYC. */
  reviewerEmail?: string;
  /** ISO timestamp of when the decision was recorded. */
  reviewedAt: string;
  /** Admin review notes (shown verbatim; required for rejections, optional for approvals). */
  reviewNotes?: string;
  /** Optional role assigned as part of the approval (e.g. "promoter" | "customer"). */
  assignedRole?: string;
  /** Optional deep link into the user's KYC page for follow-up. */
  actionUrl?: string;
}

const KycDecision: React.FC<KycDecisionProps> = ({
  recipientName,
  decision,
  reviewerName,
  reviewerEmail,
  reviewedAt,
  reviewNotes,
  assignedRole,
  actionUrl,
}) => {
  const approved = decision === "approved";
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  const accent = approved ? colors.success : colors.danger;
  const badgeLabel = approved ? "KYC Approved" : "KYC Rejected";
  const headline = approved
    ? "Your KYC has been approved"
    : "Your KYC needs your attention";
  const intro = approved
    ? `Great news — your identity documents have been verified and your account with ${brand.name} is now fully activated.`
    : `We reviewed your identity documents and were unable to approve them at this time. Please review the notes below and resubmit your KYC.`;

  const reviewer =
    reviewerName && reviewerEmail
      ? `${reviewerName} (${reviewerEmail})`
      : reviewerName ?? reviewerEmail ?? "Arasi Compliance Team";

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {approved
          ? `Your ${brand.name} KYC has been approved.`
          : `Your ${brand.name} KYC was not approved — action required.`}
      </Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Section style={styles.header}>
              <Text style={styles.brandName}>{brand.name}</Text>
              <Text style={styles.tagline}>{brand.tagline}</Text>
            </Section>

            <Text
              style={{
                display: "inline-block",
                padding: "6px 12px",
                borderRadius: "999px",
                backgroundColor: `${accent}1a`,
                color: accent,
                border: `1px solid ${accent}55`,
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                margin: "0 0 12px",
              }}
            >
              {badgeLabel}
            </Text>

            <Heading as="h1" style={styles.h1}>
              {headline}
            </Heading>
            <Text style={styles.p}>{greeting}</Text>
            <Text style={styles.p}>{intro}</Text>

            <Section style={styles.detailBox}>
              <Text style={styles.detailLabel}>Decision</Text>
              <Text style={{ ...styles.detailValue, color: accent, fontWeight: 700 }}>
                {approved ? "Approved" : "Rejected"}
              </Text>

              <Text style={styles.detailLabel}>Reviewed by</Text>
              <Text style={styles.detailValue}>{reviewer}</Text>

              <Text style={styles.detailLabel}>Reviewed at</Text>
              <Text style={styles.detailValue}>{formatTimestamp(reviewedAt)}</Text>

              {approved && assignedRole ? (
                <>
                  <Text style={styles.detailLabel}>Account role</Text>
                  <Text style={styles.detailValue}>
                    <strong style={{ color: colors.goldSoft }}>{assignedRole}</strong>
                  </Text>
                </>
              ) : null}

              <Text style={styles.detailLabel}>Admin review notes</Text>
              <Text style={styles.reasonBox}>
                {reviewNotes && reviewNotes.trim().length > 0
                  ? `"${reviewNotes}"`
                  : approved
                  ? "No additional notes were left by the reviewer."
                  : "No specific notes were provided. Please contact support for details."}
              </Text>
            </Section>

            {actionUrl ? (
              <Text style={{ ...styles.p, margin: "8px 0 4px" }}>
                <a href={actionUrl} style={styles.button}>
                  {approved ? "Go to your dashboard" : "Update KYC details"}
                </a>
              </Text>
            ) : null}

            <Hr style={styles.divider} />
            <Text style={styles.muted}>
              {approved
                ? `Welcome aboard! If anything looks off, reply to this email or reach us at ${brand.supportEmail}.`
                : `If you believe this decision is a mistake, reply to this email or contact ${brand.supportEmail} and we'll take another look.`}
            </Text>
          </Section>

          <Text style={styles.footer}>
            © {new Date().getFullYear()} {brand.name}. This is an automated
            account notification.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default KycDecision;

export const template = {
  component: KycDecision,
  subject: `[${brand.name}] Your KYC decision`,
  displayName: "KYC decision",
  previewData: {
    recipientName: "Priya Sharma",
    decision: "approved",
    reviewerName: "Rahul Verma",
    reviewerEmail: "rahul@arasienterprises.com",
    reviewedAt: new Date().toISOString(),
    reviewNotes:
      "Aadhaar details match the profile. Approved for promoter access.",
    assignedRole: "promoter",
    actionUrl: "https://app.arasienterprises.com/kyc",
  } satisfies KycDecisionProps,
};
