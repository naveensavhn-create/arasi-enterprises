import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, History } from "lucide-react";

type AuditRow = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  action: "create" | "update" | "activate" | "deactivate" | "delete";
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
};

const actionVariant: Record<AuditRow["action"], "default" | "secondary" | "destructive" | "outline"> = {
  create: "default",
  update: "secondary",
  activate: "default",
  deactivate: "outline",
  delete: "destructive",
};

function fmt(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function PlanAuditDrawer({
  planId,
  planName,
  open,
  onOpenChange,
}: {
  planId: string | null;
  planName?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["plan-audit", planId],
    enabled: open && !!planId,
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("plan_audit_log")
        .select("*")
        .eq("plan_id", planId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Audit history
          </SheetTitle>
          <SheetDescription>
            Compliance log for {planName ?? "this plan"} — every change, who made it, and when.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-8rem)] pr-3">
          {q.isLoading ? (
            <div className="flex items-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : q.error ? (
            <p className="py-8 text-sm text-destructive">
              {q.error instanceof Error ? q.error.message : "Failed to load"}
            </p>
          ) : !q.data || q.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No changes recorded yet.
            </p>
          ) : (
            <ol className="space-y-3">
              {q.data.map((row) => (
                <li key={row.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant={actionVariant[row.action]} className="uppercase">
                      {row.action}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-2 text-xs">
                    <span className="text-muted-foreground">By </span>
                    <span className="font-medium">
                      {row.actor_email ?? row.actor_id ?? "system"}
                    </span>
                  </div>

                  {row.action === "update" && row.changed_fields && row.changed_fields.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {row.changed_fields.map((f) => {
                        const b = row.before_data?.[f];
                        const a = row.after_data?.[f];
                        return (
                          <div
                            key={f}
                            className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 text-xs"
                          >
                            <span className="font-mono text-muted-foreground truncate">{f}</span>
                            <span>
                              <span className="text-muted-foreground line-through">{fmt(b)}</span>
                              <span className="mx-1">→</span>
                              <span className="font-medium">{fmt(a)}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(row.action === "activate" || row.action === "deactivate") && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Plan {row.action === "activate" ? "activated" : "deactivated"}.
                    </p>
                  )}

                  {row.action === "create" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Plan created with initial values.
                    </p>
                  )}

                  {row.action === "delete" && (
                    <p className="mt-2 text-xs text-destructive">Plan deleted.</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
