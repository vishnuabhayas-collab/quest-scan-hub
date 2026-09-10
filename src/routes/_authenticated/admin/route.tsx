import { useEffect } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, QrCode, Users, ScanLine, LogOut, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/qr", label: "QR Codes", icon: QrCode },
  { to: "/admin/teams", label: "Teams", icon: Users },
  { to: "/admin/scans", label: "Scan Records", icon: ScanLine },
];

function AdminLayout() {
  const { data: role, isLoading } = useRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!isLoading && role !== "admin") navigate({ to: "/", replace: true });
  }, [isLoading, role, navigate]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  if (isLoading || role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <QrCode className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">Competition Admin</span>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Button variant="ghost" className="justify-start" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
          <button onClick={signOut} className="ml-auto px-3 py-1.5 text-xs text-muted-foreground">
            Sign out
          </button>
        </div>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
