import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Organiser Dashboard — QR Points Challenge" },
      { name: "description", content: "Overview of teams, QR codes, scans and the live leaderboard." },
      { property: "og:title", content: "Organiser Dashboard — QR Points Challenge" },
      { property: "og:description", content: "Overview of teams, QR codes, scans and the live leaderboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const [teams, qrs, scans, recent] = await Promise.all([
        supabase.from("teams").select("id, team_name, points").order("points", { ascending: false }),
        supabase.from("qr_codes").select("id", { count: "exact", head: true }),
        supabase.from("scans").select("id", { count: "exact", head: true }),
        supabase
          .from("scans")
          .select("id, scanned_at, points_awarded, teams(team_name), qr_codes(title)")
          .order("scanned_at", { ascending: false })
          .limit(10),
      ]);
      return {
        teams: teams.data ?? [],
        qrCount: qrs.count ?? 0,
        scanCount: scans.count ?? 0,
        recent: (recent.data ?? []) as unknown as RecentScan[],
      };
    },
  });

  if (isLoading || !data) {
    return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total Teams" value={data.teams.length} />
        <Stat label="Total QR Codes" value={data.qrCount} />
        <Stat label="Total Scans" value={data.scanCount} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Leaderboard</h2>
          <div className="divide-y divide-border">
            {data.teams.length === 0 && <p className="p-5 text-sm text-muted-foreground">No teams yet.</p>}
            {data.teams.map((t, i) => (
              <div key={t.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>
                  <span className="mr-3 text-muted-foreground tabular-nums">{i + 1}</span>
                  {t.team_name}
                </span>
                <span className="font-semibold tabular-nums">{t.points}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Recent Scan Activity</h2>
          <div className="divide-y divide-border">
            {data.recent.length === 0 && <p className="p-5 text-sm text-muted-foreground">No scans yet.</p>}
            {data.recent.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{s.teams?.team_name ?? "—"}</span>
                  <span className="text-muted-foreground"> · {s.qr_codes?.title ?? "—"}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(s.scanned_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

type RecentScan = {
  id: string;
  scanned_at: string;
  points_awarded: number;
  teams: { team_name: string } | null;
  qr_codes: { title: string } | null;
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
