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

export interface RewardUnlockedProps {
  recipientName?: string;
  rewardNumber?: string | null;
  tierName: string;
  tierDescription?: string | null;
  rewardValue?: number | null;
  membershipNumber?: string | null;
  unlockedAt: string;
  actionUrl?: string;
}

const RewardUnlocked: React.FC<RewardUnlockedProps> = ({
  recipientName,
  rewardNumber,
  tierName,
  tierDescription,
  rewardValue,
  membershipNumber,
  unlockedAt,
  actionUrl,
}) => {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  const value =
    rewardValue && rewardValue > 0
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 0,
        }).format(rewardValue)
      : null;

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Congratulations — you've unlocked the {tierName} reward on {brand.name}.
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
                backgroundColor: `${colors.gold}1a`,
                color: colors.gold,
                border: `1px solid ${colors.gold}55`,
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                margin: "0 0 12px",
              }}
            >
              Reward Unlocked
            </Text>

            <Heading as="h1" style={styles.h1}>
              Congratulations — you've unlocked {tierName}!
            </Heading>
            <Text style={styles.p}>{greeting}</Text>
            <Text style={styles.p}>
              Your loyalty with {brand.name} has just paid off. You are now
              eligible to claim the reward below.
            </Text>

            <Section style={styles.detailBox}>
              <Text style={styles.detailLabel}>Reward tier</Text>
              <Text style={styles.detailValue}>
                <strong style={{ color: colors.goldSoft }}>{tierName}</strong>
              </Text>

              {tierDescription ? (
                <>
                  <Text style={styles.detailLabel}>What you get</Text>
                  <Text style={styles.detailValue}>{tierDescription}</Text>
                </>
              ) : null}

              {value ? (
                <>
                  <Text style={styles.detailLabel}>Estimated value</Text>
                  <Text style={styles.detailValue}>{value}</Text>
                </>
              ) : null}

              {rewardNumber ? (
                <>
                  <Text style={styles.detailLabel}>Reward ID</Text>
                  <Text style={styles.detailValue}>{rewardNumber}</Text>
                </>
              ) : null}

              {membershipNumber ? (
                <>
                  <Text style={styles.detailLabel}>Membership</Text>
                  <Text style={styles.detailValue}>{membershipNumber}</Text>
                </>
              ) : null}

              <Text style={styles.detailLabel}>Unlocked at</Text>
              <Text style={styles.detailValue}>{formatTimestamp(unlockedAt)}</Text>
            </Section>

            {actionUrl ? (
              <Text style={{ ...styles.p, margin: "8px 0 4px" }}>
                <a href={actionUrl} style={styles.button}>
                  Claim your reward
                </a>
              </Text>
            ) : null}

            <Hr style={styles.divider} />
            <Text style={styles.muted}>
              Questions about this reward? Reply to this email or reach us at{" "}
              {brand.supportEmail}.
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

export default RewardUnlocked;

export const template = {
  component: RewardUnlocked,
  subject: `[${brand.name}] You've unlocked a reward`,
  displayName: "Reward unlocked",
  previewData: {
    recipientName: "Priya Sharma",
    rewardNumber: "RWD-000123",
    tierName: "Gold Milestone",
    tierDescription:
      "A commemorative gold-plated coin plus a ₹5,000 credit toward your next plan.",
    rewardValue: 5000,
    membershipNumber: "ARASI-000456",
    unlockedAt: new Date().toISOString(),
    actionUrl: "https://app.arasienterprises.com/customer/rewards",
  } satisfies RewardUnlockedProps,
};
