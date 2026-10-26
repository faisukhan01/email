"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { StatCard, EmptyState, formatNumber, formatMoney, formatDateTime } from "../shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from "recharts";
import {
  Users, Send, MailOpen, MousePointerClick, TrendingUp, Zap, Sparkles,
  Workflow, Megaphone, Loader2, KanbanSquare,
} from "lucide-react";

interface Overview {
  contacts: { total: number; active: number; unsubscribed: number };
  messages: { byStatus: Record<string, number>; byChannel: Record<string, number>; sent: number; opened: number; clicked: number };
  rates: { openRate: number; clickRate: number; bounceRate: number };
  pipeline: { byStage: Record<string, { count: number; value: number }>; wonCount: number; wonValue: number };
  sequences: { byStatus: Record<string, number> };
  activity: { campaigns: number; activeSequences: number };
}

interface Timeseries {
  series: { date: string; sent: number; opened: number; clicked: number; bounced: number }[];
  topCampaigns: { id: string; name: string; channel: string; status: string; stats: Record<string, number> }[];
}

interface EventsResponse {
  events: { id: string; type: string; createdAt: string; metadata: Record<string, unknown> }[];
}

const EVENT_LABELS: Record<string, string> = {
  "contact.created": "New contact joined",
  "email.sent": "Email sent",
  "email.opened": "Email opened",
  "email.clicked": "Link clicked",
  "whatsapp.sent": "WhatsApp sent",
  "campaign.scheduled": "Campaign scheduled",
  "campaign.sent": "Campaign dispatched",
  "campaign.completed": "Campaign completed",
  "sequence.enrolled": "Automation enrolled a contact",
  "sequence.completed": "Automation completed",
  "deal.created": "Deal created",
  "deal.stage_changed": "Deal stage changed",
  "contacts.imported": "Contacts imported",
  "demo.seeded": "Demo data loaded",
  "workspace.created": "Workspace created",
};

const PIE_COLORS = ["#0d9488", "#14b8a6", "#2dd4bf", "#5eead4", "#99f6e4"];

export function DashboardView() {
  const { setView } = useAppStore();
  const qc = useQueryClient();
  const [seeding, setSeeding] = useState(false);

  const overview = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: () => api.get<Overview>("/api/analytics/overview"),
  });
  const timeseries = useQuery({
    queryKey: ["analytics-timeseries"],
    queryFn: () => api.get<Timeseries>("/api/analytics/timeseries?days=14"),
  });
  const events = useQuery({
    queryKey: ["events-feed"],
    queryFn: () => api.get<EventsResponse>("/api/events?limit=8"),
  });

  const seedDemo = useMutation({
    mutationFn: () => api.post<{ seeded: boolean; contacts: number }>("/api/demo/seed"),
    onSuccess: () => {
      qc.invalidateQueries();
      setSeeding(false);
    },
  });

  const d = overview.data;
  const ts = timeseries.data;
  const needsSeed = d && d.contacts.total === 0;

  const channelData = d
    ? Object.entries(d.messages.byChannel).map(([name, value]) => ({ name, value }))
    : [];

  function handleSeed() {
    setSeeding(true);
    seedDemo.mutate();
  }

  return (
    <div className="space-y-6">
      {/* Seed banner */}
      {needsSeed && (
        <Card className="border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <div>
              <p className="flex items-center gap-2 font-semibold text-teal-900 dark:text-teal-200">
                <Sparkles className="h-4 w-4" aria-hidden /> Your workspace is empty
              </p>
              <p className="mt-0.5 text-sm text-teal-700 dark:text-teal-300">
                Load a realistic demo dataset (48 contacts, campaigns, automations, deals) to explore the platform instantly.
              </p>
            </div>
            <Button onClick={handleSeed} disabled={seeding || seedDemo.isPending} className="bg-teal-600 hover:bg-teal-700">
              {seeding || seedDemo.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Zap className="mr-2 h-4 w-4" aria-hidden />}
              Load demo data
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {overview.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : d ? (
          <>
            <StatCard title="Contacts" value={formatNumber(d.contacts.total)} sub={`${d.contacts.active} active`} icon={Users} />
            <StatCard title="Messages sent" value={formatNumber(d.messages.sent)} sub={`${d.messages.byChannel.email ?? 0} email · ${d.messages.byChannel.whatsapp ?? 0} WhatsApp`} icon={Send} />
            <StatCard title="Open rate" value={`${d.rates.openRate}%`} sub={`${formatNumber(d.messages.opened)} opens`} icon={MailOpen} />
            <StatCard title="Revenue won" value={formatMoney(d.pipeline.wonValue)} sub={`${d.pipeline.wonCount} deals won`} icon={TrendingUp} />
          </>
        ) : null}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Engagement — last 14 days</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {timeseries.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : ts && ts.series.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ts.series} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOpen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="sent" stroke="#0d9488" fill="url(#gSent)" strokeWidth={2} name="Sent" />
                  <Area type="monotone" dataKey="opened" stroke="#f59e0b" fill="url(#gOpen)" strokeWidth={2} name="Opened" />
                  <Area type="monotone" dataKey="clicked" stroke="#84cc16" fillOpacity={0} strokeWidth={2} name="Clicked" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={Send} title="No message activity yet" description="Send your first campaign to see engagement analytics here." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Channel mix</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {channelData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={channelData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={4}>
                    {channelData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={Megaphone} title="No channels yet" description="Email and WhatsApp volume appears here." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline + activity row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Sales pipeline</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setView("pipeline")}>
              <KanbanSquare className="mr-1 h-4 w-4" aria-hidden /> Open
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {d && Object.keys(d.pipeline.byStage).length > 0 ? (
              Object.entries(d.pipeline.byStage).map(([stage, v]) => (
                <div key={stage}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="capitalize text-muted-foreground">{stage}</span>
                    <span className="font-medium">{formatMoney(v.value)}</span>
                  </div>
                  <Progress
                    value={Math.min(100, (v.value / Math.max(1, d.pipeline.wonValue + 1)) * 100)}
                    className="h-1.5"
                  />
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No deals yet — drag deals in the pipeline view.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Recent activity</CardTitle>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setView("campaigns")}>
                <Megaphone className="mr-1 h-4 w-4" aria-hidden /> Campaign
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setView("sequences")}>
                <Workflow className="mr-1 h-4 w-4" aria-hidden /> Automation
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {events.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : events.data && events.data.events.length > 0 ? (
              <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {events.data.events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
                      {EVENT_LABELS[e.type] ?? e.type}
                    </span>
                    <time className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">Activity will stream here as your automations run.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
