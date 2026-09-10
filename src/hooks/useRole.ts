import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "team" | null;

export function useRole() {
  return useQuery({
    queryKey: ["role"],
    staleTime: 60_000,
    queryFn: async (): Promise<Role> => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return null;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (!data || data.length === 0) return null;
      return data.some((r) => r.role === "admin") ? "admin" : "team";
    },
  });
}
