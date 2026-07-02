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

export interface AdminRolePromotedProps {
  /** Name or email of the person being promoted (target). */
  recipientName?: string;
  /** Full name of the admin who performed the action. */
  actorName: string;
  /** Email of the admin who performed the action. */
  actorEmail: string;
  /** Previous role, e.g. "customer" | "promoter". */
  previousRole: string;
  /** New role granted, typically "admin". */
  newRole: string;
  /** ISO timestamp of the change. */
  changedAt: string;
  /** Reason provided by the acting admin (required, min 5 chars upstream). */
  reason: string;
  /** Optional deep link to the admin dashboard. */
  dashboardUrl?: string;
  /** Site Settings brand overrides (logo URL, colours, support email). */
  brand?: BrandOverrides;
}

const AdminRolePromoted: React.FC<AdminRolePromotedProps> = ({
  recipientName,
  actorName,
  actorEmail,
  previousRole,
  newRole,
  changedAt,
  reason,
  dashboardUrl,
  brand,
}) => {
  const b = resolveBrand(brand);
  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your role at {b.name} has been upgraded to {newRole}.
      </Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <BrandHeader b={b} />

            <Heading as="h1" style={styles.h1}>
              You've been promoted to {newRole}
            </Heading>
            <Text style={styles.p}>{greeting}</Text>
            <Text style={styles.p}>
              Your account role on {b.name} has just been elevated. You now
              have full <strong style={{ color: b.accent }}>{newRole}</strong>{" "}
              privileges across the platform.
            </Text>

            <Section style={styles.detailBox}>
              <Text style={styles.detailLabel}>Role change</Text>
              <Text style={styles.detailValue}>
                {previousRole} → <strong>{newRole}</strong>
              </Text>

              <Text style={styles.detailLabel}>Granted by</Text>
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

            {dashboardUrl ? (
              <Text style={{ ...styles.p, margin: "8px 0 4px" }}>
                <a href={dashboardUrl} style={{ ...styles.button, backgroundColor: b.primary }}>
                  Open admin dashboard
                </a>
              </Text>
            ) : null}

            <Hr style={styles.divider} />
            <Text style={styles.muted}>
              If you did not expect this change, reply to this email or contact{" "}
              {b.supportEmail} immediately so we can investigate.
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

export default AdminRolePromoted;

// Optional registry entry (used once transactional email infra is wired up).
export const template = {
  component: AdminRolePromoted,
  subject: `[${defaultBrand.name}] Your role has been upgraded`,
  displayName: "Admin role promoted",
  previewData: {
    recipientName: "Priya Sharma",
    actorName: "Rahul Verma",
    actorEmail: "rahul@arasienterprises.com",
    previousRole: "customer",
    newRole: "admin",
    changedAt: new Date().toISOString(),
    reason: "Promoting Priya to help manage collections and payments.",
    dashboardUrl: "https://app.arasienterprises.com/admin/settings",
  } satisfies AdminRolePromotedProps,
};
