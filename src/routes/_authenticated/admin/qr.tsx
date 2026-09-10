import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trash2, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/qr")({
  head: () => ({
    meta: [
      { title: "QR Codes — QR Points Challenge" },
      { name: "description", content: "Create, print, deactivate and delete competition QR codes." },
      { property: "og:title", content: "QR Codes — QR Points Challenge" },
      { property: "og:description", content: "Create, print, deactivate and delete competition QR codes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QrPage,
});

type QrRow = {
  id: string;
  title: string;
  points: number;
  clue: string;
  token: string;
  active: boolean;
  created_at: string;
};

function QrPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("10");
  const [clue, setClue] = useState("");

  const { data: codes, isLoading } = useQuery({
    queryKey: ["qr-codes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qr_codes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error("Could not load QR codes.");
      return data as QrRow[];
    },
  });

  const createQr = useMutation({
    mutationFn: async () => {
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const { error } = await supabase.from("qr_codes").insert({
        title: title.trim(),
        points: Number(points) || 0,
        clue: clue.trim(),
        token,
      });
      if (error) throw new Error("Could not create the QR code.");
    },
    onSuccess: () => {
      setTitle("");
      setPoints("10");
      setClue("");
      toast.success("QR code created");
      queryClient.invalidateQueries({ queryKey: ["qr-codes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("qr_codes").update({ active }).eq("id", id);
      if (error) throw new Error("Could not update the QR code.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qr-codes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeQr = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("qr_codes").delete().eq("id", id);
      if (error) throw new Error("Could not delete the QR code.");
    },
    onSuccess: () => {
      toast.success("QR code deleted");
      queryClient.invalidateQueries({ queryKey: ["qr-codes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">QR Codes</h1>

      <form
        className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-[1fr_120px_2fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          createQr.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="qr-title">QR Title</Label>
          <Input id="qr-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qr-points">Points</Label>
          <Input
            id="qr-points"
            type="number"
            min={0}
            required
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qr-clue">Clue</Label>
          <Textarea
            id="qr-clue"
            required
            rows={1}
            value={clue}
            onChange={(e) => setClue(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={createQr.isPending}>
          {createQr.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create QR
        </Button>
      </form>

      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(codes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No QR codes yet.</p>
          )}
          {(codes ?? []).map((qr) => (
            <QrCard
              key={qr.id}
              qr={qr}
              onToggle={(active) => toggleActive.mutate({ id: qr.id, active })}
              onDelete={() => removeQr.mutate(qr.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QrCard({
  qr,
  onToggle,
  onDelete,
}: {
  qr: QrRow;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    import("qrcode").then((mod) =>
      mod.toDataURL(qr.token, { width: 320, margin: 1 }).then((url) => {
        if (active) setSrc(url);
      }),
    );
    return () => {
      active = false;
    };
  }, [qr.token]);

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{qr.title}</h3>
          <p className="text-xs text-muted-foreground">{qr.points} points</p>
        </div>
        <Switch checked={qr.active} onCheckedChange={onToggle} aria-label="Active" />
      </div>

      <div className="my-4 flex justify-center rounded-lg bg-white p-3">
        {src ? (
          <img src={src} alt={`QR code for ${qr.title}`} className="h-40 w-40" loading="lazy" />
        ) : (
          <div className="h-40 w-40" />
        )}
      </div>

      <p className="mb-4 text-sm text-muted-foreground">{qr.clue}</p>

      <div className="mt-auto flex gap-2">
        <Button asChild variant="outline" size="sm" className="flex-1">
          <a href={src ?? "#"} download={`${qr.title.replace(/\s+/g, "-").toLowerCase()}-qr.png`}>
            <Download className="mr-2 h-4 w-4" /> Download
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={onDelete} aria-label="Delete QR code">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
