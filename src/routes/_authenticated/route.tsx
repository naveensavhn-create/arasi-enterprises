import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Button } from "@/components/ui/button";
import { useSession, useCurrentRole, useSignOut } from "@/lib/auth";
import { useEffect, useState } from "react";
import { lastVisitedKey } from "@/lib/last-visited";
import { useApplyUiPrefs, getUiPrefs, useSyncUiPrefsWithServer } from "@/lib/ui-prefs";
import { HeaderKycStatus } from "@/components/kyc/KycStatusBadge";
import { NotificationBell } from "@/components/layout/NotificationBell";


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

  // Apply saved UI preferences (density) to <html>.
  useApplyUiPrefs();
  // Sync UI prefs to the signed-in user so they follow across devices.
  useSyncUiPrefsWithServer(user?.id ?? null);

  // Per-user persisted sidebar open state. Undefined until we know the user
  // so the provider doesn't flash the wrong state.
  const [open, setOpen] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(SIDEBAR_STORAGE_PREFIX + user.id);
      if (raw === null) {
        // No per-user value yet — fall back to the user's default preference.
        setOpen(getUiPrefs().sidebarMode !== "collapsed");
      } else {
        setOpen(raw === "true");
      }
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar role={role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-card/80 px-3 backdrop-blur sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger />
              <div className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground sm:block">
                {role ? `${role} portal` : "Loading…"}
              </div>
            </div>
            <div className="min-w-0 justify-self-stretch sm:justify-self-center sm:w-full sm:max-w-md">
              <GlobalSearch role={role} />
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <NotificationBell />
              <HeaderKycStatus />
              <div className="hidden max-w-[200px] text-right sm:block">
                <div className="truncate text-sm font-medium leading-tight">
                  {user?.email ?? user?.phone}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={signOut}>
                <LogOut className="mr-0 h-4 w-4 sm:mr-2" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
                <span className="sr-only sm:hidden">Sign out</span>
              </Button>
            </div>

          </header>
          <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

