import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  VERIFICATION_PROVIDERS,
  type VerificationType,
  type VerificationRequirement,
  type VerificationProviderDef,
  type ProviderField,
} from "@/lib/verification-providers";
import {
  getVerificationDashboard,
  listVerificationSettings,
  upsertVerificationSetting,
  testVerificationConnection,
  listVerificationFlowSteps,
  updateVerificationFlowSteps,
  type VerificationSettingRow,
  type VerificationFlowStep,
} from "@/lib/verification-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/verification-settings")({
  head: () => ({ meta: [{ title: "Verification Settings — Admin" }] }),
  component: VerificationSettingsPage,
});

function StatusPill({ row }: { row: { status: string; enabled: boolean } }) {
  const label =
    row.status === "active"
      ? "Active"
      : row.status === "misconfigured"
        ? "Misconfigured"
        : "Disabled";
  const cls =
    row.status === "active"
      ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
      : row.status === "misconfigured"
        ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={`gap-1 ${cls}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {label}
    </Badge>
  );
}

function DashboardCards() {
  const getDashboard = useServerFn(getVerificationDashboard);
  const dashboard = useQuery({
    queryKey: ["verification-dashboard"],
    queryFn: () => getDashboard(),
  });
  if (dashboard.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      </div>
    );
  }
  const rows = dashboard.data ?? [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((r) => (
        <Card key={r.verification_type}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="capitalize">
                {r.verification_type === "mobile_otp" ? "Mobile OTP" : "Email Verification"}
              </span>
              <StatusPill row={r} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span className="font-medium">{r.provider}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Requirement</span><span className="capitalize">{r.requirement}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Mode</span><span>{r.sandbox_mode ? "Sandbox" : "Production"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last check</span><span>{r.last_test_at ? new Date(r.last_test_at).toLocaleString() : "Never"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last success</span><span>{r.last_success_at ? new Date(r.last_success_at).toLocaleString() : "—"}</span></div>
            {r.last_test_message ? (
              <div className="mt-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                {r.last_test_message}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type FormState = {
  provider: string;
  enabled: boolean;
  requirement: VerificationRequirement;
  sandbox_mode: boolean;
  config: Record<string, string>;
  credentials: Record<string, string>;
};

function initialFormFor(
  verificationType: VerificationType,
  row: VerificationSettingRow | undefined,
): FormState {
  const providerId = row?.provider ?? VERIFICATION_PROVIDERS[verificationType][0]?.id ?? "";
  const config: Record<string, string> = {};
  if (row) {
    for (const [k, v] of Object.entries(row.config)) {
      config[k] = v == null ? "" : String(v);
    }
  }
  return {
    provider: providerId,
    enabled: row?.enabled ?? false,
    requirement: row?.requirement ?? "optional",
    sandbox_mode: row?.sandbox_mode ?? true,
    config,
    credentials: {},
  };
}

function ProviderFieldInput({
  field,
  value,
  onChange,
  placeholder,
}: {
  field: ProviderField;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const id = `field-${field.key}`;
  if (field.type === "select") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id}>{field.label}{field.optional ? <span className="ml-1 text-xs text-muted-foreground">(optional)</span> : null}</Label>
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{field.label}{field.optional ? <span className="ml-1 text-xs text-muted-foreground">(optional)</span> : null}</Label>
      <Input
        id={id}
        type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
        value={value}
        placeholder={placeholder ?? field.placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
    </div>
  );
}

function ProviderConfigCard({
  verificationType,
  row,
}: {
  verificationType: VerificationType;
  row: VerificationSettingRow | undefined;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertVerificationSetting);
  const testFn = useServerFn(testVerificationConnection);

  const [form, setForm] = useState<FormState>(() => initialFormFor(verificationType, row));
  const providers = VERIFICATION_PROVIDERS[verificationType];
  const providerDef: VerificationProviderDef | undefined = providers.find(
    (p) => p.id === form.provider,
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!providerDef) throw new Error("Select a provider");
      const configForSubmit: Record<string, string | number | boolean | null> = {};
      for (const field of providerDef.configFields) {
        const raw = form.config[field.key] ?? "";
        if (raw === "") continue;
        configForSubmit[field.key] = field.type === "number" ? Number(raw) : raw;
      }
      const creds: Record<string, string> = {};
      for (const field of providerDef.credentialFields) {
        const v = form.credentials[field.key];
        if (typeof v === "string" && v.length > 0) creds[field.key] = v;
      }
      return upsertFn({
        data: {
          verification_type: verificationType,
          provider: form.provider,
          enabled: form.enabled,
          requirement: form.requirement,
          sandbox_mode: form.sandbox_mode,
          config: configForSubmit,
          credentials: creds,
        },
      });
    },
    onSuccess: (updated) => {
      toast.success("Verification settings saved");
      setForm(initialFormFor(verificationType, updated));
      qc.invalidateQueries({ queryKey: ["verification-settings"] });
      qc.invalidateQueries({ queryKey: ["verification-dashboard"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { verification_type: verificationType } }),
    onSuccess: (result) => {
      if (result.ok) toast.success(`Connection OK — ${result.message}`);
      else toast.error(`Connection failed — ${result.message}`);
      qc.invalidateQueries({ queryKey: ["verification-settings"] });
      qc.invalidateQueries({ queryKey: ["verification-dashboard"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Test failed"),
  });

  const title = verificationType === "mobile_otp" ? "Mobile OTP Verification" : "Email Verification";
  const preview = row?.credential_preview ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>{title}</span>
          {row ? <StatusPill row={{ status: row.enabled ? (row.has_credentials ? "active" : "misconfigured") : "disabled", enabled: row.enabled }} /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Provider</Label>
            <Select
              value={form.provider}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, provider: v, credentials: {} }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Requirement</Label>
            <Select
              value={form.requirement}
              onValueChange={(v: VerificationRequirement) =>
                setForm((f) => ({ ...f, requirement: v }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mandatory">Mandatory</SelectItem>
                <SelectItem value="optional">Optional</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
            <span>Enabled</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.sandbox_mode} onCheckedChange={(v) => setForm((f) => ({ ...f, sandbox_mode: v }))} />
            <span>Sandbox mode</span>
          </label>
        </div>

        {providerDef ? (
          <>
            <Separator />
            <div>
              <div className="mb-3 text-sm font-medium text-muted-foreground">Provider configuration</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {providerDef.configFields.map((field) => (
                  <ProviderFieldInput
                    key={field.key}
                    field={field}
                    value={form.config[field.key] ?? ""}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, config: { ...f.config, [field.key]: v } }))
                    }
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 text-sm font-medium text-muted-foreground">Credentials (encrypted at rest)</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {providerDef.credentialFields.map((field) => (
                  <ProviderFieldInput
                    key={field.key}
                    field={field}
                    value={form.credentials[field.key] ?? ""}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, credentials: { ...f.credentials, [field.key]: v } }))
                    }
                    placeholder={preview[field.key] ? `Current: ${preview[field.key]}` : field.placeholder}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Leave a credential blank to keep the existing value.
              </p>
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !row}>
            {test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
            Test connection
          </Button>
          {row?.last_test_status ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {row.last_test_status === "success" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              {row.last_test_at ? new Date(row.last_test_at).toLocaleString() : ""}
              {row.last_test_latency_ms ? ` · ${row.last_test_latency_ms} ms` : ""}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FlowBuilder() {
  const qc = useQueryClient();
  const listFn = useServerFn(listVerificationFlowSteps);
  const updateFn = useServerFn(updateVerificationFlowSteps);
  const q = useQuery({ queryKey: ["verification-flow"], queryFn: () => listFn() });
  const [local, setLocal] = useState<VerificationFlowStep[] | null>(null);

  const steps = local ?? q.data ?? [];
  const dirty = local !== null;

  const move = (index: number, delta: number) => {
    const next = [...steps];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLocal(next.map((s, i) => ({ ...s, position: (i + 1) * 10 })));
  };
  const toggle = (id: string, enabled: boolean) => {
    setLocal(steps.map((s) => (s.id === id ? { ...s, enabled: s.is_system ? true : enabled } : s)));
  };

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          steps: steps.map((s) => ({ id: s.id, position: s.position, enabled: s.enabled })),
        },
      }),
    onSuccess: (rows) => {
      toast.success("Registration flow updated");
      setLocal(null);
      qc.setQueryData(["verification-flow"], rows);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to save flow"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Registration Flow Builder</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <ol className="space-y-2">
            {steps.map((step, idx) => (
              <li
                key={step.id}
                className="flex items-center gap-3 rounded-md border bg-card/40 px-3 py-2"
              >
                <span className="w-6 text-center text-xs text-muted-foreground">{idx + 1}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{step.label}</div>
                  <div className="text-xs text-muted-foreground">{step.step_key}{step.is_system ? " · system step" : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={step.enabled}
                    disabled={step.is_system}
                    onCheckedChange={(v) => toggle(step.id, v)}
                  />
                  <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === steps.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save flow
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setLocal(null)}>Discard changes</Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function VerificationSettingsPage() {
  const listFn = useServerFn(listVerificationSettings);
  const settings = useQuery({
    queryKey: ["verification-settings"],
    queryFn: () => listFn(),
  });

  const byType = useMemo(() => {
    const map = new Map<VerificationType, VerificationSettingRow>();
    for (const row of settings.data ?? []) map.set(row.verification_type, row);
    return map;
  }, [settings.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="h-6 w-6" /> Verification Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure customer verification providers, flows, and credentials. All changes are audit-logged.
          </p>
        </div>
      </header>

      <DashboardCards />

      <Tabs defaultValue="mobile_otp" className="space-y-4">
        <TabsList>
          <TabsTrigger value="mobile_otp">Mobile OTP</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="flow">Registration Flow</TabsTrigger>
        </TabsList>
        <TabsContent value="mobile_otp">
          {settings.isLoading ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
          ) : (
            <ProviderConfigCard verificationType="mobile_otp" row={byType.get("mobile_otp")} />
          )}
        </TabsContent>
        <TabsContent value="email">
          {settings.isLoading ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
          ) : (
            <ProviderConfigCard verificationType="email" row={byType.get("email")} />
          )}
        </TabsContent>
        <TabsContent value="flow">
          <FlowBuilder />
        </TabsContent>
      </Tabs>
    </div>
  );
}
