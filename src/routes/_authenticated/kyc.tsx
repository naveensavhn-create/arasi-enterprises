import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BadgeCheck,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Trash2,
  Loader2,
  FileImage,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  getKycSignedUrl,
  getMyKyc,
  updateMyKyc,
  type KycProfile,
  type KycStatus,
} from "@/lib/kyc.functions";

export const Route = createFileRoute("/_authenticated/kyc")({
  head: () => ({ meta: [{ title: "My Profile & KYC" }] }),
  component: MyKycPage,
});

const MAX_FILE = 5 * 1024 * 1024; // 5MB
const ACCEPT = "image/png,image/jpeg,image/jpg,application/pdf";

function statusBadge(s: KycStatus) {
  switch (s) {
    case "approved":
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-600">
          <ShieldCheck className="mr-1 h-3 w-3" /> Approved
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-amber-500 hover:bg-amber-500">
          <Clock className="mr-1 h-3 w-3" /> Pending review
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="destructive">
          <ShieldAlert className="mr-1 h-3 w-3" /> Rejected
        </Badge>
      );
    default:
      return <Badge variant="outline">Not submitted</Badge>;
  }
}

function MyKycPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyKyc);
  const updateFn = useServerFn(updateMyKyc);

  const { data, isLoading } = useQuery({
    queryKey: ["my-kyc"],
    queryFn: () => getFn() as Promise<KycProfile | null>,
  });

  const [form, setForm] = useState<Partial<KycProfile>>({});
  useEffect(() => {
    if (data) setForm(data);
  }, [data?.id]);

  const editable = data?.kyc_status !== "pending" && data?.kyc_status !== "approved";

  const set = <K extends keyof KycProfile>(k: K, v: KycProfile[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: (submit: boolean) =>
      updateFn({
        data: {
          full_name: form.full_name ?? null,
          phone: form.phone ?? null,
          address_line1: form.address_line1 ?? null,
          address_line2: form.address_line2 ?? null,
          city: form.city ?? null,
          state: form.state ?? null,
          postal_code: form.postal_code ?? null,
          country: form.country ?? "India",
          aadhaar_number: form.aadhaar_number ?? null,
          aadhaar_address: form.aadhaar_address ?? null,
          aadhaar_front_url: form.aadhaar_front_url ?? null,
          aadhaar_back_url: form.aadhaar_back_url ?? null,
          submit,
        },
      }),
    onSuccess: (row: KycProfile, submit) => {
      toast.success(submit ? "Submitted for review" : "Draft saved");
      setForm(row);
      qc.setQueryData(["my-kyc"], row);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My profile &amp; KYC</h1>
          <p className="text-sm text-muted-foreground">
            Complete your details so an admin can approve your membership.
          </p>
        </div>
        {data && statusBadge(data.kyc_status)}
      </div>

      {data?.kyc_status === "rejected" && data.kyc_review_notes && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Submission rejected</AlertTitle>
          <AlertDescription>
            <div className="mb-1">Please update the details below and resubmit.</div>
            <div className="text-xs opacity-90">Reviewer note: {data.kyc_review_notes}</div>
          </AlertDescription>
        </Alert>
      )}

      {data?.kyc_status === "pending" && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>Awaiting admin review</AlertTitle>
          <AlertDescription>
            Your submission is being reviewed. You'll be notified as soon as a decision is made.
          </AlertDescription>
        </Alert>
      )}

      {data?.kyc_status === "approved" && (
        <Alert className="border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <BadgeCheck className="h-4 w-4" />
          <AlertTitle>Approved</AlertTitle>
          <AlertDescription>
            You're all set. Contact support if any of your details need to change.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input
              disabled={!editable}
              value={form.full_name ?? ""}
              onChange={(e) => set("full_name", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Input
              disabled={!editable}
              value={form.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+91 98xxxxxxxx"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Residential address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Address line 1" className="sm:col-span-2">
            <Input
              disabled={!editable}
              value={form.address_line1 ?? ""}
              onChange={(e) => set("address_line1", e.target.value)}
            />
          </Field>
          <Field label="Address line 2 (optional)" className="sm:col-span-2">
            <Input
              disabled={!editable}
              value={form.address_line2 ?? ""}
              onChange={(e) => set("address_line2", e.target.value)}
            />
          </Field>
          <Field label="City">
            <Input
              disabled={!editable}
              value={form.city ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>
          <Field label="State">
            <Input
              disabled={!editable}
              value={form.state ?? ""}
              onChange={(e) => set("state", e.target.value)}
            />
          </Field>
          <Field label="Postal code">
            <Input
              disabled={!editable}
              value={form.postal_code ?? ""}
              onChange={(e) => set("postal_code", e.target.value)}
            />
          </Field>
          <Field label="Country">
            <Input
              disabled={!editable}
              value={form.country ?? "India"}
              onChange={(e) => set("country", e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aadhaar (KYC)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Aadhaar number (12 digits)">
            <Input
              disabled={!editable}
              inputMode="numeric"
              maxLength={12}
              value={form.aadhaar_number ?? ""}
              onChange={(e) =>
                set("aadhaar_number", e.target.value.replace(/\D/g, "").slice(0, 12))
              }
              placeholder="XXXX XXXX XXXX"
            />
          </Field>
          <Field label="Address as printed on Aadhaar" className="sm:col-span-2">
            <Textarea
              disabled={!editable}
              rows={3}
              value={form.aadhaar_address ?? ""}
              onChange={(e) => set("aadhaar_address", e.target.value)}
            />
          </Field>

          <UploadField
            label="Aadhaar — front"
            editable={!!editable}
            value={form.aadhaar_front_url ?? null}
            onChange={(p) => set("aadhaar_front_url", p)}
          />
          <UploadField
            label="Aadhaar — back (optional)"
            editable={!!editable}
            value={form.aadhaar_back_url ?? null}
            onChange={(p) => set("aadhaar_back_url", p)}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={!editable || saveMut.isPending}
          onClick={() => saveMut.mutate(false)}
        >
          Save draft
        </Button>
        <Button
          disabled={!editable || saveMut.isPending}
          onClick={() => saveMut.mutate(true)}
        >
          {saveMut.isPending ? "Working…" : "Submit for approval"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function UploadField({
  label,
  editable,
  value,
  onChange,
}: {
  label: string;
  editable: boolean;
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const signFn = useServerFn(getKycSignedUrl);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!value) return setPreviewUrl(null);
      try {
        const r = (await signFn({ data: { path: value } })) as { url: string };
        if (!cancelled) setPreviewUrl(r.url);
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function handleFile(file: File) {
    if (file.size > MAX_FILE) {
      toast.error("File too large (max 5MB)");
      return;
    }
    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Not signed in");
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${uid}/${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("kyc-documents")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      onChange(path);
      toast.success("Uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3 rounded-md border p-2">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
          {previewUrl ? (
            previewUrl.match(/\.pdf($|\?)/i) ? (
              <FileImage className="h-6 w-6 text-muted-foreground" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
            )
          ) : (
            <FileImage className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted-foreground">
            {value ? value.split("/").slice(1).join("/") : "No file uploaded"}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.currentTarget.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!editable || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              {value ? "Replace" : "Upload"}
            </Button>
            {value && previewUrl && (
              <Button size="sm" variant="ghost" asChild>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  View
                </a>
              </Button>
            )}
            {value && editable && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => onChange(null)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
