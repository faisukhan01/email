"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState, StatusBadge, formatNumber, formatDate } from "../shared";
import { useAppStore } from "@/lib/store";
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
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, Plus, Send, Trash2, Loader2, Pencil, AlertTriangle,
  PlugZap, Users, CheckCheck, ChevronLeft, Phone, Mic, Braces, ListOrdered,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface WaCampaign {
  id: string; name: string; channel: string; status: string; bodyText: string;
  audienceType: string; listId: string | null; createdAt: string;
  stats: Record<string, number>;
  list?: { id: string; name: string } | null;
}
interface CampaignsResponse { campaigns: WaCampaign[] }
interface ListsResponse { lists: { id: string; name: string }[] }
interface WaTemplate {
  id: string; name: string; channel: string; category: string;
  subject: string; bodyHtml: string; bodyText: string; variables: string;
  createdAt: string; updatedAt: string;
}
interface TemplatesResponse { templates: WaTemplate[] }
interface IntegrationsResponse {
  integration: { waPhoneNumberId?: string | null; waAccessTokenSet?: boolean };
  simulationMode: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────

function parseVariables(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function deriveVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) out.add(m[1]);
  return [...out];
}

function renderTokens(text: string): string {
  return text
    .replace(/\{\{\s*first_name\s*\}\}/g, "Alex")
    .replace(/\{\{\s*last_name\s*\}\}/g, "Morgan")
    .replace(/\{\{\s*full_name\s*\}\}/g, "Alex Morgan")
    .replace(/\{\{\s*email\s*\}\}/g, "alex@example.com")
    .replace(/\{\{\s*company\s*\}\}/g, "Acme Inc")
    .replace(/\{\{\s*(\w+)\s*\}\}/g, "—");
}

