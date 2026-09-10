import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "QR Points Challenge — Competition Sign In" },
      {
        name: "description",
        content:
          "Sign in to the QR Points Challenge. Teams scan QR codes to unlock clues; organisers manage codes, teams and scores.",
      },
      { property: "og:title", content: "QR Points Challenge — Competition Sign In" },
      {
        property: "og:description",
        content:
          "Sign in to the QR Points Challenge. Teams scan QR codes to unlock clues; organisers manage codes, teams and scores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignInPage,
});

async function routeForCurrentUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!roles || roles.length === 0) return null;
  return roles.some((r) => r.role === "admin") ? "/admin" : "/team";
}

function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupMode, setSetupMode] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    routeForCurrentUser()
      .then((target) => {
        if (active && target) navigate({ to: target, replace: true });
        else if (active) setChecking(false);
      })
      .catch(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Incorrect email or password.");
      setBusy(false);
      return;
    }
    const target = await routeForCurrentUser();
    if (!target) {
      await supabase.auth.signOut();
      setError("This account is not set up for the competition yet.");
      setBusy(false);
      return;
    }
    navigate({ to: target, replace: true });
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (signUpError) {
      setError(signUpError.message);
      setBusy(false);
      return;
    }
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      setNotice("Account created. Please confirm your email, then sign in.");
      setSetupMode(false);
      setBusy(false);
      return;
    }
    const { data: claim } = await supabase.rpc("claim_first_admin");
    const status = (claim as { status?: string } | null)?.status;
    if (status !== "ok") {
      await supabase.auth.signOut();
      setError("An organiser account already exists. Ask them to create your team login.");
      setBusy(false);
      return;
    }
    navigate({ to: "/admin", replace: true });
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <QrCode className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">QR Points Challenge</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {setupMode ? "Create the organiser account" : "Sign in to continue"}
          </p>
        </div>

        <form
          onSubmit={setupMode ? handleSetup : handleSignIn}
          className="space-y-4 rounded-xl border border-border bg-card p-6"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={setupMode ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

          <Button type="submit" className="h-11 w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {setupMode ? "Create organiser account" : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setSetupMode((v) => !v);
            setError(null);
            setNotice(null);
          }}
        >
          {setupMode ? "Back to sign in" : "First-time setup: create organiser account"}
        </button>
      </div>
    </main>
  );
}
