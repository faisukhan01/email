"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StatCard, EmptyState, StatusBadge, ChannelBadge, formatNumber } from "../shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { AlertTriangle, BarChart3, MailOpen, MousePointerClick, Send } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface SeriesPoint { date: string; sent: number; opened: number; clicked: number; bounced: number }

interface Timeseries {
  series: SeriesPoint[];
  topCampaigns: { id: string; name: string; channel: string; status: string; stats: Record<string, number> }[];
}

const RANGES = ["7", "14", "30", "90"] as const;

/** Derives per-campaign metrics from the status counters, guarding divide-by-zero. */
function campaignMetrics(stats: Record<string, number>) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const sent = total - (stats.bounced ?? 0) - (stats.failed ?? 0) - (stats.queued ?? 0);
  const opened = (stats.opened ?? 0) + (stats.clicked ?? 0) + (stats.replied ?? 0);
  const clicked = stats.clicked ?? 0;
  const pct = (n: number) => (sent > 0 ? Math.round((n / sent) * 100) : 0);
  return { sent, opened, clicked, openPct: pct(opened), clickPct: pct(clicked) };
}

// ─── View ────────────────────────────────────────────────────

export function AnalyticsView() {
  const [days, setDays] = useState<string>("14");

  const query = useQuery({
    queryKey: ["analytics-timeseries", days],
    queryFn: () => api.get<Timeseries>(`/api/analytics/timeseries?days=${days}`),
  });

  const data = query.data;

  const totals = useMemo(() => {
    const series = data?.series ?? [];
    const sum = (key: keyof Omit<SeriesPoint, "date">) => series.reduce((a, p) => a + p[key], 0);
    const sent = sum("sent");
    const opened = sum("opened");
    const clicked = sum("clicked");
    const bounced = sum("bounced");
    return {
      sent, opened, clicked, bounced,
      bounceRate: sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0,
      hasActivity: series.some((p) => p.sent > 0 || p.opened > 0 || p.clicked > 0 || p.bounced > 0),
    };
  }, [data]);

  const campaigns = data?.topCampaigns ?? [];

  return (
    <div className="space-y-4">
      {/* Range picker */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold">Engagement analytics</h2>
          <p className="text-sm text-muted-foreground">Delivery, opens, clicks and bounces across both channels.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {query.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)
        ) : (
          <>
            <StatCard title="Messages sent" value={formatNumber(totals.sent)} sub={`Last ${days} days`} icon={Send} />
            <StatCard title="Opens" value={formatNumber(totals.opened)} sub={totals.sent > 0 ? `${Math.round((totals.opened / totals.sent) * 100)}% of sent` : "—"} icon={MailOpen} />
            <StatCard title="Clicks" value={formatNumber(totals.clicked)} sub={totals.sent > 0 ? `${Math.round((totals.clicked / totals.sent) * 100)}% of sent` : "—"} icon={MousePointerClick} />
            <StatCard title="Bounce rate" value={`${totals.bounceRate}%`} sub={`${formatNumber(totals.bounced)} bounces`} icon={AlertTriangle} />
          </>
        )}
      </div>

      {/* Main chart */}
      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Volume over time</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {query.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : totals.hasActivity ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data?.series ?? []} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="aSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3f3f46" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="#3f3f46" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="aOpen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d97706" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#d97706" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="aClick" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.10} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="sent" stroke="#3f3f46" fill="url(#aSent)" strokeWidth={2} name="Sent" />
                <Area type="monotone" dataKey="opened" stroke="#d97706" fill="url(#aOpen)" strokeWidth={2} name="Opened" />
                <Area type="monotone" dataKey="clicked" stroke="#059669" fill="url(#aClick)" strokeWidth={2} name="Clicked" />
                <Line type="monotone" dataKey="bounced" stroke="#dc2626" strokeWidth={2} dot={false} name="Bounced" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No activity in this period"
              description="Send a campaign and engagement will chart here automatically."
            />
          )}
        </CardContent>
      </Card>

      {/* Campaign comparison */}
      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Campaign comparison</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : campaigns.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No campaigns yet"
              description="Create and send a campaign to compare open and click performance here."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border" role="region" aria-label="Campaign comparison table">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Opened</TableHead>
                    <TableHead className="text-right">Clicked</TableHead>
                    <TableHead className="text-right">Open %</TableHead>
                    <TableHead className="text-right">Click %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => {
                    const m = campaignMetrics(c.stats);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="max-w-[220px] truncate font-medium" title={c.name}>{c.name}</TableCell>
                        <TableCell><ChannelBadge channel={c.channel} /></TableCell>
                        <TableCell><StatusBadge status={c.status} /></TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(m.sent)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(m.opened)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(m.clicked)}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.openPct}%</TableCell>
                        <TableCell className="text-right tabular-nums">{m.clickPct}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
