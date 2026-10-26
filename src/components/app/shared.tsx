"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Clock, MailOpen, MousePointerClick, AlertTriangle,
  XCircle, Send, Inbox, Ban, CheckCheck, Zap,
} from "lucide-react";

/** Shared status/channel badges used across every view. */

const STATUS_MAP: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  subscribed: { label: "Subscribed", className: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300", icon: CheckCircle2 },
  unsubscribed: { label: "Unsubscribed", className: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300", icon: Ban },
  bounced: { label: "Bounced", className: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300", icon: AlertTriangle },
  complained: { label: "Complained", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", icon: XCircle },
  queued: { label: "Queued", className: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300", icon: Clock },
  sent: { label: "Sent", className: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300", icon: Send },
  delivered: { label: "Delivered", className: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300", icon: CheckCheck },
  opened: { label: "Opened", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", icon: MailOpen },
  clicked: { label: "Clicked", className: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300", icon: MousePointerClick },
  replied: { label: "Replied", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300", icon: Inbox },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", icon: XCircle },
  dead: { label: "Dead", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", icon: XCircle },
  draft: { label: "Draft", className: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300", icon: Clock },
  scheduled: { label: "Scheduled", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", icon: Clock },
  sending: { label: "Sending", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", icon: Zap },
  paused: { label: "Paused", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", icon: Clock },
  active: { label: "Active", className: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300", icon: Zap },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", icon: CheckCircle2 },
  exited: { label: "Exited", className: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300", icon: Ban },
  won: { label: "Won", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", icon: CheckCircle2 },
  lost: { label: "Lost", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", icon: XCircle },
  new: { label: "New", className: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300", icon: Clock },
  qualified: { label: "Qualified", className: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300", icon: Clock },
  proposal: { label: "Proposal", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", icon: Clock },
  negotiation: { label: "Negotiation", className: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300", icon: Clock },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status, className: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300", icon: Clock };
  const Icon = cfg.icon;
  return (
    <Badge variant="secondary" className={cn("gap-1 font-medium", cfg.className, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {cfg.label}
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: string }) {
  const isEmail = channel === "email";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 font-medium",
        isEmail
          ? "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300"
          : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      )}
    >
      {isEmail ? <Send className="h-3 w-3" aria-hidden /> : <Zap className="h-3 w-3" aria-hidden />}
      {isEmail ? "Email" : "WhatsApp"}
    </Badge>
  );
}

export function StatCard({
  title, value, sub, icon: Icon, trend,
}: {
  title: string; value: string | number; sub?: string; icon: React.ElementType; trend?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="rounded-lg bg-teal-100 p-1.5 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center">
      <div className="rounded-full bg-teal-100 p-3 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
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
