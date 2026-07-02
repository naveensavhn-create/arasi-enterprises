import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Eye, ShieldAlert, ScrollText, Clock, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/admin/docs/impersonation")({
  head: () => ({
    meta: [
      { title: "Impersonation — Admin Docs · Arasi Enterprises" },
      {
        name: "description",
        content:
          "How admin view-as works at Arasi: read-only vs full access modes, safeguards, session limits, and where to find audit logs.",
      },
    ],
  }),
  component: ImpersonationDocsPage,
});

function ImpersonationDocsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
          Admin documentation
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          Impersonation (View-As)
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Impersonation lets a Super Admin experience the app exactly as a
          customer or promoter sees it — without needing their password. It is
          intentionally short, always audited, and defaults to read-only.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
            Modes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Read-only</Badge>
              <span className="text-muted-foreground">Default</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              You see every page the target user would see, but the database
              rejects every write. Buttons that save, submit, delete, or pay
              will fail with an <em>“Impersonation session is read-only”</em>
              error. Safe for support triage and “what does the customer see?”
              investigations.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="destructive">Full access</Badge>
              <span className="text-muted-foreground">Elevated</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              Writes are allowed and every mutation performed during the
              session is recorded as an <code>impersonation.mutation</code>{" "}
              audit entry — including the table, operation, and target row.
              Use only when a change must be made on the user’s behalf and
              they cannot do it themselves.
            </p>
          </div>
        </CardContent>
      </Card>

      <Alert className="mt-6 border-amber-500/40 bg-amber-500/10">
        <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
        <AlertTitle>Limitations of full access</AlertTitle>
        <AlertDescription>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              You cannot change the target user’s password, email, phone, or
              MFA settings — those flows require the account holder.
            </li>
            <li>
              You cannot grant, revoke, or self-elevate roles from within an
              impersonation session; role changes must be made from your own
              admin account.
            </li>
            <li>
              Payments initiated inside a session are attributed to the target
              user but the audit log always records the acting admin.
            </li>
            <li>
              Background jobs, webhooks, and cron tasks are never treated as
              impersonation writes; only in-app mutations are attributed.
            </li>
            <li>
              Sessions are capped at <strong>30 minutes</strong> and end
              automatically when the admin signs out or the session token is
              revoked server-side. A stale banner will clear itself on the
              next focus or poll.
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
            Starting and ending a session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Start a session from the target user’s row on{" "}
            <Link to="/admin/customers" className="text-primary underline-offset-4 hover:underline">
              Customers
            </Link>{" "}
            or{" "}
            <Link to="/admin/promoters" className="text-primary underline-offset-4 hover:underline">
              Promoters
            </Link>
            . Pick a mode, add a reason, and confirm. A gold banner and a
            floating <strong>Return to Admin Dashboard</strong> button remain
            visible on every page until the session ends.
          </p>
          <p>
            End the session from the banner, the floating action button, or
            by signing out. The system also ends stale sessions automatically
            after 30 minutes or when the admin account signs out from any tab.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            Where to find audit logs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Every start, end, and full-access mutation is written to the admin
            audit log with the acting admin, target user, mode, reason, IP,
            user-agent, and (for mutations) the table and row that changed.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <Link to="/admin/audit-log" className="text-primary underline-offset-4 hover:underline">
                Admin → Audit Log
              </Link>{" "}
              — filter by event type <code>impersonation.start</code>,{" "}
              <code>impersonation.end</code>, or any
              per-action entry named{" "}
              <code>impersonation.mutation.&lt;table&gt;.&lt;op&gt;</code>{" "}
              (e.g. <code>impersonation.mutation.memberships.update</code>).
              Each mutation record includes the affected record IDs and the
              exact columns that changed. Filter by customer or
              promoter to see everything done on that account. Export to CSV
              for compliance reviews.
            </li>

            <li>
              <Link to="/admin/reconciliation" className="text-primary underline-offset-4 hover:underline">
                Admin → Reconciliation
              </Link>{" "}
              — flags mismatches between expected state and audit history,
              which will surface any full-access mutation that skipped normal
              flows.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" aria-hidden="true" />
            Good practice
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>Prefer read-only unless a write is truly required.</li>
            <li>Always write a specific reason (ticket ID, caller, purpose).</li>
            <li>End the session as soon as the task is complete.</li>
            <li>
              Never share screenshots of another user’s PII outside approved
              channels.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
