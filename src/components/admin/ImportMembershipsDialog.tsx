import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, FileSpreadsheet, Upload, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { bulkImportMemberships } from "@/lib/memberships.functions";

const HEADERS = [
  "customer_email",
  "plan_code",
  "promoter_email",
  "start_date",
  "advance_paid",
  "notes",
  "activate",
] as const;

const TEMPLATE = `customer_email,plan_code,promoter_email,start_date,advance_paid,notes,activate
jane@example.com,SILVER,,2026-07-01,5000,First member,true
john@example.com,GOLD,promo@example.com,2026-07-15,,,false
`;

type LocalRow = {
  row_number: number;
  raw: Record<string, string>;
  parseError?: string;
  data?: {
    customer_email: string;
    plan_code: string;
    promoter_email?: string;
    start_date: string;
    advance_paid?: number;
    notes?: string;
    activate?: boolean;
  };
};

type ImportResult = Awaited<ReturnType<typeof bulkImportMemberships>>;

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        cur.push(field);
        field = "";
        i++;
      } else if (ch === "\r") {
        i++;
      } else if (ch === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function toBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (!s) return undefined;
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
}

function normalizeRows(text: string): { rows: LocalRow[]; headerError?: string } {
  const grid = parseCSV(text);
  if (grid.length < 2) return { rows: [], headerError: "CSV must include a header row and at least one data row" };
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const missing = ["customer_email", "plan_code", "start_date"].filter((h) => !header.includes(h));
  if (missing.length) return { rows: [], headerError: `Missing required column(s): ${missing.join(", ")}` };
  const rows: LocalRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => (raw[h] = (grid[i][idx] ?? "").trim()));
    const row: LocalRow = { row_number: i, raw };
    try {
      const advRaw = raw.advance_paid;
      const activateBool = toBool(raw.activate ?? "");
      row.data = {
        customer_email: raw.customer_email,
        plan_code: raw.plan_code,
        promoter_email: raw.promoter_email || undefined,
        start_date: raw.start_date,
        advance_paid: advRaw ? Number(advRaw) : undefined,
        notes: raw.notes || undefined,
        activate: activateBool,
      };
      if (advRaw && Number.isNaN(Number(advRaw))) row.parseError = "advance_paid is not a number";
      if (raw.activate && activateBool === undefined) row.parseError = "activate must be true/false";
    } catch (e) {
      row.parseError = e instanceof Error ? e.message : "Invalid row";
    }
    rows.push(row);
  }
  return { rows };
}

export function ImportMembershipsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [headerError, setHeaderError] = useState<string | undefined>();
  const [result, setResult] = useState<ImportResult | null>(null);
  const importFn = useServerFn(bulkImportMemberships);

  const importMut = useMutation({
    mutationFn: (dry_run: boolean) => {
      const payload = rows
        .filter((r) => !r.parseError && r.data)
        .map((r) => r.data!);
      return importFn({ data: { rows: payload, dry_run } });
    },
    onSuccess: (res, dry) => {
      setResult(res);
      if (!dry && res.inserted > 0) {
        toast.success(`Imported ${res.inserted} membership${res.inserted === 1 ? "" : "s"}`);
        onImported();
      }
      if (dry) toast.info(`Validated ${res.valid} of ${res.total} rows`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Import failed"),
  });

  const summary = useMemo(() => {
    const parseErrors = rows.filter((r) => r.parseError).length;
    const okLocally = rows.filter((r) => !r.parseError).length;
    return { total: rows.length, parseErrors, okLocally };
  }, [rows]);

  const reset = () => {
    setFileName(null);
    setRows([]);
    setHeaderError(undefined);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (f: File) => {
    if (f.size > 2 * 1024 * 1024) {
      toast.error("CSV must be under 2MB");
      return;
    }
    const text = await f.text();
    const { rows: parsed, headerError: hErr } = normalizeRows(text);
    setFileName(f.name);
    setRows(parsed);
    setHeaderError(hErr);
    setResult(null);
    if (!hErr && parsed.length > 500) {
      toast.warning("Only the first 500 rows will be imported per batch");
      setRows(parsed.slice(0, 500));
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "memberships-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const resultByRow = new Map(result?.results.map((r) => [r.row_number, r]) ?? []);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Import memberships from CSV
          </DialogTitle>
          <DialogDescription>
            Required columns: <code>customer_email</code>, <code>plan_code</code>,{" "}
            <code>start_date</code> (YYYY-MM-DD). Optional: <code>promoter_email</code>,{" "}
            <code>advance_paid</code>, <code>notes</code>, <code>activate</code> (true/false).
            Up to 500 rows per import.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" /> Download template
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Choose CSV
          </Button>
          {fileName && (
            <span className="text-sm text-muted-foreground truncate">{fileName}</span>
          )}
        </div>

        {headerError && (
          <Alert variant="destructive">
            <AlertDescription>{headerError}</AlertDescription>
          </Alert>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{summary.total} rows</Badge>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                {summary.okLocally} parsable
              </Badge>
              {summary.parseErrors > 0 && (
                <Badge variant="outline" className="border-red-500/40 text-red-500">
                  {summary.parseErrors} local errors
                </Badge>
              )}
              {result && (
                <>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                    server valid: {result.valid}
                  </Badge>
                  <Badge variant="outline" className="border-red-500/40 text-red-500">
                    server invalid: {result.invalid}
                  </Badge>
                  {!result.dry_run && (
                    <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/40">
                      inserted: {result.inserted}
                    </Badge>
                  )}
                </>
              )}
            </div>

            <div className="max-h-[360px] overflow-auto rounded border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Promoter</TableHead>
                    <TableHead>Advance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const rr = resultByRow.get(r.row_number);
                    const err = r.parseError ?? rr?.error;
                    const ok = !err && (rr?.ok ?? true);
                    return (
                      <TableRow key={r.row_number} className={err ? "bg-red-500/5" : undefined}>
                        <TableCell className="text-xs text-muted-foreground">{r.row_number}</TableCell>
                        <TableCell className="text-xs">{r.raw.customer_email}</TableCell>
                        <TableCell className="text-xs">{r.raw.plan_code}</TableCell>
                        <TableCell className="text-xs">{r.raw.start_date}</TableCell>
                        <TableCell className="text-xs">{r.raw.promoter_email || "—"}</TableCell>
                        <TableCell className="text-xs tabular-nums">{r.raw.advance_paid || "0"}</TableCell>
                        <TableCell className="text-xs">
                          {err ? (
                            <div className="flex items-start gap-1 text-red-500">
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{err}</span>
                            </div>
                          ) : rr?.membership_number ? (
                            <div className="flex items-center gap-1 text-emerald-500">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span className="font-mono">{rr.membership_number}</span>
                            </div>
                          ) : ok ? (
                            <span className="text-emerald-500">Ready</span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={!rows.length || importMut.isPending}
            onClick={() => importMut.mutate(true)}
          >
            {importMut.isPending && importMut.variables === true ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Validate (dry run)
          </Button>
          <Button
            disabled={!rows.length || importMut.isPending || summary.okLocally === 0}
            onClick={() => importMut.mutate(false)}
          >
            {importMut.isPending && importMut.variables === false ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Import {summary.okLocally} row{summary.okLocally === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
