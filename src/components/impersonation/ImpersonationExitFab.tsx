import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { endImpersonation } from "@/lib/impersonation.functions";
import { useActiveImpersonation } from "./ImpersonationBanner";

/**
 * Floating, always-visible "Return to Admin Dashboard" action that appears
 * on every page while an impersonation session is active. Complements the
 * sticky top banner so exiting is one click from anywhere — including deep
 * scroll positions and modals — not only from the page header.
 */
export function ImpersonationExitFab() {
  const { data } = useActiveImpersonation();
  const endFn = useServerFn(endImpersonation);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const end = useMutation({
    mutationFn: () => endFn(),
    onSuccess: () => {
      toast.success("Impersonation ended");
      qc.invalidateQueries({ queryKey: ["impersonation"] });
      navigate({ to: "/admin" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6 sm:justify-end sm:pr-6"
      role="region"
      aria-label="Impersonation exit"
    >
      <Button
        size="lg"
        variant="destructive"
        onClick={() => end.mutate()}
        disabled={end.isPending}
        className="pointer-events-auto shadow-lg ring-2 ring-amber-500/70 ring-offset-2 ring-offset-background"
      >
        <LogOut className="mr-2 h-5 w-5" aria-hidden="true" />
        {end.isPending ? "Returning…" : "Return to Admin Dashboard"}
      </Button>
    </div>
  );
}
