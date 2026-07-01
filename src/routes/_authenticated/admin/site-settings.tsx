import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Palette, Save, Type } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  getSiteSettings,
  updateSiteSettings,
  type SiteSettings,
} from "@/lib/site-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/site-settings")({
  head: () => ({ meta: [{ title: "Site Settings — Admin" }] }),
  component: SiteSettingsPage,
});

const HEADING_FONTS = [
  "Playfair Display",
  "Cormorant Garamond",
  "Merriweather",
  "Lora",
  "Space Grotesk",
  "Poppins",
  "Montserrat",
  "Inter",
];
const BODY_FONTS = [
  "Inter",
  "DM Sans",
  "Nunito",
  "Roboto",
  "Open Sans",
  "Lato",
  "Work Sans",
  "Manrope",
];

function hslPreview(hsl: string) {
  return `hsl(${hsl})`;
}

function ensureFont(family: string) {
  if (!family) return;
  const id = `google-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family,
  )}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

function SiteSettingsPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getSiteSettings);
  const updateFn = useServerFn(updateSiteSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["site-settings"],
    queryFn: () => getFn() as Promise<SiteSettings | null>,
  });

  const [form, setForm] = useState<SiteSettings | null>(null);
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  useEffect(() => {
    if (form) {
      ensureFont(form.heading_font);
      ensureFont(form.body_font);
    }
  }, [form?.heading_font, form?.body_font]);

  const mut = useMutation({
    mutationFn: (v: SiteSettings) =>
      updateFn({
        data: {
          brand_name: v.brand_name,
          tagline: v.tagline ?? null,
          support_email: v.support_email ?? null,
          support_phone: v.support_phone ?? null,
          primary_color: v.primary_color,
          secondary_color: v.secondary_color,
          accent_color: v.accent_color,
          heading_font: v.heading_font,
          body_font: v.body_font,
          logo_url: v.logo_url ?? null,
          favicon_url: v.favicon_url ?? null,
          footer_text: v.footer_text ?? null,
        },
      }),
    onSuccess: (row: SiteSettings) => {
      toast.success("Site settings saved");
      setForm(row);
      qc.setQueryData(["site-settings"], row);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const preview = useMemo(() => form, [form]);

  if (isLoading || !form) {
    return <div className="text-sm text-muted-foreground">Loading site settings…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Site settings</h1>
          <p className="text-sm text-muted-foreground">
            Branding, colors, and typography applied across the app.
          </p>
        </div>
        <Button onClick={() => mut.mutate(form)} disabled={mut.isPending}>
          <Save className="mr-2 h-4 w-4" /> {mut.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Brand</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Brand name">
                  <Input value={form.brand_name} onChange={(e) => set("brand_name", e.target.value)} />
                </Field>
                <Field label="Tagline">
                  <Input
                    value={form.tagline ?? ""}
                    onChange={(e) => set("tagline", e.target.value)}
                  />
                </Field>
                <Field label="Support email">
                  <Input
                    type="email"
                    value={form.support_email ?? ""}
                    onChange={(e) => set("support_email", e.target.value)}
                  />
                </Field>
                <Field label="Support phone">
                  <Input
                    value={form.support_phone ?? ""}
                    onChange={(e) => set("support_phone", e.target.value)}
                  />
                </Field>
                <Field label="Logo URL">
                  <Input
                    value={form.logo_url ?? ""}
                    onChange={(e) => set("logo_url", e.target.value)}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Favicon URL">
                  <Input
                    value={form.favicon_url ?? ""}
                    onChange={(e) => set("favicon_url", e.target.value)}
                    placeholder="https://…"
                  />
                </Field>
              </div>
              <Field label="Footer text">
                <Textarea
                  rows={2}
                  value={form.footer_text ?? ""}
                  onChange={(e) => set("footer_text", e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Palette className="h-4 w-4" /> Colors
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <ColorField
                label="Primary"
                value={form.primary_color}
                onChange={(v) => set("primary_color", v)}
              />
              <ColorField
                label="Secondary"
                value={form.secondary_color}
                onChange={(v) => set("secondary_color", v)}
              />
              <ColorField
                label="Accent"
                value={form.accent_color}
                onChange={(v) => set("accent_color", v)}
              />
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Use HSL triplets, e.g. <code>220 70% 25%</code>. Values map directly to the app's
                CSS design tokens.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Type className="h-4 w-4" /> Typography
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Heading font">
                <Select value={form.heading_font} onValueChange={(v) => set("heading_font", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HEADING_FONTS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Body font">
                <Select value={form.body_font} onValueChange={(v) => set("body_font", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BODY_FONTS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live preview</CardTitle>
            </CardHeader>
            <CardContent>
              {preview && (
                <div
                  className="space-y-3 rounded-lg border p-4"
                  style={{ fontFamily: `"${preview.body_font}", sans-serif` }}
                >
                  <div
                    className="text-2xl font-bold"
                    style={{
                      fontFamily: `"${preview.heading_font}", serif`,
                      color: hslPreview(preview.primary_color),
                    }}
                  >
                    {preview.brand_name}
                  </div>
                  {preview.tagline && (
                    <p className="text-sm text-muted-foreground">{preview.tagline}</p>
                  )}
                  <div className="flex gap-2">
                    <span
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                      style={{ background: hslPreview(preview.primary_color) }}
                    >
                      Primary
                    </span>
                    <span
                      className="rounded-md px-3 py-1.5 text-xs font-medium"
                      style={{
                        background: hslPreview(preview.secondary_color),
                        color: "#111",
                      }}
                    >
                      Secondary
                    </span>
                    <span
                      className="rounded-md px-3 py-1.5 text-xs font-medium"
                      style={{
                        background: hslPreview(preview.accent_color),
                        color: "#111",
                      }}
                    >
                      Accent
                    </span>
                  </div>
                  {preview.footer_text && (
                    <p className="border-t pt-2 text-[11px] text-muted-foreground">
                      {preview.footer_text}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <div
          className="h-9 w-9 shrink-0 rounded-md border"
          style={{ background: hslPreview(value) }}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </div>
    </div>
  );
}