function truncateText(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const TOKEN_BUTTONS = ["first_name", "last_name", "company", "email", "city", "country"];

// ─── Main view ───────────────────────────────────────────────

export function WhatsAppView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const setView = useAppStore((s) => s.setView);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<WaTemplate | null>(null);

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.get<IntegrationsResponse>("/api/settings/integrations"),
  });
  const campaigns = useQuery({
    queryKey: ["campaigns", "whatsapp"],
    queryFn: () => api.get<CampaignsResponse>("/api/campaigns?channel=whatsapp"),
  });
  const templates = useQuery({
    queryKey: ["templates", "whatsapp"],
    queryFn: () => api.get<TemplatesResponse>("/api/templates?channel=whatsapp"),
  });
  const lists = useQuery({ queryKey: ["lists"], queryFn: () => api.get<ListsResponse>("/api/lists") });

  const connected = !!integrations.data?.integration?.waPhoneNumberId;
  const simulationMode = integrations.data?.simulationMode ?? true;

  const sendCampaign = useMutation({
    mutationFn: (id: string) => api.post(`/api/campaigns/${id}/send`, { mode: "now" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast({ title: "Broadcast queued", description: "The automation engine will dispatch it shortly." });
    },
    onError: () => toast({ title: "Could not queue broadcast", variant: "destructive" }),
  });

  const removeTemplate = useMutation({
    mutationFn: (id: string) => api.del(`/api/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast({ title: "Template deleted" });
    },
    onError: () => toast({ title: "Could not delete template", variant: "destructive" }),
  });

  const waCampaigns = campaigns.data?.campaigns ?? [];
  const waTemplates = templates.data?.templates ?? [];

  return (
    <div className="space-y-6">
      {/* ── Integration status header ── */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-green-100 p-2.5 text-green-700 dark:bg-green-950 dark:text-green-400">
              <MessageSquare className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">WhatsApp Cloud API</p>
              {integrations.isLoading ? (
                <Skeleton className="mt-1 h-4 w-56" />
              ) : connected ? (
                <p className="text-xs text-muted-foreground">
                  Connected · Phone number ID{" "}
                  <span className="font-mono">{integrations.data?.integration.waPhoneNumberId}</span>
                </p>
              ) : (
                <p className="mt-0.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Not connected — connect a WhatsApp business number in Settings to send for real.
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {simulationMode && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Simulator mode
              </Badge>
            )}
            {connected ? (
              <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                <PlugZap className="h-3 w-3" aria-hidden /> Connected
              </Badge>
            ) : (
              <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setView("settings")}>
                Connect WhatsApp in Settings
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Broadcasts ── */}
      <section aria-labelledby="wa-broadcasts">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 id="wa-broadcasts" className="text-base font-semibold tracking-tight">Broadcasts</h2>
            <p className="text-sm text-muted-foreground">One-off WhatsApp messages sent to a list.</p>
          </div>
          <Button onClick={() => setBroadcastOpen(true)} className="bg-teal-600 hover:bg-teal-700">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New broadcast
          </Button>
        </div>

        {campaigns.isLoading ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          </div>
        ) : waCampaigns.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={Send}
              title="No WhatsApp broadcasts yet"
              description="Create a quick broadcast, pick a list, and the engine delivers every message with retries and evidence."
              action={
                <Button onClick={() => setBroadcastOpen(true)} className="bg-teal-600 hover:bg-teal-700">
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create broadcast
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {waCampaigns.map((c) => {
              const stats = c.stats ?? {};
              const sent = stats.sent ?? 0;
              const failed = (stats.failed ?? 0) + (stats.bounced ?? 0);
              return (
                <Card key={c.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{c.name}</p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-8 text-xs text-muted-foreground">
                      {c.bodyText ? truncateText(c.bodyText, 120) : "No message body."}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" aria-hidden />
                        {c.list?.name ?? (c.audienceType === "all" ? "All contacts" : "Audience")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CheckCheck className="h-3 w-3" aria-hidden /> {formatNumber(sent)} sent
                      </span>
                      {failed > 0 && <span className="text-red-600 dark:text-red-400">{formatNumber(failed)} failed</span>}
                      <span>· {formatDate(c.createdAt)}</span>
                    </div>
                    {(c.status === "draft" || c.status === "paused" || c.status === "failed") && (
                      <div className="mt-3">
                        <Button
                          size="sm" variant="outline"
                          className="text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950"
                          onClick={() => sendCampaign.mutate(c.id)}
                          disabled={sendCampaign.isPending && sendCampaign.variables === c.id}
                        >
                          {sendCampaign.isPending && sendCampaign.variables === c.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
                          )}
                          Send now
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Templates ── */}
      <section aria-labelledby="wa-templates">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 id="wa-templates" className="text-base font-semibold tracking-tight">Message templates</h2>
            <p className="text-sm text-muted-foreground">
              Reusable WhatsApp templates with <span className="font-mono text-xs">{"{{token}}"}</span> personalization.
            </p>
          </div>
          <Button variant="outline" onClick={() => { setEditingTpl(null); setTplOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New template
          </Button>
        </div>

        {templates.isLoading ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : waTemplates.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={Braces}
              title="No WhatsApp templates yet"
              description="Save your best message copy as a template and reuse it across broadcasts and sequences."
              action={
                <Button variant="outline" onClick={() => { setEditingTpl(null); setTplOpen(true); }}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create template
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {waTemplates.map((t) => {
              const vars = parseVariables(t.variables);
              return (
                <Card key={t.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{t.name}</p>
                      <div className="shrink-0 rounded-lg bg-lime-100 p-1 text-lime-800 dark:bg-lime-950 dark:text-lime-300">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                      </div>
                    </div>
                    <div className="mt-2 max-h-20 overflow-y-auto rounded-lg bg-stone-50 p-2.5 dark:bg-stone-900">
                      <p className="whitespace-pre-line text-xs text-muted-foreground">
                        {t.bodyText || <span className="italic">Empty template</span>}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {vars.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground">No variables</span>
                      ) : (
                        vars.map((v) => (
                          <Badge key={v} variant="outline" className="font-mono text-[10px] font-normal">{`{{${v}}}`}</Badge>
                        ))
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">Updated {formatDate(t.updatedAt)}</span>
                      <span className="flex items-center">
                        <Button
                          size="sm" variant="ghost" aria-label={`Edit template ${t.name}`}
                          onClick={() => { setEditingTpl(t); setTplOpen(true); }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                          aria-label={`Delete template ${t.name}`}
                          onClick={() => { if (confirm(`Delete template "${t.name}"?`)) removeTemplate.mutate(t.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Phone mockup + getting started ── */}
      <section aria-labelledby="wa-preview" className="grid gap-4 lg:grid-cols-[300px,1fr]">
        <h2 id="wa-preview" className="sr-only">WhatsApp preview</h2>
        <PhoneMockup sampleText={renderTokens(waTemplates[0]?.bodyText ?? "")} />
        <Card className="self-start">
          <CardContent className="p-5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ListOrdered className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
              How WhatsApp sending works
            </p>
            <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">1</span>
                Connect your WhatsApp Cloud API phone number and access token in Settings.
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">2</span>
                Save reusable message templates above — tokens like <span className="font-mono text-xs">{"{{first_name}}"}</span> are rendered per contact.
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">3</span>
                Create a broadcast to a list and hit Send — messages enter the engine queue.
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">4</span>
                The engine dispatches with lease protection, retries and per-message evidence.
              </li>
            </ol>
          </CardContent>
        </Card>
      </section>

      {/* ── Dialogs ── */}
      <BroadcastDialog
        open={broadcastOpen}
        lists={lists.data?.lists ?? []}
        onOpenChange={setBroadcastOpen}
        onSaved={() => {
          setBroadcastOpen(false);
          qc.invalidateQueries({ queryKey: ["campaigns"] });
          toast({ title: "Broadcast created", description: "Hit Send now on the card to queue it." });
        }}
      />

      <WaTemplateDialog
        open={tplOpen}
        template={editingTpl}
        onOpenChange={setTplOpen}
        onSaved={() => {
          setTplOpen(false);
          qc.invalidateQueries({ queryKey: ["templates"] });
          toast({ title: editingTpl ? "Template updated" : "Template created" });
        }}
      />
    </div>
  );
}

// ─── Broadcast dialog ────────────────────────────────────────

function BroadcastDialog({
  open, lists, onOpenChange, onSaved,
}: {
  open: boolean; lists: { id: string; name: string }[];
  onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (open) { setName(""); setBodyText(""); setListId(""); }
  }, [open]);

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!bodyText.trim()) {
      toast({ title: "Message required", description: "Write the WhatsApp message to send.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/campaigns", {
        name: name.trim(),
        channel: "whatsapp",
        bodyText: bodyText.trim(),
        audienceType: "list",
        listId: listId || undefined,
      });
      onSaved();
    } catch {
      toast({ title: "Could not create broadcast", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New WhatsApp broadcast</DialogTitle>
          <DialogDescription>Quick one-off message to a list. You can review before sending.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bc-name">Broadcast name</Label>
            <Input id="bc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Flash sale announcement" maxLength={140} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bc-list">Audience list</Label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger aria-label="Audience list"><SelectValue placeholder="Choose a list" /></SelectTrigger>
              <SelectContent>
                {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bc-body">Message</Label>
            <Textarea
              id="bc-body" value={bodyText} rows={5} maxLength={1024}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Hi {{first_name}}! ⚡ Flash sale starts today — 24 hours only."
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Tokens like <span className="font-mono">{"{{first_name}}"}</span> are personalized per contact.</span>
              <span className={bodyText.length > 950 ? "font-medium text-amber-600 dark:text-amber-400" : ""}>
                {bodyText.length}/1024
              </span>
            </div>
          </div>
          <div className="flex justify-center rounded-lg bg-stone-50 p-3 dark:bg-stone-900">
            <div className="max-w-[260px] rounded-2xl rounded-br-sm bg-lime-100 p-3 text-sm shadow dark:bg-lime-900">
              {renderTokens(bodyText) || <span className="text-stone-400">Message preview…</span>}
              <p className="mt-1 text-right text-[10px] text-stone-500">delivered ✓✓</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="bg-teal-600 hover:bg-teal-700">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Create broadcast
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── WhatsApp template dialog ────────────────────────────────

function WaTemplateDialog({
  open, template, onOpenChange, onSaved,
}: {
  open: boolean; template: WaTemplate | null;
  onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (open) {
      setName(template?.name ?? "");
      setBodyText(template?.bodyText ?? "");
    }
  }, [template, open]);

  const variables = useMemo(() => deriveVariables(bodyText), [bodyText]);

  function insertToken(token: string) {
    setBodyText((prev) => `${prev}{{${token}}}`);
  }

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!bodyText.trim()) {
      toast({ title: "Message required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = { name: name.trim(), channel: "whatsapp", bodyText: bodyText.trim(), variables };
      if (template) await api.patch(`/api/templates/${template.id}`, payload);
      else await api.post("/api/templates", payload);
      onSaved();
    } catch {
      toast({ title: "Could not save template", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New WhatsApp template"}</DialogTitle>
          <DialogDescription>Variables are detected automatically from your tokens.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="watpl-name">Template name</Label>
            <Input id="watpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome message" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="watpl-body">Message body</Label>
            <div className="flex flex-wrap gap-1" aria-label="Insert variable token">
              {TOKEN_BUTTONS.map((t) => (
                <button
                  key={t} type="button"
                  className="rounded border px-1.5 py-1 font-mono text-[10px] text-muted-foreground hover:bg-muted"
                  onClick={() => insertToken(t)}
                >
                  +{t}
                </button>
              ))}
            </div>
            <Textarea
              id="watpl-body" value={bodyText} rows={6} maxLength={1024}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Hi {{first_name}}, thanks for reaching out! How can we help?"
            />
            <p className="text-xs text-muted-foreground">{bodyText.length}/1024 characters</p>
          </div>
          {variables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Detected variables:</span>
              {variables.map((v) => (
                <Badge key={v} variant="secondary" className="font-mono text-[10px]">{`{{${v}}}`}</Badge>
              ))}
            </div>
          )}
          <div className="flex justify-center rounded-lg bg-stone-50 p-3 dark:bg-stone-900">
            <div className="max-w-[260px] rounded-2xl rounded-br-sm bg-lime-100 p-3 text-sm shadow dark:bg-lime-900">
              {renderTokens(bodyText) || <span className="text-stone-400">Message preview…</span>}
              <p className="mt-1 text-right text-[10px] text-stone-500">delivered ✓✓</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="bg-teal-600 hover:bg-teal-700">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {template ? "Save changes" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Phone mockup ────────────────────────────────────────────

function PhoneMockup({ sampleText }: { sampleText: string }) {
  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[2.2rem] border-[6px] border-stone-800 bg-stone-800 shadow-xl dark:border-stone-700 dark:bg-stone-700">
      <div className="overflow-hidden rounded-[1.7rem] bg-[#efeae2] dark:bg-stone-900">
        {/* Header */}
        <div className="flex items-center gap-2 bg-teal-900 px-3 py-2.5 text-white">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold">
            AP
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">Automation Platform</p>
            <p className="text-[10px] text-teal-200">online</p>
          </div>
          <Phone className="h-3.5 w-3.5" aria-hidden />
        </div>
        {/* Chat body */}
        <div className="flex min-h-[260px] flex-col justify-end gap-2 p-3">
          <div className="self-center rounded-md bg-[#fdf3c6] px-2 py-0.5 text-[9px] font-medium text-stone-600 shadow-sm">
            TODAY
          </div>
          <div className="max-w-[85%] self-start rounded-2xl rounded-tl-sm bg-white p-2.5 text-xs text-stone-800 shadow-sm">
            {sampleText || "Hi Alex 👋 Welcome aboard — your account is ready."}
            <p className="mt-1 text-right text-[9px] text-stone-400">09:41</p>
          </div>
          <div className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-lime-100 p-2.5 text-xs text-stone-800 shadow-sm dark:bg-lime-900 dark:text-lime-50">
            Thanks! Excited to get started 🎉
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-stone-500 dark:text-lime-300">
              09:42 <CheckCheck className="h-3 w-3" aria-hidden />
            </p>
          </div>
        </div>
        {/* Input bar */}
        <div className="flex items-center gap-2 bg-[#f0f0f0] px-3 py-2 dark:bg-stone-800">
          <div className="flex-1 rounded-full bg-white px-3 py-1.5 text-[11px] text-stone-400 dark:bg-stone-700">
            Message
          </div>
          <Mic className="h-4 w-4 text-stone-500" aria-hidden />
        </div>
      </div>
    </div>
  );
}
