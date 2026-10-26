"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAppStore, ViewId } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuthScreen } from "./auth-screen";
import { DashboardView } from "./views/dashboard";
import { ContactsView } from "./views/contacts";
import { ListsView } from "./views/lists";
import { CampaignsView } from "./views/campaigns";
import { SequencesView } from "./views/sequences";
import { WhatsAppView } from "./views/whatsapp";
import { PipelineView } from "./views/pipeline";
import { TemplatesView } from "./views/templates";
import { AnalyticsView } from "./views/analytics";
import { SettingsView } from "./views/settings";
import { ContactDrawer } from "./contact-drawer";
import {
  LayoutDashboard, Users, ListChecks, Megaphone, Workflow, MessageSquare,
  KanbanSquare, FileText, BarChart3, Settings as SettingsIcon, LogOut,
  Zap, Menu, X, Sparkles,
} from "lucide-react";

interface MeResponse {
  user: { id: string; name: string; email: string; avatarColor: string } | null;
  workspace: { id: string; name: string; simulationMode: boolean; timezone: string; currency: string } | null;
  connected: boolean;
  channelMode?: string;
}

const NAV: { id: ViewId; label: string; icon: React.ElementType; group: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { id: "contacts", label: "Contacts", icon: Users, group: "Audience" },
  { id: "lists", label: "Lists & Segments", icon: ListChecks, group: "Audience" },
  { id: "campaigns", label: "Email Campaigns", icon: Megaphone, group: "Messaging" },
  { id: "whatsapp", label: "WhatsApp", icon: MessageSquare, group: "Messaging" },
  { id: "sequences", label: "Automations", icon: Workflow, group: "Messaging" },
  { id: "templates", label: "Templates", icon: FileText, group: "Messaging" },
  { id: "pipeline", label: "Sales Pipeline", icon: KanbanSquare, group: "Revenue" },
  { id: "analytics", label: "Analytics", icon: BarChart3, group: "Insights" },
  { id: "settings", label: "Settings", icon: SettingsIcon, group: "Insights" },
];

export function AppShell() {
  const { activeView, setView, sidebarOpen, toggleSidebar } = useAppStore();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/api/auth/me"),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-teal-600 text-white">
            <Sparkles className="h-6 w-6" />
          </div>
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
    );
  }

  if (!data?.user) {
    return <AuthScreen />;
  }

  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  const initials = data.user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function logout() {
    await api.post("/api/auth/logout");
    window.location.reload();
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-background transition-transform lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">FlowEngine</p>
              <p className="text-[10px] text-muted-foreground">{data.workspace?.name ?? "Workspace"}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleSidebar} aria-label="Close menu">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 px-3 py-3">
          <nav className="space-y-4" aria-label="Primary">
            {groups.map((group) => (
              <div key={group}>
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {NAV.filter((n) => n.group === group).map((item) => {
                    const Icon = item.icon;
                    const activeItem = activeView === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setView(item.id);
                          if (window.innerWidth < 1024) toggleSidebar();
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                          activeItem
                            ? "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                        aria-current={activeItem ? "page" : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        <div className="border-t p-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {data.workspace?.simulationMode ? "Simulation mode active" : "Live sending enabled"}
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={toggleSidebar} aria-hidden />
      )}

      {/* Main */}
      <div className="flex min-h-screen w-full flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleSidebar} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-sm font-semibold">
              {NAV.find((n) => n.id === activeView)?.label ?? "Dashboard"}
            </h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full outline-none ring-teal-600 focus-visible:ring-2" aria-label="Account menu">
                <Avatar className="h-8 w-8">
                  <AvatarFallback style={{ backgroundColor: data.user.avatarColor }} className="text-xs text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{data.user.name}</p>
                <p className="text-xs text-muted-foreground">{data.user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setView("settings")}>
                <SettingsIcon className="mr-2 h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-7xl">
            {activeView === "dashboard" && <DashboardView />}
            {activeView === "contacts" && <ContactsView />}
            {activeView === "lists" && <ListsView />}
            {activeView === "campaigns" && <CampaignsView />}
            {activeView === "sequences" && <SequencesView />}
            {activeView === "whatsapp" && <WhatsAppView />}
            {activeView === "pipeline" && <PipelineView />}
            {activeView === "templates" && <TemplatesView />}
            {activeView === "analytics" && <AnalyticsView />}
            {activeView === "settings" && <SettingsView />}
          </div>
        </main>

        <footer className="mt-auto border-t px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="text-center text-xs text-muted-foreground">
            FlowEngine — multi-channel automation platform · Turso (libSQL) · Next.js + FastAPI engine
          </p>
        </footer>
      </div>

      <ContactDrawer />
    </div>
  );
}
