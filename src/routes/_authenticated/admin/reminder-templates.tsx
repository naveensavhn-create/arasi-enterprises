/**
 * Admin editor for the four monthly reminder templates
 * (email/sms × upcoming/overdue). Supports live preview via the existing
 * payment-reminder preview server fn and a "Send test" dialog that dispatches
 * a single message to one recipient using the current (possibly unsaved)
 * template text.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MessageSquare, Save, Send, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listReminderTemplates,
  upsertReminderTemplate,
  sendReminderTestMessage,
  type ReminderTemplate,
} from "@/lib/reminder-templates.functions";
import { renderPaymentReminderEmailPreview } from "@/lib/payment-reminder-preview.functions";

export const Route = createFileRoute(
  "/_authenticated/admin/reminder-templates",
)({
  head: () => ({
    meta: [{ title: "Reminder Templates — Arasi Enterprises" }],
  }),
  component: ReminderTemplatesPage,
});

type Channel = "email" | "sms";
type Kind = "upcoming" | "overdue";

const TABS: Array<{
  key: string;
  channel: Channel;
  kind: Kind;
  label: string;
  icon: typeof Mail;
}> = [
  { key: "email-upcoming", channel: "email", kind: "upcoming", label: "Email · Upcoming", icon: Mail },
  { key: "email-overdue", channel: "email", kind: "overdue", label: "Email · Overdue", icon: Mail },
  { key: "sms-upcoming", channel: "sms", kind: "upcoming", label: "SMS · Upcoming", icon: MessageSquare },
  { key: "sms-overdue", channel: "sms", kind: "overdue", label: "SMS · Overdue", icon: MessageSquare },
];

const VARIABLES = [
  { name: "{{name}}", desc: "Recipient's full name" },
  { name: "{{plan_name}}", desc: "Membership plan (e.g., Gold)" },
  { name: "{{amount}}", desc: "Amount due formatted as currency" },
  { name: "{{due_date}}", desc: "Installment due date" },
  { name: "{{membership}}", desc: "Membership number / display id" },
  { name: "{{support_email}}", desc: "Brand support email" },
];

function ReminderTemplatesPage() {
  const listFn = useServerFn(listReminderTemplates);
  const { data: rows, isLoading } = useQuery({
    queryKey: ["admin-reminder-templates"],
    queryFn: () => listFn(),
  });
  const [active, setActive] = useState(TABS[0].key);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reminder Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the wording of the monthly payment reminders and send a
          test message to yourself or any recipient before saving.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      ) : (
        <Tabs value={active} onValueChange={setActive} className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.key} value={t.key} className="gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {TABS.map((t) => {
            const existing = (rows ?? []).find(
              (r) => r.channel === t.channel && r.reminder_kind === t.kind && r.is_active,
            );
            return (
              <TabsContent key={t.key} value={t.key}>
                <TemplateEditor
                  channel={t.channel}
                  kind={t.kind}
                  existing={existing}
                />
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor for one (channel, kind) template
// ---------------------------------------------------------------------------

interface FormState {
  subject: string;
  heading: string;
  intro: string;
  outro: string;
  sms_greeting: string;
  sms_signature: string;
  is_active: boolean;
}

const EMPTY: FormState = {
  subject: "",
  heading: "",
  intro: "",
  outro: "",
  sms_greeting: "",
  sms_signature: "",
  is_active: true,
};

function TemplateEditor({
  channel,
  kind,
  existing,
}: {
  channel: Channel;
  kind: Kind;
  existing?: ReminderTemplate;
}) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertReminderTemplate);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    setForm({
      subject: existing?.subject ?? "",
      heading: existing?.heading ?? "",
      intro: existing?.intro ?? "",
      outro: existing?.outro ?? "",
      sms_greeting: existing?.sms_greeting ?? "",
      sms_signature: existing?.sms_signature ?? "",
      is_active: existing?.is_active ?? true,
    });
  }, [existing?.id, existing?.updated_at]);

  const save = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: existing?.id,
          channel,
          reminder_kind: kind,
          subject: form.subject || null,
          heading: form.heading || null,
          intro: form.intro || null,
          outro: form.outro || null,
          sms_greeting: form.sms_greeting || null,
          sms_signature: form.sms_signature || null,
          is_active: form.is_active,
        },
      }),
    onSuccess: () => {
      toast.success("Template saved");
      qc.invalidateQueries({ queryKey: ["admin-reminder-templates"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save template"),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {channel === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
            {channel === "email" ? "Email" : "SMS"} · {kind === "upcoming" ? "Upcoming" : "Overdue"}
          </CardTitle>
          <CardDescription>
            {channel === "email"
              ? "Customize the subject line and the two editable paragraphs of the reminder email. The rest of the layout comes from your brand settings."
              : "SMS bodies are locked to the DLT-approved template registered with MSG91. You can customize the greeting prefix and signature used when we build the recipient's name slot."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {channel === "email" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="subject">Subject line</Label>
                <Input
                  id="subject"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="[Brand] Gentle reminder — your monthly installment is coming up"
                  maxLength={200}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="heading">Heading</Label>
                <Input
                  id="heading"
                  value={form.heading}
                  onChange={(e) => setForm({ ...form, heading: e.target.value })}
                  placeholder="A gentle reminder about your upcoming payment"
                  maxLength={200}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="intro">Opening paragraph</Label>
                <Textarea
                  id="intro"
                  rows={4}
                  value={form.intro}
                  onChange={(e) => setForm({ ...form, intro: e.target.value })}
                  placeholder="This is a friendly reminder that your {{plan_name}} membership installment of {{amount}} is due on {{due_date}}."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="outro">Closing paragraph</Label>
                <Textarea
                  id="outro"
                  rows={3}
                  value={form.outro}
                  onChange={(e) => setForm({ ...form, outro: e.target.value })}
                  placeholder="Already paid? Please ignore this note. For anything else, write to {{support_email}}."
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="sms_greeting">Greeting prefix</Label>
                <Input
                  id="sms_greeting"
                  value={form.sms_greeting}
                  onChange={(e) => setForm({ ...form, sms_greeting: e.target.value })}
                  placeholder="Dear"
                  maxLength={60}
                />
                <p className="text-xs text-muted-foreground">
                  Combined with the recipient's name into the DLT template's{" "}
                  <code>##name##</code> slot (e.g. "Dear Priya").
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sms_signature">Signature (optional)</Label>
                <Input
                  id="sms_signature"
                  value={form.sms_signature}
                  onChange={(e) => setForm({ ...form, sms_signature: e.target.value })}
                  placeholder="Team Arasi"
                  maxLength={60}
                />
                <p className="text-xs text-muted-foreground">
                  Reference only — the actual signature is controlled by your
                  DLT-approved MSG91 template.
                </p>
              </div>
              <div className="rounded-md border bg-muted/40 p-3 text-xs flex gap-2 items-start">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  SMS body text is fixed by TRAI/DLT rules and lives in your
                  MSG91 template. To change the actual copy, update the
                  DLT-approved template in MSG91 and keep the variables{" "}
                  <code>##name##</code>, <code>##amount##</code>,{" "}
                  <code>##due##</code>, <code>##membership##</code>.
                </span>
              </div>
            </>
          )}

          <div className="flex items-center gap-3 pt-2 border-t">
            <Switch
              id="active"
              checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
            <Label htmlFor="active" className="cursor-pointer">
              Active (used by the reminder worker)
            </Label>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save template
            </Button>
            <Button variant="outline" onClick={() => setTestOpen(true)}>
              <Send className="h-4 w-4 mr-2" />
              Send test
            </Button>
            {existing ? (
              <Badge variant="secondary" className="ml-auto">
                v{existing.version} · updated{" "}
                {new Date(existing.updated_at).toLocaleString()}
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-auto">
                Not saved yet
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available variables</CardTitle>
            <CardDescription>
              Wrap in double curly braces. Unknown names are left untouched so
              typos are visible in the preview.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {VARIABLES.map((v) => (
              <div key={v.name} className="flex items-center justify-between gap-4">
                <code className="text-xs px-1.5 py-0.5 rounded bg-muted">
                  {v.name}
                </code>
                <span className="text-muted-foreground text-xs text-right">
                  {v.desc}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {channel === "email" ? <EmailPreview form={form} /> : null}
      </div>

      <TestSendDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        channel={channel}
        kind={kind}
        form={form}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email preview (uses existing renderPaymentReminderEmailPreview server fn)
// ---------------------------------------------------------------------------

function EmailPreview({ form }: { form: FormState }) {
  const preview = useServerFn(renderPaymentReminderEmailPreview);
  const [html, setHtml] = useState<string>("");
  const [pending, setPending] = useState(false);

  const refresh = async () => {
    setPending(true);
    try {
      // We render the base preview and inject overrides by asking the fn to
      // include our sample; the real overrides ship through the test-send
      // flow. For preview we just show the untouched brand-styled email so
      // authors can see the frame.
      const res = await preview({
        data: {
          recipientName: "Priya Sharma",
          planName: "Gold",
          amountDue: 5000,
          currency: "INR",
          dueDate: new Date(Date.now() + 3 * 86400_000).toISOString(),
        },
      });
      setHtml(res.html);
    } catch (e) {
      toast.error((e as Error).message || "Preview failed");
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Live preview</CardTitle>
          <CardDescription>Reflects your brand settings.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={pending}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded border overflow-hidden bg-white h-[420px]">
          {html ? (
            <iframe
              title="Email preview"
              srcDoc={html}
              className="w-full h-full"
              sandbox=""
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {pending ? "Rendering…" : "No preview available"}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Note: preview shows brand chrome only. Use <strong>Send test</strong>{" "}
          to see your current subject/intro/outro edits in your inbox.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Test-send dialog (email or SMS)
// ---------------------------------------------------------------------------

function TestSendDialog({
  open,
  onOpenChange,
  channel,
  kind,
  form,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: Channel;
  kind: Kind;
  form: FormState;
}) {
  const send = useServerFn(sendReminderTestMessage);
  const [toEmail, setToEmail] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [name, setName] = useState("Priya Sharma");
  const [plan, setPlan] = useState("Gold");
  const [amount, setAmount] = useState<number>(5000);
  const [dueDate, setDueDate] = useState<string>(
    new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
  );
  const [membership, setMembership] = useState("ARE-2607-A1B2C3");

  const mut = useMutation({
    mutationFn: () =>
      send({
        data: {
          channel,
          reminder_kind: kind,
          subject: form.subject || undefined,
          heading: form.heading || undefined,
          intro: form.intro || undefined,
          outro: form.outro || undefined,
          sms_greeting: form.sms_greeting || undefined,
          sms_signature: form.sms_signature || undefined,
          recipient_name: name,
          plan_name: plan,
          amount,
          due_date: dueDate,
          membership,
          to_email: channel === "email" ? toEmail || undefined : undefined,
          to_phone: channel === "sms" ? toPhone || undefined : undefined,
        },
      }),
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message || "Test message dispatched");
      else toast.error(res.error_message || res.error_code || "Test failed");
    },
    onError: (e: Error) => toast.error(e.message || "Test failed"),
  });

  const canSend = useMemo(
    () => (channel === "email" ? !!toEmail : !!toPhone),
    [channel, toEmail, toPhone],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send test {channel === "email" ? "email" : "SMS"}</DialogTitle>
          <DialogDescription>
            Uses the {form.is_active ? "current" : "draft"} edits above along
            with the sample values below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {channel === "email" ? (
            <div className="grid gap-2">
              <Label htmlFor="to_email">Recipient email</Label>
              <Input
                id="to_email"
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="to_phone">Recipient phone (E.164)</Label>
              <Input
                id="to_phone"
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
                placeholder="+919876543210"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="s_name" className="text-xs">Name</Label>
              <Input id="s_name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="s_plan" className="text-xs">Plan</Label>
              <Input id="s_plan" value={plan} onChange={(e) => setPlan(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="s_amt" className="text-xs">Amount (₹)</Label>
              <Input
                id="s_amt"
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="s_due" className="text-xs">Due date</Label>
              <Input
                id="s_due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1 col-span-2">
              <Label htmlFor="s_mem" className="text-xs">Membership</Label>
              <Input
                id="s_mem"
                value={membership}
                onChange={(e) => setMembership(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!canSend || mut.isPending}>
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
