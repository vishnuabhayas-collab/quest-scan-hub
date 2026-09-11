import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

async function assertAdmin(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Not authorised");
}

export const createTeamAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { teamName: string; email: string; password: string }) => {
    const teamName = input.teamName?.trim();
    const email = input.email?.trim().toLowerCase();
    const password = input.password ?? "";
    if (!teamName) throw new Error("Team name is required");
    if (!email || !email.includes("@")) throw new Error("A valid email is required");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");
    return { teamName, email, password };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as SupabaseClient, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: team, error: teamError } = await supabaseAdmin
      .from("teams")
      .insert({ team_name: data.teamName })
      .select("id")
      .single();
    if (teamError || !team) throw new Error("A team with that name may already exist");

    const { data: created, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (userError || !created.user) {
      await supabaseAdmin.from("teams").delete().eq("id", team.id);
      throw new Error("Could not create the login. That email may already be in use.");
    }

    await supabaseAdmin.from("profiles").insert({ user_id: created.user.id, team_id: team.id });
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "team" });

    return { ok: true };
  });

export const deleteTeamAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { teamId: string }) => {
    if (!input?.teamId) throw new Error("Missing team");
    return { teamId: input.teamId };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as SupabaseClient, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("team_id", data.teamId);

    for (const profile of profiles ?? []) {
      await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
    }
    await supabaseAdmin.from("teams").delete().eq("id", data.teamId);
    return { ok: true };
  });

export const forceLogoutTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { teamId: string }) => {
    if (!input?.teamId) throw new Error("Missing team");
    return { teamId: input.teamId };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as SupabaseClient, context.userId);

    // Mark the team as signed out (runs as the admin user) so their app kicks them out.
    const { data: rpc, error: rpcError } = await context.supabase.rpc("admin_force_logout_team", {
      p_team_id: data.teamId,
    });
    if (rpcError) throw new Error("Could not sign the team out.");
    const result = rpc as { status?: string; message?: string } | null;
    if (result?.status !== "ok") throw new Error(result?.message ?? "Could not sign the team out.");

    // Best effort: also revoke their stored sessions / refresh tokens.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("team_id", data.teamId);

    const url = process.env["SUPABASE_URL"];
    const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (url && serviceKey) {
      const headers: Record<string, string> = {
        apikey: serviceKey,
        "Content-Type": "application/json",
      };
      // New-format keys are opaque strings, not bearer JWTs.
      if (!serviceKey.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${serviceKey}`;

      for (const profile of profiles ?? []) {
        try {
          await fetch(`${url}/auth/v1/admin/users/${profile.user_id}/logout`, {
            method: "POST",
            headers,
          });
        } catch {
          // Ignored: the dashboard check above is authoritative.
        }
      }
    }

    return { ok: true };
  });


