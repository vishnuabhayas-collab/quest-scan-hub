import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/scans")({
  head: () => ({
    meta: [
      { title: "Scan Records — QR Points Challenge" },
      { name: "description", content: "Review every scan and roll back points by deleting a record." },
      { property: "og:title", content: "Scan Records — QR Points Challenge" },
      { property: "og:description", content: "Review every scan and roll back points by deleting a record." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScansPage,
});

type ScanRow = {
  id: string;
  team_id: string;
  qr_id: string;
  points_awarded: number;
  scanned_at: string;
  teams: { team_name: string } | null;
  qr_codes: { title: string } | null;
};

function ScansPage() {
  const queryClient = useQueryClient();
  const [teamFilter, setTeamFilter] = useState("");
  const [qrFilter, setQrFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const { data: scans, isLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scans")
        .select("id, team_id, qr_id, points_awarded, scanned_at, teams(team_name), qr_codes(title)")
        .order("scanned_at", { ascending: false });
      if (error) throw new Error("Could not load scan records.");
      return data as unknown as ScanRow[];
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id, team_name").order("team_name");
      return data ?? [];
    },
  });

  const { data: qrs } = useQuery({
    queryKey: ["qr-list"],
    queryFn: async () => {
      const { data } = await supabase.from("qr_codes").select("id, title").order("title");
      return data ?? [];
    },
  });

  const deleteScan = useMutation({
    mutationFn: async (scanId: string) => {
      const { data, error } = await supabase.rpc("admin_delete_scan", { p_scan_id: scanId });
      const status = (data as { status?: string } | null)?.status;
      if (error || status !== "ok") throw new Error("Could not delete the scan.");
    },
    onSuccess: () => {
      toast.success("Scan deleted and points reversed");
      queryClient.invalidateQueries({ queryKey: ["scans"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    return (scans ?? []).filter((s) => {
      if (teamFilter && s.team_id !== teamFilter) return false;
      if (qrFilter && s.qr_id !== qrFilter) return false;
      if (dateFilter && !s.scanned_at.startsWith(dateFilter)) return false;
      return true;
    });
  }, [scans, teamFilter, qrFilter, dateFilter]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Scan Records</h1>

      <div className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="f-team">Team</Label>
          <select
            id="f-team"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="">All teams</option>
            {(teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.team_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-qr">QR code</Label>
          <select
            id="f-qr"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={qrFilter}
            onChange={(e) => setQrFilter(e.target.value)}
          >
            <option value="">All QR codes</option>
            {(qrs ?? []).map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-date">Date</Label>
          <Input
            id="f-date"
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Team</th>
                <th className="px-5 py-3 font-medium">QR</th>
                <th className="px-5 py-3 font-medium">Scan time</th>
                <th className="px-5 py-3 font-medium">Points</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-muted-foreground">
                    No scan records match these filters.
                  </td>
                </tr>
              )}
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td className="px-5 py-3">{s.teams?.team_name ?? "—"}</td>
                  <td className="px-5 py-3">{s.qr_codes?.title ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {new Date(s.scanned_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{s.points_awarded}</td>
                  <td className="px-5 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteScan.mutate(s.id)}
                      aria-label="Delete scan"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
