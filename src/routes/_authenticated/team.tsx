import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team Dashboard — QR Points Challenge" },
      { name: "description", content: "Scan competition QR codes and unlock your next clue." },
      { property: "og:title", content: "Team Dashboard — QR Points Challenge" },
      { property: "og:description", content: "Scan competition QR codes and unlock your next clue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamDashboard,
});

type Dashboard = {
  status: string;
  message?: string;
  team_name?: string;
  points?: number;
  current?: { title: string; clue: string; scanned_at: string } | null;
  history?: { title: string; scanned_at: string }[];
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TeamDashboard() {
  const queryClient = useQueryClient();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["team-dashboard"],
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Dashboard> => {
      const { data: rpc, error } = await supabase.rpc("get_team_dashboard");
      if (error) throw new Error("Could not load your dashboard.");
      return rpc as Dashboard;
    },
  });

  // Organiser can sign a team out remotely.
  useEffect(() => {
    if (data?.status !== "logged_out") return;
    void (async () => {
      await supabase.auth.signOut();
      queryClient.clear();
      window.location.href = "/";
    })();
  }, [data?.status, queryClient]);


  async function submitToken(token: string) {
    setScannerOpen(false);
    setResult(null);
    const { data: rpc, error } = await supabase.rpc("scan_qr", { p_token: token });
    if (error) {
      setResult({ ok: false, message: "Something went wrong. Please try again." });
      return;
    }
    const res = rpc as { status: string; message?: string };
    if (res.status === "success") {
      setResult({ ok: true, message: "QR accepted" });
      queryClient.invalidateQueries({ queryKey: ["team-dashboard"] });
    } else {
      setResult({ ok: false, message: res.message ?? "This QR code could not be accepted." });
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (isError || data?.status !== "ok") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">
          {data?.message ?? "Your dashboard is unavailable right now. Please try again."}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-12">
      <header className="border-b border-border bg-card px-5 py-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Competition</p>
        <h1 className="text-lg font-semibold">{data.team_name}</h1>
      </header>

      <div className="mx-auto w-full max-w-md space-y-5 px-5 pt-6">
        <section className="rounded-2xl border border-border bg-card py-8 text-center">
          <p className="text-5xl font-bold tabular-nums">{data.points ?? 0}</p>
          <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">Points</p>
        </section>

        <Button className="h-16 w-full text-base font-semibold" onClick={() => setScannerOpen(true)}>
          <Camera className="mr-2 h-6 w-6" /> Scan QR
        </Button>

        {result && (
          <div
            className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
              result.ok
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-destructive/40 bg-destructive/10 text-foreground"
            }`}
          >
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{result.message}</span>
          </div>
        )}

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Current clue</h2>
          <div className="rounded-2xl border border-border bg-card p-5">
            {data.current ? (
              <>
                <p className="text-base leading-relaxed">{data.current.clue}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {data.current.title} · {formatTime(data.current.scanned_at)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Scan your first QR code to unlock a clue.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Scan history</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {(data.history ?? []).length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No scans yet.</p>
            )}
            {(data.history ?? []).map((h) => (
              <div key={`${h.title}-${h.scanned_at}`} className="flex items-center justify-between p-4">
                <span className="text-sm font-medium">{h.title}</span>
                <span className="text-xs text-muted-foreground">{formatTime(h.scanned_at)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {scannerOpen && <ScannerOverlay onClose={() => setScannerOpen(false)} onToken={submitToken} />}
    </main>
  );
}

function ScannerOverlay({
  onClose,
  onToken,
}: {
  onClose: () => void;
  onToken: (token: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let scanner: { stop: () => void; destroy: () => void; start: () => Promise<void> } | null = null;
    let cancelled = false;

    (async () => {
      try {
        const QrScanner = (await import("qr-scanner")).default;
        if (cancelled || !videoRef.current) return;
        scanner = new QrScanner(
          videoRef.current,
          (res: { data: string }) => {
            scanner?.stop();
            onToken(res.data);
          },
          { highlightScanRegion: true, maxScansPerSecond: 4 },
        ) as unknown as typeof scanner;
        await scanner!.start();
      } catch {
        if (!cancelled) {
          setError(
            "Camera unavailable. Allow camera access in your browser settings and try again.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [onToken]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-medium">Point at the QR code</span>
        <button type="button" onClick={onClose} aria-label="Close scanner">
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="relative flex-1">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-white">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
