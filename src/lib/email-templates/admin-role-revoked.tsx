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
  /** Site Settings brand overrides (logo URL, colours, support email). */
  brand?: BrandOverrides;
}

const AdminRoleRevoked: React.FC<AdminRoleRevokedProps> = ({
  recipientName,
  actorName,
  actorEmail,
  previousRole,
  newRole,
  changedAt,
  reason,
  brand,
}) => {
  const b = resolveBrand(brand);
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your {previousRole} access at {b.name} has been revoked.
      </Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <BrandHeader b={b} />

            <Heading as="h1" style={styles.h1}>
              Your {previousRole} access has been revoked
            </Heading>
            <Text style={styles.p}>{greeting}</Text>
            <Text style={styles.p}>
              An administrator has changed your account role on {b.name}.
              You will no longer have{" "}
              <strong style={{ color: b.accent }}>{previousRole}</strong>{" "}
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
              {b.supportEmail} so an administrator can review the change.
            </Text>
          </Section>

          <Text style={styles.footer}>
            © {new Date().getFullYear()} {b.name}. This is an automated
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
  subject: `[${defaultBrand.name}] Your admin access has been revoked`,
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
