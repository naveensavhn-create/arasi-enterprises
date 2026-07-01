import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { renderRoleChangeEmailPreview } from "@/lib/email-preview.functions";
import { sendRoleChangeTestEmail } from "@/lib/admin.functions";


import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/email-preview")({
  component: EmailPreviewPage,
});


type Kind = "promote" | "revoke";
type Role = "admin" | "promoter" | "customer";

function EmailPreviewPage() {
  const router = useRouter();
  useEffect(() => {
    try {
      localStorage.setItem("arasi:lastPath:admin", router.state.location.pathname);
    } catch {
      /* noop */
    }
  }, [router.state.location.pathname]);

  const [kind, setKind] = useState<Kind>("promote");
  const [recipientName, setRecipientName] = useState("Priya Sharma");
  const [actorName, setActorName] = useState("Arjun Verma");
  const [actorEmail, setActorEmail] = useState("arjun@arasienterprises.com");
  const [previousRole, setPreviousRole] = useState<Role>("customer");
  const [newRole, setNewRole] = useState<Role>("admin");
  const [changedAt, setChangedAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [reason, setReason] = useState(
    "Trusted operator — needs admin access to manage plans and memberships.",
  );
  const [testRecipient, setTestRecipient] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  const render = useServerFn(renderRoleChangeEmailPreview);
  const sendTest = useServerFn(sendRoleChangeTestEmail);

  const renderMutation = useMutation({
    mutationFn: async () =>
      render({
        data: {
          kind,
          recipientName,
          actorName,
          actorEmail,
          previousRole,
          newRole,
          changedAt: new Date(changedAt).toISOString(),
          reason,
        },
      }),
    onSuccess: (res) => {
      setHtml(res.html);
      setSubject(res.subject);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sendTestMutation = useMutation({
    mutationFn: async () =>
      sendTest({
        data: {
          kind,
          recipientEmail: testRecipient.trim() || undefined,
        },
      }),
    onSuccess: (res) => {
      if (res.status === "sent") toast.success("Test email dispatched.");
      else if (res.status === "skipped_no_email_infra")
        toast.warning("Logged, but not sent — no sender domain configured.");
      else toast.message(`Status: ${res.status}`, { description: res.error ?? undefined });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Auto-render once on mount and when kind changes
  useEffect(() => {
    renderMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Preset defaults on kind change
  useEffect(() => {
    if (kind === "promote") {
      setPreviousRole("customer");
      setNewRole("admin");
      setReason("Trusted operator — needs admin access to manage plans and memberships.");
    } else {
      setPreviousRole("admin");
      setNewRole("customer");
      setReason("Role rotation as part of quarterly access review.");
    }
  }, [kind]);

  const iframeSrcDoc = useMemo(() => html ?? "", [html]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email template preview</h1>
          <p className="text-sm text-muted-foreground">
            Render the role-change emails with sample data before they go to a real recipient.
          </p>
        </div>
        <Badge variant="secondary">Admin only</Badge>
      </div>

      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList>
          <TabsTrigger value="promote">Promotion email</TabsTrigger>
          <TabsTrigger value="revoke">Revocation email</TabsTrigger>
        </TabsList>

        <TabsContent value={kind} className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sample data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="recipientName">Recipient name</Label>
                  <Input id="recipientName" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="actorName">Acting admin</Label>
                  <Input id="actorName" value={actorName} onChange={(e) => setActorName(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="actorEmail">Admin email</Label>
                  <Input
                    id="actorEmail"
                    type="email"
                    value={actorEmail}
                    onChange={(e) => setActorEmail(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Previous role</Label>
                    <Select value={previousRole} onValueChange={(v) => setPreviousRole(v as Role)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">customer</SelectItem>
                        <SelectItem value="promoter">promoter</SelectItem>
                        <SelectItem value="admin">admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>New role</Label>
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">customer</SelectItem>
                        <SelectItem value="promoter">promoter</SelectItem>
                        <SelectItem value="admin">admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="changedAt">Changed at</Label>
                  <Input
                    id="changedAt"
                    type="datetime-local"
                    value={changedAt}
                    onChange={(e) => setChangedAt(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reason">Reason</Label>
                  <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>

                <Button
                  className="w-full"
                  onClick={() => renderMutation.mutate()}
                  disabled={renderMutation.isPending}
                >
                  {renderMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Re-render preview
                </Button>

                <div className="pt-4 border-t space-y-3">
                  <Label htmlFor="testRecipient">Send test to (optional)</Label>
                  <Input
                    id="testRecipient"
                    type="email"
                    placeholder="defaults to your own email"
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => sendTestMutation.mutate()}
                    disabled={sendTestMutation.isPending}
                  >
                    {sendTestMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send test email
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Logged in Admin Settings → Email attempts. Requires a configured sender domain to actually deliver.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-[600px]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Rendered HTML</CardTitle>
                  {subject && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Subject: <span className="font-medium text-foreground">{subject}</span>
                    </p>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {html ? (
                  <iframe
                    title="Email preview"
                    srcDoc={iframeSrcDoc}
                    sandbox=""
                    className="w-full h-[720px] rounded-md border bg-white"
                  />
                ) : (
                  <div className="flex items-center justify-center h-[720px] text-sm text-muted-foreground">
                    {renderMutation.isPending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      "Click Re-render to load the preview."
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
