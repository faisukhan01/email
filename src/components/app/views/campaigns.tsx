"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState, StatusBadge, ChannelBadge, formatDate, formatDateTime, formatNumber } from "../shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone, Plus, Loader2, Send, Clock, Eye, Copy, Trash2, Info, Users, MousePointerClick, FlaskConical,
} from "lucide-react";

interface Campaign {
  id: string; name: string; channel: string; status: string; subject: string;
  preheader: string; fromName: string; fromEmail: string; replyTo: string;
  bodyHtml: string; bodyText: string; audienceType: string; listId: string | null;
  segmentRules: string; trackOpens: boolean; trackClicks: boolean;
  scheduledAt: string | null; startedAt: string | null; completedAt: string | null;
  createdAt: string; stats: Record<string, number>; list?: { id: string; name: string } | null;
}

interface CampaignsResponse { campaigns: Campaign[] }
interface ListsResponse { lists: { id: string; name: string }[] }
interface CampaignDetail {
  campaign: Campaign;
  stats: Record<string, number>;
  messages: {
    id: string; toAddress: string; subject: string; status: string; provider: string;
    error: string | null; sentAt: string | null;
    contact: { id: string; email: string; firstName: string; lastName: string };
  }[];
}

const TOKENS = ["first_name", "last_name", "full_name", "email", "company", "city", "country", "job_title"];

const DEFAULT_HTML = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#0f172a">Hi {{first_name}} 👋</h2>
  <p style="color:#334155;line-height:1.6">Write your message here. Use tokens like {{first_name}} or {{company}} to personalize.</p>
  <p style="margin:28px 0"><a href="https://example.com" style="background:#111827;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Call to action</a></p>
</div>`;

function StatBar({ stats }: { stats: Record<string, number> }) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total === 0) return <span className="text-xs text-muted-foreground">Not sent yet</span>;
  const clicked = stats.clicked ?? 0;
  const opened = (stats.opened ?? 0) + clicked;
  const sent = total - (stats.bounced ?? 0) - (stats.failed ?? 0) - (stats.queued ?? 0);
  const pct = (n: number) => (sent > 0 ? Math.round((n / sent) * 100) : 0);
  return (
    <div className="space-y-1">
      <div className="flex gap-0.5">
        <div className="h-1.5 rounded-l bg-zinc-400 dark:bg-zinc-600" style={{ width: `${Math.max(pct(sent - opened), opened < sent ? 8 : 4)}%` }} />
        <div className="h-1.5 bg-zinc-500 dark:bg-zinc-400" style={{ width: `${Math.max(pct(opened - clicked), opened > 0 ? 6 : 0)}%` }} />
        <div className="h-1.5 rounded-r bg-primary" style={{ width: `${Math.max(pct(clicked), clicked > 0 ? 6 : 0)}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {formatNumber(total)} recipients · {pct(opened)}% opens · {pct(clicked)}% clicks
      </p>
    </div>
  );
}

