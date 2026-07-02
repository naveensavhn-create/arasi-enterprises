import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import QRCode from "qrcode";
import {
  getReferralTree,
  type ReferralTreePromoter,
} from "@/lib/referral-tree.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  QrCode,
  Search,
  Share2,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/referral-tree")({
  head: () => ({ meta: [{ title: "Referral Tree — Admin" }] }),
  component: ReferralTreePage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Failed to load referral tree: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

const currency = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold truncate">{value}</div>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReferralTreePage() {
  const getFn = useServerFn(getReferralTree);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "referral-tree"],
    queryFn: () => getFn(),
  });
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!data?.promoters) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.promoters;
    return data.promoters.filter((p) => {
      return (
        p.full_name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.phone?.toLowerCase().includes(q) ||
        p.referral_code?.toLowerCase().includes(q) ||
        p.display_id?.toLowerCase().includes(q) ||
        p.customers.some(
          (c) =>
            c.full_name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.membership_number?.toLowerCase().includes(q),
        )
      );
    });
  }, [data, search]);

  const exportCsv = () => {
    if (!data?.promoters?.length) return;
    const rows = [
      [
        "promoter_id",
        "name",
        "email",
        "phone",
        "display_id",
        "referral_code",
        "total_referred",
        "active",
        "pending_kyc",
        "conversion_rate",
        "paid_earnings",
        "pending_earnings",
      ],
      ...data.promoters.map((p) => [
        p.promoter_id,
        p.full_name ?? "",
        p.email ?? "",
        p.phone ?? "",
        p.display_id ?? "",
        p.referral_code ?? "",
        String(p.total_referred),
        String(p.active_customers),
        String(p.pending_kyc),
        (p.conversion_rate * 100).toFixed(1) + "%",
        String(p.total_earnings),
        String(p.pending_earnings),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `referral-tree-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Share2 className="h-6 w-6 text-primary" />
            Referral Tree
          </h1>
          <p className="text-sm text-muted-foreground">
            Promoter referral hierarchy with earnings, conversion, and QR referral codes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={Users}
          label="Total promoters"
          value={String(data?.summary.total_promoters ?? 0)}
          hint={`${data?.summary.active_promoters ?? 0} active`}
        />
        <StatTile
          icon={UserCheck}
          label="Total referrals"
          value={String(data?.summary.total_referrals ?? 0)}
          hint={`${data?.summary.total_conversions ?? 0} converted`}
        />
        <StatTile
          icon={TrendingUp}
          label="Conversion rate"
          value={`${((data?.summary.overall_conversion_rate ?? 0) * 100).toFixed(1)}%`}
        />
        <StatTile
          icon={Wallet}
          label="Commission paid"
          value={currency(data?.summary.total_paid_out ?? 0)}
          hint={`${currency(data?.summary.total_pending ?? 0)} pending`}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by promoter, customer, code, or membership #"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading tree…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No promoters found.
            </div>
          ) : (
            filtered.map((p) => <PromoterNode key={p.promoter_id} promoter={p} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PromoterNode({ promoter }: { promoter: ReferralTreePromoter }) {
  const [open, setOpen] = useState(false);
  const convPct = Math.round(promoter.conversion_rate * 100);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border bg-card">
        <div className="p-3 flex items-start gap-3 flex-wrap md:flex-nowrap">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">
                {promoter.full_name ?? "Unnamed promoter"}
              </span>
              {promoter.display_id ? (
                <Badge variant="secondary" className="font-mono text-xs">
                  #{promoter.display_id}
                </Badge>
              ) : null}
              {promoter.referral_code ? (
                <ReferralCodeChip code={promoter.referral_code} />
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {promoter.email ?? "—"} · {promoter.phone ?? "—"}
            </div>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-5 gap-3 text-xs w-full md:w-auto md:min-w-[480px]">
            <MiniStat label="Referred" value={String(promoter.total_referred)} />
            <MiniStat label="Active" value={String(promoter.active_customers)} />
            <MiniStat label="Pending KYC" value={String(promoter.pending_kyc)} />
            <MiniStat label="Earned" value={currency(promoter.total_earnings)} />
            <div>
              <div className="text-muted-foreground">Conversion</div>
              <div className="flex items-center gap-2">
                <Progress value={convPct} className="h-1.5" />
                <span className="tabular-nums text-xs">{convPct}%</span>
              </div>
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t bg-muted/30">
            {promoter.customers.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No customers referred yet.
              </div>
            ) : (
              <ul className="divide-y">
                {promoter.customers.map((c) => (
                  <li
                    key={c.id}
                    className="p-3 pl-12 flex flex-wrap items-center gap-3 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {c.full_name ?? "Unnamed customer"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.email ?? "—"} · {c.phone ?? "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={
                          c.kyc_status === "approved"
                            ? "default"
                            : c.kyc_status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                        className="capitalize"
                      >
                        KYC: {c.kyc_status}
                      </Badge>
                      {c.membership_status ? (
                        <Badge
                          variant={c.membership_status === "active" ? "default" : "outline"}
                          className="capitalize"
                        >
                          {c.membership_status}
                        </Badge>
                      ) : (
                        <Badge variant="outline">No membership</Badge>
                      )}
                      {c.membership_number ? (
                        <span className="text-xs font-mono text-muted-foreground">
                          {c.membership_number}
                        </span>
                      ) : null}
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {currency(c.total_paid)} paid
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function ReferralCodeChip({ code }: { code: string }) {
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/auth?ref=${code}` : `/auth?ref=${code}`;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    toast({ title: "Referral link copied" });
  };

  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className="font-mono text-xs">
        {code}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copy}
        title="Copy referral link"
      >
        <Copy className="h-3 w-3" />
      </Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Show QR code">
            <QrCode className="h-3 w-3" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Referral QR code</DialogTitle>
          </DialogHeader>
          <QrPreview link={link} code={code} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QrPreview({ link, code }: { link: string; code: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, link, { width: 260, margin: 2 }).catch(() => undefined);
    QRCode.toDataURL(link, { width: 512, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [link]);

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <canvas ref={canvasRef} className="rounded border" />
      </div>
      <div className="text-center">
        <div className="font-mono text-sm">{code}</div>
        <div className="text-xs text-muted-foreground break-all">{link}</div>
      </div>
      <div className="flex gap-2 justify-center">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast({ title: "Link copied" });
          }}
        >
          <Copy className="h-4 w-4 mr-1" /> Copy link
        </Button>
        {dataUrl ? (
          <a href={dataUrl} download={`referral-${code}.png`}>
            <Button size="sm">
              <Download className="h-4 w-4 mr-1" /> Download PNG
            </Button>
          </a>
        ) : null}
      </div>
    </div>
  );
}
