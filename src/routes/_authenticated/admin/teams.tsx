import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createTeamAccount, deleteTeamAccount, forceLogoutTeam } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2, LogOut, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/teams")({
  head: () => ({
    meta: [
      { title: "Teams — QR Points Challenge" },
      { name: "description", content: "Create team logins, review scores and force logout a team." },
      { property: "og:title", content: "Teams — QR Points Challenge" },
      { property: "og:description", content: "Create team logins, review scores and force logout a team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamsPage,
});

type Team = { id: string; team_name: string; points: number; created_at: string };

function TeamsPage() {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createTeamAccount);
  const deleteFn = useServerFn(deleteTeamAccount);
  const logoutFn = useServerFn(forceLogoutTeam);

  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const { data: teams, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, team_name, points, created_at")
        .order("points", { ascending: false });
      if (error) throw new Error("Could not load teams.");
      return data as Team[];
    },
  });

  const create = useMutation({
    mutationFn: () => createFn({ data: { teamName, email, password } }),
    onSuccess: () => {
      setTeamName("");
      setEmail("");
      setPassword("");
      toast.success("Team created");
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not create the team."),
  });

  const remove = useMutation({
    mutationFn: (teamId: string) => deleteFn({ data: { teamId } }),
    onSuccess: () => {
      toast.success("Team removed");
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: () => toast.error("Could not remove the team."),
  });

  const forceLogout = useMutation({
    mutationFn: (teamId: string) => logoutFn({ data: { teamId } }),
    onSuccess: () => toast.success("Team signed out on all devices"),
    onError: () => toast.error("Could not sign the team out."),
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>

      <form
        className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="team-name">Team name</Label>
          <Input id="team-name" required value={teamName} onChange={(e) => setTeamName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-email">Login email</Label>
          <Input
            id="team-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-password">Password</Label>
          <Input
            id="team-password"
            type="text"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create team
        </Button>
      </form>

      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {(teams ?? []).length === 0 && <p className="p-5 text-sm text-muted-foreground">No teams yet.</p>}
          {(teams ?? []).map((team) => (
            <div key={team.id} className="border-b border-border last:border-0">
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setOpenTeam(openTeam === team.id ? null : team.id)}
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      openTeam === team.id ? "rotate-180" : ""
                    }`}
                  />
                  <span className="truncate font-medium">{team.team_name}</span>
                </button>
                <span className="tabular-nums font-semibold">{team.points} pts</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => forceLogout.mutate(team.id)}
                  disabled={forceLogout.isPending}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Force logout
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => remove.mutate(team.id)}
                  aria-label="Remove team"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              {openTeam === team.id && <TeamHistory teamId={team.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamHistory({ teamId }: { teamId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["team-history", teamId],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("scans")
        .select("id, scanned_at, points_awarded, qr_codes(title)")
        .eq("team_id", teamId)
        .order("scanned_at", { ascending: false });
      if (error) throw new Error("Could not load scan history.");
      return rows as unknown as {
        id: string;
        scanned_at: string;
        points_awarded: number;
        qr_codes: { title: string } | null;
      }[];
    },
  });

  if (isLoading) return <div className="px-5 pb-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data || data.length === 0)
    return <div className="px-5 pb-4 text-sm text-muted-foreground">No scans yet.</div>;

  return (
    <div className="space-y-1 bg-muted/30 px-5 py-3">
      {data.map((s) => (
        <div key={s.id} className="flex justify-between text-sm">
          <span>{s.qr_codes?.title ?? "—"}</span>
          <span className="text-muted-foreground">
            {new Date(s.scanned_at).toLocaleString()} · +{s.points_awarded}
          </span>
        </div>
      ))}
    </div>
  );
}