export function CampaignsView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("email");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const [statsTarget, setStatsTarget] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<CampaignsResponse>("/api/campaigns"),
  });
  const lists = useQuery({ queryKey: ["lists"], queryFn: () => api.get<ListsResponse>("/api/lists") });

  const detail = useQuery({
    queryKey: ["campaign-detail", statsTarget],
    queryFn: () => api.get<CampaignDetail>(`/api/campaigns/${statsTarget}`),
    enabled: !!statsTarget,
  });

  const deleteCampaign = useMutation({
    mutationFn: (id: string) => api.del(`/api/campaigns/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast({ title: "Campaign deleted" });
    },
  });

  const filtered = useMemo(
    () => (campaigns.data?.campaigns ?? []).filter((c) => c.channel === tab),
    [campaigns.data, tab]
  );

  function openEditor(campaign?: Campaign) {
    setEditing(campaign ?? null);
    setEditorOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={setTab} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="email" className="gap-1.5"><Megaphone className="h-3.5 w-3.5" aria-hidden />Email</TabsTrigger>
            <TabsTrigger value="whatsapp" className="gap-1.5"><Send className="h-3.5 w-3.5" aria-hidden />WhatsApp</TabsTrigger>
          </TabsList>
          <TabsContent value="email" hidden />
          <TabsContent value="whatsapp" hidden />
        </Tabs>
        <Button onClick={() => openEditor()}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New campaign
        </Button>
      </div>

      {campaigns.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={`No ${tab === "email" ? "email" : "WhatsApp"} campaigns yet`}
          description="Create a campaign, personalize it with tokens, and send or schedule it to a list or segment."
          action={
            <Button onClick={() => openEditor()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create campaign
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((c) => (
            <Card key={c.id} className="rounded-lg shadow-none">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    {c.subject && <p className="truncate text-xs text-muted-foreground">{c.subject}</p>}
                  </div>
                  <StatusBadge status={c.status} />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {c.list && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{c.list.name}</span>}
                  {c.audienceType === "all" && <span>All contacts</span>}
                  {c.audienceType === "segment" && <span>Segment</span>}
                  <span>·</span>
                  <span>{c.scheduledAt ? `Scheduled ${formatDateTime(c.scheduledAt)}` : `Created ${formatDate(c.createdAt)}`}</span>
                </div>

                <div className="mt-3">
                  <StatBar stats={c.stats} />
                </div>

                <div className="mt-3 flex items-center gap-1.5">
                  {(c.status === "draft" || c.status === "paused" || c.status === "failed") && (
                    <Button size="sm" variant="outline" onClick={() => setSendTarget(c)}>
                      <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> Send
                    </Button>
                  )}
                  {c.status === "sent" && (
                    <Button size="sm" variant="outline" onClick={() => setStatsTarget(c.id)}>
                      <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> Report
                    </Button>
                  )}
                  {c.status === "scheduled" && (
                    <Button size="sm" variant="outline" onClick={() => setStatsTarget(c.id)}>
                      <Clock className="mr-1 h-3.5 w-3.5" aria-hidden /> View
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openEditor(c)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteCampaign.mutate(c.id); }}
                    aria-label={`Delete campaign ${c.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CampaignEditor
        open={editorOpen}
        campaign={editing}
        lists={lists.data?.lists ?? []}
        onOpenChange={setEditorOpen}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        onSaved={() => {
          setEditorOpen(false);
          qc.invalidateQueries({ queryKey: ["campaigns"] });
          toast({ title: "Campaign saved" });
        }}
      />

      {sendTarget && (
        <SendDialog
          campaign={sendTarget}
          onClose={() => setSendTarget(null)}
          onQueued={() => {
            setSendTarget(null);
            qc.invalidateQueries({ queryKey: ["campaigns"] });
            toast({ title: "Campaign queued", description: "The automation engine will dispatch it shortly." });
          }}
        />
      )}

      <Dialog open={!!statsTarget} onOpenChange={(o) => !o && setStatsTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Campaign report</DialogTitle>
            <DialogDescription>Per-recipient evidence with delivery, opens and clicks.</DialogDescription>
          </DialogHeader>
          {detail.isLoading || !detail.data ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {["sent", "opened", "clicked", "bounced", "failed"].map((k) => (
                  <div key={k} className="rounded-lg border p-2.5 text-center">
                    <p className="text-lg font-semibold">{detail.data.stats[k] ?? 0}</p>
                    <p className="text-[11px] capitalize text-muted-foreground">{k}</p>
                  </div>
                ))}
              </div>
              <ScrollArea className="h-64 rounded-lg border">
                <ul className="divide-y">
                  {detail.data.messages.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{[m.contact.firstName, m.contact.lastName].filter(Boolean).join(" ") || m.contact.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.toAddress}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="bg-card font-normal text-[10px] uppercase text-muted-foreground">{m.provider}</Badge>
                        <StatusBadge status={m.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────

function CampaignEditor({
  open, campaign, lists, onOpenChange, onSaved, previewMode, setPreviewMode,
}: {
  open: boolean; campaign: Campaign | null; lists: { id: string; name: string }[];
  onOpenChange: (v: boolean) => void; onSaved: () => void;
  previewMode: boolean; setPreviewMode: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("email");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_HTML);
  const [bodyText, setBodyText] = useState("");
  const [audienceType, setAudienceType] = useState("list");
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (campaign) {
      setName(campaign.name); setChannel(campaign.channel); setSubject(campaign.subject);
      setPreheader(campaign.preheader); setFromName(campaign.fromName); setFromEmail(campaign.fromEmail);
      setBodyHtml(campaign.bodyHtml || DEFAULT_HTML); setBodyText(campaign.bodyText);
      setAudienceType(campaign.audienceType); setListId(campaign.listId ?? "");
    } else {
      setName(""); setChannel("email"); setSubject(""); setPreheader("");
      setFromName(""); setFromEmail(""); setBodyHtml(DEFAULT_HTML); setBodyText("");
      setAudienceType("list"); setListId("");
    }
  }, [campaign, open]);

  const previewHtml = useMemo(
    () =>
      (bodyHtml || "<p></p>")
        .replace(/\{\{\s*first_name\s*\}\}/g, "Alex")
        .replace(/\{\{\s*last_name\s*\}\}/g, "Morgan")
        .replace(/\{\{\s*full_name\s*\}\}/g, "Alex Morgan")
        .replace(/\{\{\s*company\s*\}\}/g, "Acme Inc")
        .replace(/\{\{\s*(\w+)\s*\}\}/g, "—"),
    [bodyHtml]
  );

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name, channel, subject, preheader, fromName, fromEmail,
        bodyHtml: channel === "email" ? bodyHtml : "",
        bodyText: channel === "whatsapp" ? bodyText : "",
        audienceType,
        listId: audienceType === "list" && listId ? listId : undefined,
      };
      if (campaign) {
        await api.patch(`/api/campaigns/${campaign.id}`, payload);
      } else {
        await api.post("/api/campaigns", payload);
      }
      onSaved();
    } catch {
      toast({ title: "Could not save campaign", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{campaign ? "Edit campaign" : "New campaign"}</DialogTitle>
          <DialogDescription>
            Personalize with tokens — the engine renders them per contact at send time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="camp-name">Campaign name</Label>
              <Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="October Newsletter" maxLength={140} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger aria-label="Channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Audience</Label>
                <Select value={audienceType} onValueChange={setAudienceType}>
                  <SelectTrigger aria-label="Audience"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="list">A list</SelectItem>
                    <SelectItem value="all">All contacts</SelectItem>
                    <SelectItem value="segment">Segment rules</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {audienceType === "list" && (
              <div className="space-y-1.5">
                <Label>Send to list</Label>
                <Select value={listId} onValueChange={setListId}>
                  <SelectTrigger aria-label="List"><SelectValue placeholder="Choose a list" /></SelectTrigger>
                  <SelectContent>
                    {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {channel === "email" && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="camp-subject">Subject line</Label>
                    <div className="flex gap-1">
                      {TOKENS.slice(0, 3).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                          onClick={() => setSubject((s) => `${s}{{${t}}}`)}
                        >
                          +{t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input id="camp-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hey {{first_name}}, quick question…" maxLength={200} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="camp-preheader">Preheader</Label>
                  <Input id="camp-preheader" value={preheader} onChange={(e) => setPreheader(e.target.value)} placeholder="Preview text shown in the inbox" maxLength={200} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="camp-fromname">From name</Label>
                    <Input id="camp-fromname" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Growth Team" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="camp-fromemail">From email</Label>
                    <Input id="camp-fromemail" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="you@company.com" />
                  </div>
                </div>
              </>
            )}

            {channel === "whatsapp" && (
              <div className="space-y-1.5">
                <Label htmlFor="camp-wa">WhatsApp message</Label>
                <Textarea
                  id="camp-wa"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={6}
                  maxLength={1024}
                  placeholder="Hi {{first_name}}! ⚡ Flash sale starts today…"
                />
                <p className="text-xs text-muted-foreground">{bodyText.length}/1024 characters</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {channel === "email" && (
              <>
                <div className="flex items-center justify-between">
                  <Label>Email body (HTML)</Label>
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" variant={previewMode ? "outline" : "secondary"} onClick={() => setPreviewMode(false)}>
                      HTML
                    </Button>
                    <Button type="button" size="sm" variant={previewMode ? "secondary" : "outline"} onClick={() => setPreviewMode(true)}>
                      <Eye className="mr-1 h-3 w-3" aria-hidden /> Preview
                    </Button>
                  </div>
                </div>
                {previewMode ? (
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className="h-72 w-full rounded-lg border bg-white"
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <Textarea
                    value={bodyHtml}
                    onChange={(e) => setBodyHtml(e.target.value)}
                    rows={12}
                    className="font-mono text-xs"
                    aria-label="Email HTML body"
                  />
                )}
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Info className="h-3 w-3" aria-hidden /> Open & click tracking is added automatically to every send.
                </p>
              </>
            )}
            {channel === "whatsapp" && (
              <div className="flex h-72 items-center justify-center rounded-lg border bg-stone-50 p-4 dark:bg-stone-900">
                <div className="max-w-[260px] rounded-2xl rounded-br-sm bg-[#dcf8c6] p-3 text-sm dark:bg-[#dcf8c6]">
                  {bodyText.replace(/\{\{\s*first_name\s*\}\}/g, "Alex").replace(/\{\{\s*(\w+)\s*\}\}/g, "—") || <span className="text-stone-400">Message preview…</span>}
                  <p className="mt-1 text-right text-[10px] text-stone-500">delivered ✓✓</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {campaign ? "Save changes" : "Create campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Send dialog ─────────────────────────────────────────────

function SendDialog({
  campaign, onClose, onQueued,
}: {
  campaign: Campaign; onClose: () => void; onQueued: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [when, setWhen] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api.post(`/api/campaigns/${campaign.id}/send`, {
        mode,
        scheduledAt: mode === "schedule" && when ? new Date(when).toISOString() : undefined,
      });
      onQueued();
    } catch {
      toast({ title: "Send failed", description: "The campaign could not be queued.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setTestBusy(true);
    try {
      await api.post(`/api/campaigns/${campaign.id}/test`, {
        channel: campaign.channel,
        to: campaign.channel === "email" ? testTo : testTo,
      });
      toast({ title: "Test queued", description: `Sending a test to ${testTo}` });
    } catch {
      toast({ title: "Test send failed", variant: "destructive" });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send &quot;{campaign.name}&quot;</DialogTitle>
          <DialogDescription>
            The automation engine dispatches with per-message evidence and retry protection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mode === "now" ? "default" : "outline"}
              onClick={() => setMode("now")}
            >
              <Send className="mr-1.5 h-4 w-4" aria-hidden /> Send now
            </Button>
            <Button variant={mode === "schedule" ? "default" : "outline"} onClick={() => setMode("schedule")}>
              <Clock className="mr-1.5 h-4 w-4" aria-hidden /> Schedule
            </Button>
          </div>

          {mode === "schedule" && (
            <div className="space-y-1.5">
              <Label htmlFor="send-when">Date & time</Label>
              <Input id="send-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
          )}

          <div className="rounded-lg border border-dashed p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Send a test first
            </p>
            <div className="flex gap-2">
              <Input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder={campaign.channel === "email" ? "you@company.com" : "+92300…"}
                aria-label="Test recipient"
              />
              <Button variant="secondary" size="sm" onClick={sendTest} disabled={testBusy || !testTo.trim()}>
                {testBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Send"}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={busy || (mode === "schedule" && !when)}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {mode === "now" ? "Send to audience" : "Schedule campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
