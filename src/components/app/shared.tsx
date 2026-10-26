"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Shared status/channel badges and primitives used across every view.
 *  Design rule: neutral chrome, semantic color only (dot + label). */

const STATUS_DOT: Record<string, { label: string; dot: string }> = {
  // Positive / success
  subscribed: { label: "Subscribed", dot: "bg-emerald-500" },
  sent: { label: "Sent", dot: "bg-emerald-500" },
  delivered: { label: "Delivered", dot: "bg-emerald-500" },
  opened: { label: "Opened", dot: "bg-emerald-500" },
  clicked: { label: "Clicked", dot: "bg-emerald-500" },
  replied: { label: "Replied", dot: "bg-emerald-500" },
  active: { label: "Active", dot: "bg-emerald-500" },
  completed: { label: "Completed", dot: "bg-emerald-500" },
  won: { label: "Won", dot: "bg-emerald-500" },
  // In progress / scheduled
  scheduled: { label: "Scheduled", dot: "bg-amber-500" },
  sending: { label: "Sending", dot: "bg-amber-500" },
  paused: { label: "Paused", dot: "bg-amber-500" },
  qualified: { label: "Qualified", dot: "bg-amber-500" },
  proposal: { label: "Proposal", dot: "bg-amber-500" },
  // Neutral
  draft: { label: "Draft", dot: "bg-zinc-400 dark:bg-zinc-600" },
  queued: { label: "Queued", dot: "bg-zinc-400 dark:bg-zinc-600" },
  new: { label: "New", dot: "bg-zinc-400 dark:bg-zinc-600" },
  unsubscribed: { label: "Unsubscribed", dot: "bg-zinc-400 dark:bg-zinc-600" },
  exited: { label: "Exited", dot: "bg-zinc-400 dark:bg-zinc-600" },
  // Warning
  bounced: { label: "Bounced", dot: "bg-orange-500" },
  negotiation: { label: "Negotiation", dot: "bg-orange-500" },
  // Negative
  failed: { label: "Failed", dot: "bg-red-500" },
  dead: { label: "Dead", dot: "bg-red-500" },
  complained: { label: "Complained", dot: "bg-red-500" },
  lost: { label: "Lost", dot: "bg-red-500" },
};

const FALLBACK = { label: "", dot: "bg-zinc-400 dark:bg-zinc-600" };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = STATUS_DOT[status] ?? { ...FALLBACK, label: status };
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 bg-card pl-2 pr-2.5 font-medium text-foreground", className)}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dot)} aria-hidden />
      {cfg.label}
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: string }) {
  const isEmail = channel === "email";
  return (
    <Badge variant="outline" className="gap-1.5 bg-card pl-2 pr-2.5 font-medium text-foreground">
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", isEmail ? "bg-zinc-400 dark:bg-zinc-600" : "bg-emerald-500")}
        aria-hidden
      />
      {isEmail ? "Email" : "WhatsApp"}
    </Badge>
  );
}

export function StatCard({
  title, value, sub, icon: Icon, trend,
}: {
  title: string; value: string | number; sub?: string; icon?: React.ElementType; trend?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {(sub || trend) && (
        <p className="mt-1 text-xs text-muted-foreground">{trend ?? sub}</p>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon: React.ElementType; title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
      <div className="rounded-md bg-muted p-2.5 text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard" }).format(n);
}

export function formatMoney(n: number | null | undefined, currency = "USD"): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
