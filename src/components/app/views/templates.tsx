"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState, ChannelBadge, formatDate } from "../shared";
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
import { useToast } from "@/hooks/use-toast";
import {
  LayoutTemplate, Mail, Plus, Pencil, Copy, Trash2, Loader2, Braces, Eye, MessageSquare,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface Template {
  id: string; name: string; channel: string; category: string;
  subject: string; bodyHtml: string; bodyText: string; variables: string;
  createdAt: string; updatedAt: string;
}
interface TemplatesResponse { templates: Template[] }

// ─── Helpers ─────────────────────────────────────────────────

const TOKENS = ["first_name", "last_name", "full_name", "email", "company", "job_title", "city", "country"];

const DEFAULT_HTML = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#0f172a">Hi {{first_name}} 👋</h2>
  <p style="color:#334155;line-height:1.6">Write your reusable message here.</p>
</div>`;

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
    .replace(/\{\{\s*job_title\s*\}\}/g, "Product Manager")
    .replace(/\{\{\s*city\s*\}\}/g, "Dubai")
    .replace(/\{\{\s*country\s*\}\}/g, "UAE")
    .replace(/\{\{\s*(\w+)\s*\}\}/g, "—");
}

function truncateText(s: string, n = 120): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

// ─── Main view ───────────────────────────────────────────────

export function TemplatesView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"email" | "whatsapp">("email");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  const templates = useQuery({
    queryKey: ["templates", tab],
    queryFn: () => api.get<TemplatesResponse>(`/api/templates?channel=${tab}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast({ title: "Template deleted" });
    },
    onError: () => toast({ title: "Could not delete template", variant: "destructive" }),
  });

  const duplicate = useMutation({
    mutationFn: (t: Template) =>
      api.post("/api/templates", {
        name: `${t.name} (copy)`.slice(0, 120),
        channel: t.channel,
        category: t.category,
        subject: t.subject,
        bodyHtml: t.bodyHtml,
        bodyText: t.bodyText,
        variables: parseVariables(t.variables),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast({ title: "Template duplicated" });
    },
    onError: () => toast({ title: "Could not duplicate template", variant: "destructive" }),
  });

  function openEditor(t?: Template) {
    setEditing(t ?? null);
    setEditorOpen(true);
  }

  const list = templates.data?.templates ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "email" | "whatsapp")} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="email" className="gap-1.5"><Mail className="h-3.5 w-3.5" aria-hidden />Email</TabsTrigger>
            <TabsTrigger value="whatsapp" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" aria-hidden />WhatsApp</TabsTrigger>
          </TabsList>
          <TabsContent value="email" hidden />
          <TabsContent value="whatsapp" hidden />
        </Tabs>
        <Button onClick={() => openEditor()} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New template
        </Button>
      </div>

      {templates.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title={`No ${tab === "email" ? "email" : "WhatsApp"} templates yet`}
          description="Save reusable message copy with personalization tokens — campaigns and sequences can pick them up."
          action={
            <Button onClick={() => openEditor()} className="bg-teal-600 hover:bg-teal-700">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create template
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const vars = parseVariables(t.variables);
            return (
              <Card key={t.id} className="flex flex-col transition-shadow hover:shadow-md">
                <CardContent className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold">{t.name}</p>
                    <ChannelBadge channel={t.channel} />
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                      {t.category || "general"}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Braces className="h-3 w-3" aria-hidden />
                      {vars.length} variable{vars.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-2.5 min-h-14 flex-1 rounded-lg bg-muted/40 p-2.5">
                    {t.channel === "email" ? (
                      <>
                        <p className="truncate text-xs font-medium">{t.subject || "(no subject)"}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {truncateText(t.bodyHtml.replace(/<[^>]*>/g, " ")) || "Empty body"}
                        </p>
                      </>
                    ) : (
                      <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">
                        {truncateText(t.bodyText) || "Empty body"}
                      </p>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Updated {formatDate(t.updatedAt)}</span>
                    <span className="flex items-center">
                      <Button size="sm" variant="ghost" onClick={() => openEditor(t)} aria-label={`Edit template ${t.name}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button
                        size="sm" variant="ghost" onClick={() => duplicate.mutate(t)}
                        disabled={duplicate.isPending && duplicate.variables?.id === t.id}
                        aria-label={`Duplicate template ${t.name}`}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                        onClick={() => { if (confirm(`Delete template "${t.name}"?`)) remove.mutate(t.id); }}
                        aria-label={`Delete template ${t.name}`}
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

      <TemplateEditor
        open={editorOpen}
        template={editing}
        onOpenChange={setEditorOpen}
        onSaved={() => {
          setEditorOpen(false);
          qc.invalidateQueries({ queryKey: ["templates"] });
          toast({ title: editing ? "Template updated" : "Template created" });
        }}
      />
    </div>
  );
}

// ─── Editor dialog ───────────────────────────────────────────

function TemplateEditor({
  open, template, onOpenChange, onSaved,
}: {
  open: boolean; template: Template | null;
  onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_HTML);
  const [bodyText, setBodyText] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (open && template) {
      setName(template.name);
      setCategory(template.category || "general");
      setChannel(template.channel === "whatsapp" ? "whatsapp" : "email");
      setSubject(template.subject);
      setBodyHtml(template.bodyHtml || DEFAULT_HTML);
      setBodyText(template.bodyText);
    } else if (open) {
      setName(""); setCategory("general"); setChannel("email");
      setSubject(""); setBodyHtml(DEFAULT_HTML); setBodyText("");
    }
  }, [template, open]);

  const isEmail = channel === "email";
  const bodyValue = isEmail ? bodyHtml : bodyText;
  const setBodyValue = isEmail ? setBodyHtml : setBodyText;

  const variables = useMemo(
    () => deriveVariables(isEmail ? `${subject} ${bodyHtml}` : bodyText),
    [isEmail, subject, bodyHtml, bodyText]
  );

  const previewHtml = useMemo(
    () => (isEmail ? renderTokens(bodyHtml || "<p></p>") : ""),
    [isEmail, bodyHtml]
  );

  function insertToken(token: string) {
    setBodyValue((prev) => `${prev}{{${token}}}`);
  }

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (isEmail && !bodyHtml.trim()) {
      toast({ title: "Body required", description: "Email templates need HTML content.", variant: "destructive" });
      return;
    }
    if (!isEmail && !bodyText.trim()) {
      toast({ title: "Body required", description: "WhatsApp templates need message text.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        category: category.trim() || "general",
        channel,
        subject: isEmail ? subject : "",
        bodyHtml: isEmail ? bodyHtml : "",
        bodyText: isEmail ? "" : bodyText,
        variables,
      };
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
            {template ? "Edit template" : "New template"}
          </DialogTitle>
          <DialogDescription>
            Use tokens like <span className="font-mono text-xs">{"{{first_name}}"}</span> — they are rendered per contact at send time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Fields */}
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1 sm:max-h-[60vh]">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome email" maxLength={120} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-category">Category</Label>
                <Input id="tpl-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="onboarding" maxLength={40} />
              </div>
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select
                  value={channel}
                  onValueChange={(v) => setChannel(v as "email" | "whatsapp")}
                  disabled={!!template}
                >
                  <SelectTrigger aria-label="Channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!template && (
              <p className="text-xs text-muted-foreground">Channel cannot be changed after creation.</p>
            )}

            {isEmail && (
              <div className="space-y-1.5">
                <Label htmlFor="tpl-subject">Subject</Label>
                <Input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hey {{first_name}}, welcome!" maxLength={200} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">{isEmail ? "Body (HTML)" : "Message body"}</Label>
              <div className="flex flex-wrap gap-1" aria-label="Insert variable token">
                {TOKENS.map((t) => (
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
                id="tpl-body" value={bodyValue} rows={isEmail ? 10 : 6}
                onChange={(e) => setBodyValue(e.target.value)}
                className={isEmail ? "font-mono text-xs" : ""}
                maxLength={isEmail ? 200_000 : 1024}
                aria-label={isEmail ? "Email HTML body" : "WhatsApp message body"}
              />
              {!isEmail && (
                <p className="text-xs text-muted-foreground">{bodyText.length}/1024 characters</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Detected:</span>
              {variables.length === 0 ? (
                <span className="text-xs text-muted-foreground">no variables</span>
              ) : (
                variables.map((v) => (
                  <Badge key={v} variant="secondary" className="font-mono text-[10px]">{`{{${v}}}`}</Badge>
                ))
              )}
            </div>
          </div>

          {/* Live preview */}
          <div className="max-h-[55vh] space-y-2 overflow-y-auto sm:max-h-[60vh]">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Eye className="h-3.5 w-3.5" aria-hidden /> Live preview
            </p>
            {isEmail ? (
              <iframe
                title="Template email preview"
                srcDoc={previewHtml}
                className="h-72 w-full rounded-lg border bg-white sm:h-[26rem]"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="flex h-72 items-center justify-center rounded-lg border bg-stone-50 p-4 sm:h-[26rem] dark:bg-stone-900">
                <div className="max-w-[260px] rounded-2xl rounded-br-sm bg-lime-100 p-3 text-sm shadow dark:bg-lime-900">
                  {renderTokens(bodyText) || <span className="text-stone-400">Message preview…</span>}
                  <p className="mt-1 text-right text-[10px] text-stone-500">delivered ✓✓</p>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Preview renders with sample values — unknown tokens show as &quot;—&quot;.
            </p>
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
