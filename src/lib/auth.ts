import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "admin" | "promoter" | "customer";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up listener first, then fetch current session
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useCurrentRole(user: User | null | undefined) {
  return useQuery({
    queryKey: ["current-role", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AppRole | null> => {
      const { data, error } = await supabase.rpc("current_user_role");
      if (error) throw error;
      return (data as AppRole | null) ?? null;
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { portal: "customer" }, replace: true });
  };
}

export function portalToRole(portal: string | undefined): AppRole {
  if (portal === "admin") return "admin";
  if (portal === "promoter") return "promoter";
  return "customer";
}
