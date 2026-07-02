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
  colors,
  styles,
  formatTimestamp,
  resolveBrand,
  BrandHeader,
  type BrandOverrides,
} from "./_shared";

export type RewardClaimStatus =
  | "locked"
  | "eligible"
  | "requested"
  | "approved"
  | "dispatched"
  | "delivered"
  | "rejected";

export interface RewardClaimStatusProps {
  recipientName?: string;
  rewardNumber?: string | null;
  tierName: string;
  fromStatus?: RewardClaimStatus | null;
  toStatus: RewardClaimStatus;
  trackingReference?: string | null;
  adminNote?: string | null;
  changedAt: string;
  actionUrl?: string;
  brand?: BrandOverrides;
}

const HEADLINE: Record<RewardClaimStatus, string> = {
  locked: "Your reward has been locked",
  eligible: "Your reward is ready to claim",
  requested: "We've received your claim request",
  approved: "Your reward claim has been approved",
  dispatched: "Your reward is on its way",
  delivered: "Your reward has been delivered",
  rejected: "Your reward claim needs your attention",
};

const INTRO: Record<RewardClaimStatus, string> = {
  locked:
    "This reward is currently locked pending further eligibility. We'll let you know as soon as it re-opens.",
  eligible:
    "Great news — you can now request to claim this reward from your customer portal.",
  requested:
    "Thanks for submitting your claim. Our team will review it and update you shortly.",
  approved:
    "Your claim has been approved. We're preparing dispatch and will share tracking details next.",
  dispatched:
    "We've dispatched your reward. Use the tracking details below to follow its journey.",
  delivered:
    "Your reward has been marked as delivered. We hope you enjoy it — thank you for being an Arasi member.",
  rejected:
    "Unfortunately your claim could not be approved at this time. Please review the note below and reach out if you'd like us to reconsider.",
};

const ACCENT: Record<RewardClaimStatus, string> = {
  locked: colors.textMuted,
  eligible: colors.gold,
  requested: colors.goldSoft,
  approved: colors.success,
  dispatched: colors.gold,
  delivered: colors.success,
  rejected: colors.danger,
};

const label = (s: RewardClaimStatus) =>
  s.charAt(0).toUpperCase() + s.slice(1);

const RewardClaimStatusEmail: React.FC<RewardClaimStatusProps> = ({
  recipientName,
  rewardNumber,
  tierName,
  fromStatus,
  toStatus,
  trackingReference,
  adminNote,
  changedAt,
  actionUrl,
  brand,
}) => {
  const b = resolveBrand(brand);
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  const accent = ACCENT[toStatus] ?? colors.gold;

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {HEADLINE[toStatus]} — {tierName}
      </Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <BrandHeader b={b} />


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
              {label(toStatus)}
            </Text>

            <Heading as="h1" style={styles.h1}>
              {HEADLINE[toStatus]}
            </Heading>
            <Text style={styles.p}>{greeting}</Text>
            <Text style={styles.p}>{INTRO[toStatus]}</Text>

            <Section style={styles.detailBox}>
              <Text style={styles.detailLabel}>Reward tier</Text>
              <Text style={styles.detailValue}>
                <strong style={{ color: colors.goldSoft }}>{tierName}</strong>
              </Text>

              {rewardNumber ? (
                <>
                  <Text style={styles.detailLabel}>Reward ID</Text>
                  <Text style={styles.detailValue}>{rewardNumber}</Text>
                </>
              ) : null}

              {fromStatus ? (
                <>
                  <Text style={styles.detailLabel}>Status change</Text>
                  <Text style={styles.detailValue}>
                    {label(fromStatus)} → {" "}
                    <strong style={{ color: accent }}>{label(toStatus)}</strong>
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.detailLabel}>Current status</Text>
                  <Text style={{ ...styles.detailValue, color: accent, fontWeight: 700 }}>
                    {label(toStatus)}
                  </Text>
                </>
              )}

              {trackingReference ? (
                <>
                  <Text style={styles.detailLabel}>Tracking reference</Text>
                  <Text style={styles.detailValue}>{trackingReference}</Text>
                </>
              ) : null}

              <Text style={styles.detailLabel}>Updated at</Text>
              <Text style={styles.detailValue}>{formatTimestamp(changedAt)}</Text>

              {adminNote && adminNote.trim().length > 0 ? (
                <>
                  <Text style={styles.detailLabel}>Note from our team</Text>
                  <Text style={styles.reasonBox}>&ldquo;{adminNote}&rdquo;</Text>
                </>
              ) : null}
            </Section>

            {actionUrl ? (
              <Text style={{ ...styles.p, margin: "8px 0 4px" }}>
                <a href={actionUrl} style={styles.button}>
                  View reward details
                </a>
              </Text>
            ) : null}

            <Hr style={styles.divider} />
            <Text style={styles.muted}>
              Need help? Reply to this email or write to {brand.supportEmail}.
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

export default RewardClaimStatusEmail;

export const template = {
  component: RewardClaimStatusEmail,
  subject: `[${brand.name}] Reward claim update`,
  displayName: "Reward claim status",
  previewData: {
    recipientName: "Priya Sharma",
    rewardNumber: "RWD-000123",
    tierName: "Gold Milestone",
    fromStatus: "approved",
    toStatus: "dispatched",
    trackingReference: "DTDC-9F82K4",
    adminNote: "Dispatched via DTDC on 12 Jul; expected delivery in 3-4 days.",
    changedAt: new Date().toISOString(),
    actionUrl: "https://app.arasienterprises.com/customer/rewards",
  } satisfies RewardClaimStatusProps,
};
