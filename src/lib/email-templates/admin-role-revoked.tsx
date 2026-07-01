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
import { brand, styles, formatTimestamp } from "./_shared";

export interface AdminRoleRevokedProps {
  /** Name or email of the person whose admin access was revoked. */
  recipientName?: string;
  /** Admin who performed the revoke. */
  actorName: string;
  actorEmail: string;
  /** Previous role, typically "admin". */
  previousRole: string;
  /** Role they've been moved down to, e.g. "promoter" | "customer". */
  newRole: string;
  /** ISO timestamp. */
  changedAt: string;
  /** Reason recorded by the acting admin (required upstream). */
  reason: string;
}

const AdminRoleRevoked: React.FC<AdminRoleRevokedProps> = ({
  recipientName,
  actorName,
  actorEmail,
  previousRole,
  newRole,
  changedAt,
  reason,
}) => {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your {previousRole} access at {brand.name} has been revoked.
      </Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Section style={styles.header}>
              <Text style={styles.brandName}>{brand.name}</Text>
              <Text style={styles.tagline}>{brand.tagline}</Text>
            </Section>

            <Heading as="h1" style={styles.h1}>
              Your {previousRole} access has been revoked
            </Heading>
            <Text style={styles.p}>{greeting}</Text>
            <Text style={styles.p}>
              An administrator has changed your account role on {brand.name}.
              You will no longer have{" "}
              <strong style={{ color: "#f5d97a" }}>{previousRole}</strong>{" "}
              privileges. Your account remains active with{" "}
              <strong>{newRole}</strong> access.
            </Text>

            <Section style={styles.detailBox}>
              <Text style={styles.detailLabel}>Role change</Text>
              <Text style={styles.detailValue}>
                {previousRole} → <strong>{newRole}</strong>
              </Text>

              <Text style={styles.detailLabel}>Performed by</Text>
              <Text style={styles.detailValue}>
                {actorName} ({actorEmail})
              </Text>

              <Text style={styles.detailLabel}>When</Text>
              <Text style={styles.detailValue}>
                {formatTimestamp(changedAt)}
              </Text>

              <Text style={styles.detailLabel}>Reason</Text>
              <Text style={styles.reasonBox}>"{reason}"</Text>
            </Section>

            <Text style={styles.p}>
              Any active sessions with elevated privileges will be terminated on
              your next request. All previous actions remain logged in the
              admin audit history.
            </Text>

            <Hr style={styles.divider} />
            <Text style={styles.muted}>
              Believe this was a mistake? Reply to this email or contact{" "}
              {brand.supportEmail} so an administrator can review the change.
            </Text>
          </Section>

          <Text style={styles.footer}>
            © {new Date().getFullYear()} {brand.name}. This is an automated
            security notification.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default AdminRoleRevoked;

export const template = {
  component: AdminRoleRevoked,
  subject: `[${brand.name}] Your admin access has been revoked`,
  displayName: "Admin role revoked",
  previewData: {
    recipientName: "Priya Sharma",
    actorName: "Rahul Verma",
    actorEmail: "rahul@arasienterprises.com",
    previousRole: "admin",
    newRole: "promoter",
    changedAt: new Date().toISOString(),
    reason: "Scoping down access after project handover.",
  } satisfies AdminRoleRevokedProps,
};
