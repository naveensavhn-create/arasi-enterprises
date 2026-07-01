import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import { useSession, useCurrentRole, useSignOut } from "@/lib/auth";
import { useEffect, useState } from "react";
import { lastVisitedKey } from "@/lib/last-visited";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { portal: "customer" } });
    }
    return { user: data.user };
  },
  component: AuthenticatedShell,
});

const SIDEBAR_STORAGE_PREFIX = "arasi:sidebar-open:";

function AuthenticatedShell() {
  const { user, loading } = useSession();
  const { data: role } = useCurrentRole(user);
  const signOut = useSignOut();
  const navigate = useNavigate();

  // Per-user persisted sidebar open state. Undefined until we know the user
  // so the provider doesn't flash the wrong state.
  const [open, setOpen] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(SIDEBAR_STORAGE_PREFIX + user.id);
      setOpen(raw === null ? true : raw === "true");
    } catch {
      setOpen(true);
    }
  }, [user?.id]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (user) {
      try {
        localStorage.setItem(SIDEBAR_STORAGE_PREFIX + user.id, String(next));
      } catch {
        /* storage disabled */
      }
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", search: { portal: "customer" }, replace: true });
    }
  }, [loading, user, navigate]);

  // Remember last visited path per user+role so re-login resumes there.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (!user || !role) return;
    // Only track role-scoped app pages; skip dashboard itself and auth-only paths.
    const prefix = `/${role}/`;
    if (!pathname.startsWith(prefix)) return;
    try {
      localStorage.setItem(lastVisitedKey(user.id, role), pathname);
    } catch {
      /* storage disabled */
    }
  }, [pathname, user?.id, role]);

  return (
    <SidebarProvider open={open ?? true} onOpenChange={handleOpenChange}>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar role={role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-border bg-card/80 px-3 backdrop-blur sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger />
              <div className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground sm:block">
                {role ? `${role} portal` : "Loading…"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden max-w-[200px] text-right sm:block">
                <div className="truncate text-sm font-medium leading-tight">
                  {user?.email ?? user?.phone}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={signOut}>
                <LogOut className="mr-0 h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </header>
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

