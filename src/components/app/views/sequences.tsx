"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState, StatusBadge, formatDate, formatNumber } from "../shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Mail, MessageSquare, Clock, Tag, XCircle, PenLine, Workflow, Plus, Trash2, Loader2,
  Play, Pause, UserPlus, Pencil, ChevronUp, ChevronDown, Zap, Users, Layers, Eye, X,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

type StepType = "send_email" | "send_whatsapp" | "wait" | "add_tag" | "remove_tag" | "update_field";
type DelayUnit = "minutes" | "hours" | "days";

interface ApiStep {
  id: string; position: number; type: string; name: string;
  config: Record<string, unknown>;
}

interface Sequence {
  id: string; name: string; description: string; status: string;
  triggerType: string; triggerConfig: unknown;
  steps: ApiStep[]; _count: { enrollments: number };
  activeEnrollments: number; updatedAt: string;
}

interface SequencesResponse { sequences: Sequence[] }
interface ListsResponse { lists: { id: string; name: string }[] }
interface Contact {
  id: string; email: string; firstName: string; lastName: string;
  phone: string; company: string;
}

/** Local builder step — config fields flattened for easy editing. */
interface BuilderStep {
  key: string; type: StepType;
  delayAmount: number; delayUnit: DelayUnit;
  subject: string; bodyHtml: string; bodyText: string;
  tag: string; field: string; value: string;
}

// ─── Constants & helpers ─────────────────────────────────────

const STEP_META: Record<StepType, { label: string; icon: React.ElementType }> = {
  send_email: { label: "Send email", icon: Mail },
  send_whatsapp: { label: "Send WhatsApp", icon: MessageSquare },
  wait: { label: "Wait", icon: Clock },
  add_tag: { label: "Add tag", icon: Tag },
  remove_tag: { label: "Remove tag", icon: XCircle },
  update_field: { label: "Update field", icon: PenLine },
};

const TRIGGER_LABELS: Record<string, string> = {
  contact_created: "When contact created",
  added_to_list: "When added to list",
  tagged: "When tagged",
  manual: "Manual",
};

const FIELD_OPTIONS = [
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "phone", label: "Phone" },
  { value: "company", label: "Company" },
  { value: "jobTitle", label: "Job title" },
  { value: "country", label: "Country" },
  { value: "city", label: "City" },
  { value: "lifecycleStage", label: "Lifecycle stage" },
];

const DEFAULT_EMAIL_HTML = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#0f172a">Hi {{first_name}} 👋</h2>
  <p style="color:#334155;line-height:1.6">This is step 1 of your automation. Edit the message below.</p>
</div>`;

let uidCounter = 0;
function uid(): string {
  uidCounter += 1;
  return `s${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

function parseObj(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return (v ?? {}) as Record<string, unknown>;
}

function truncateText(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
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

function fmtDelay(n: number, unit: DelayUnit): string {
  if (!n) return "no delay";
  return `${n} ${n === 1 ? unit.slice(0, -1) : unit}`;
}

function newStep(type: StepType): BuilderStep {
  return {
    key: uid(), type,
    delayAmount: type === "wait" ? 1 : 0,
    delayUnit: "days",
    subject: type === "send_email" ? "Welcome, {{first_name}}!" : "",
    bodyHtml: type === "send_email" ? DEFAULT_EMAIL_HTML : "",
    bodyText: type === "send_whatsapp" ? "Hi {{first_name}}! 👋 Thanks for joining us." : "",
    tag: "", field: "", value: "",
  };
}

function loadSteps(sequence: Sequence): BuilderStep[] {
  return sequence.steps.map((st) => {
    const cfg = parseObj(st.config);
    const amount = Number(cfg.delayAmount ?? 0);
    const unit = String(cfg.delayUnit ?? "days");
    return {
      key: st.id || uid(),
      type: (STEP_META[st.type as StepType] ? st.type : "wait") as StepType,
      delayAmount: Number.isFinite(amount) ? amount : 0,
      delayUnit: (["minutes", "hours", "days"].includes(unit) ? unit : "days") as DelayUnit,
      subject: String(cfg.subject ?? ""),
      bodyHtml: String(cfg.bodyHtml ?? ""),
      bodyText: String(cfg.bodyText ?? ""),
      tag: String(cfg.tag ?? ""),
      field: String(cfg.field ?? ""),
      value: String(cfg.value ?? ""),
    };
  });
}

function stepConfig(s: BuilderStep): Record<string, unknown> {
  switch (s.type) {
    case "send_email": return { subject: s.subject, bodyHtml: s.bodyHtml };
    case "send_whatsapp": return { bodyText: s.bodyText };
    case "add_tag":
    case "remove_tag": return { tag: s.tag };
    case "update_field": return { field: s.field, value: s.value };
    default: return {};
  }
}

function stepSummary(s: BuilderStep): string {
  switch (s.type) {
    case "send_email": return s.subject.trim() || "(no subject)";
    case "send_whatsapp": return s.bodyText.trim() ? truncateText(s.bodyText.trim(), 64) : "(empty message)";
    case "wait": return `Waits ${fmtDelay(s.delayAmount, s.delayUnit)}`;
    case "add_tag": return s.tag.trim() ? `#${s.tag.trim()}` : "(no tag set)";
    case "remove_tag": return s.tag.trim() ? `Remove #${s.tag.trim()}` : "(no tag set)";
    case "update_field": {
      const label = FIELD_OPTIONS.find((f) => f.value === s.field)?.label ?? "";
      return s.field ? `${label} → ${s.value.trim() || "—"}` : "(no field chosen)";
    }
    default: return "";
  }
}

const SCROLLBAR =
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700";

// ─── Main view ───────────────────────────────────────────────

export function SequencesView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [enrollTarget, setEnrollTarget] = useState<Sequence | null>(null);

  const sequences = useQuery({
    queryKey: ["sequences"],
    queryFn: () => api.get<SequencesResponse>("/api/sequences"),
  });
  const lists = useQuery({ queryKey: ["lists"], queryFn: () => api.get<ListsResponse>("/api/lists") });

  const toggle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "pause" }) =>
      api.post<{ status: string }>(`/api/sequences/${id}/activate`, { action }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      toast({
        title: vars.action === "activate" ? "Sequence activated" : "Sequence paused",
        description: vars.action === "activate"
          ? "Contacts matching the trigger will start flowing through."
          : "New contacts will no longer be enrolled.",
      });
    },
    onError: () => toast({ title: "Could not update sequence", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/sequences/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      toast({ title: "Sequence deleted" });
    },
    onError: () => toast({ title: "Could not delete sequence", variant: "destructive" }),
  });

  const listName = (listId: unknown): string => {
    const id = typeof listId === "string" ? listId : "";
    return lists.data?.lists.find((l) => l.id === id)?.name ?? "a list";
  };

  function openBuilder(sequence?: Sequence) {
    setEditing(sequence ?? null);
    setBuilderOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sequences</h2>
          <p className="text-sm text-muted-foreground">
            Multi-step drip automations that run when contacts match a trigger.
          </p>
        </div>
        <Button onClick={() => openBuilder()} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New sequence
        </Button>
      </div>

      {sequences.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : (sequences.data?.sequences ?? []).length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No sequences yet"
          description="Build a drip automation: send an email, wait a couple of days, follow up on WhatsApp — all hands-free."
          action={
            <Button onClick={() => openBuilder()} className="bg-teal-600 hover:bg-teal-700">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create sequence
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(sequences.data?.sequences ?? []).map((s) => {
            const cfg = parseObj(s.triggerConfig);
            return (
              <Card key={s.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{s.name}</p>
                      {s.description && (
                        <p className="truncate text-xs text-muted-foreground">{s.description}</p>
                      )}
                    </div>
                    <StatusBadge status={s.status} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Zap className="h-3 w-3 text-teal-600 dark:text-teal-400" aria-hidden />
                      {TRIGGER_LABELS[s.triggerType] ?? s.triggerType}
                      {s.triggerType === "added_to_list" && <span>· {listName(cfg.listId)}</span>}
                      {s.triggerType === "tagged" && typeof cfg.tag === "string" && cfg.tag && (
                        <span>· #{cfg.tag}</span>
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Layers className="h-3 w-3" aria-hidden /> {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" aria-hidden /> {formatNumber(s.activeEnrollments)} active
                    </span>
                    <span>· {formatNumber(s._count?.enrollments ?? 0)} total</span>
                  </div>

                  <div className="mt-3 flex items-center gap-1.5">
                    {s.status === "active" ? (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => toggle.mutate({ id: s.id, action: "pause" })}
                        disabled={toggle.isPending}
                      >
                        <Pause className="mr-1 h-3.5 w-3.5" aria-hidden /> Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm" variant="outline"
                        className="text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950"
                        disabled={toggle.isPending || s.steps.length === 0}
                        onClick={() => {
                          if (s.steps.length === 0) {
                            toast({
                              title: "Add at least one step",
                              description: "A sequence needs steps before it can be activated.",
                              variant: "destructive",
                            });
                            return;
                          }
                          toggle.mutate({ id: s.id, action: "activate" });
                        }}
                      >
                        <Play className="mr-1 h-3.5 w-3.5" aria-hidden /> Activate
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setEnrollTarget(s)}>
                      <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden /> Enroll
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openBuilder(s)} aria-label={`Edit ${s.name}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => { if (confirm(`Delete "${s.name}"?`)) remove.mutate(s.id); }}
                      aria-label={`Delete sequence ${s.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">Updated {formatDate(s.updatedAt)}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SequenceBuilder
        open={builderOpen}
        sequence={editing}
        lists={lists.data?.lists ?? []}
        onOpenChange={setBuilderOpen}
        onSaved={() => {
          setBuilderOpen(false);
          qc.invalidateQueries({ queryKey: ["sequences"] });
          toast({ title: "Sequence saved" });
        }}
      />

      {enrollTarget && (
        <EnrollDialog sequence={enrollTarget} onClose={() => setEnrollTarget(null)} />
      )}
    </div>
  );
}

// ─── Sequence builder dialog ─────────────────────────────────

function SequenceBuilder({
  open, sequence, lists, onOpenChange, onSaved,
}: {
  open: boolean; sequence: Sequence | null;
  lists: { id: string; name: string }[];
  onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<string>("contact_created");
  const [triggerListId, setTriggerListId] = useState("");
  const [triggerTag, setTriggerTag] = useState("");
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [addType, setAddType] = useState("");
  const [activateAfter, setActivateAfter] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sync form when the dialog opens (render-phase sync — never inside useEffect).
  useMemo(() => {
    if (open && sequence) {
      const cfg = parseObj(sequence.triggerConfig);
      setName(sequence.name);
      setDescription(sequence.description);
      setTriggerType(sequence.triggerType);
      setTriggerListId(typeof cfg.listId === "string" ? cfg.listId : "");
      setTriggerTag(typeof cfg.tag === "string" ? cfg.tag : "");
      setSteps(loadSteps(sequence));
      setSelectedKey(sequence.steps[0]?.id ?? null);
      setActivateAfter(false);
    } else if (open) {
      setName(""); setDescription("");
      setTriggerType("contact_created"); setTriggerListId(""); setTriggerTag("");
      const first = newStep("send_email");
      setSteps([first]);
      setSelectedKey(first.key);
      setActivateAfter(false);
    }
  }, [sequence, open]);

  const selected = steps.find((s) => s.key === selectedKey) ?? null;

  function patchStep(key: string, patch: Partial<BuilderStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function addStep(type: StepType) {
    if (steps.length >= 30) return;
    const step = newStep(type);
    setSteps((prev) => [...prev, step]);
    setSelectedKey(step.key);
  }

  function deleteStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
    if (selectedKey === key) setSelectedKey(null);
  }

  function moveStep(key: string, dir: -1 | 1) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function validate(): string | null {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.type === "send_email" && !s.bodyHtml.trim()) return `Step ${i + 1}: email body is empty`;
      if (s.type === "send_whatsapp" && !s.bodyText.trim()) return `Step ${i + 1}: WhatsApp message is empty`;
      if ((s.type === "add_tag" || s.type === "remove_tag") && !s.tag.trim()) return `Step ${i + 1}: tag name is empty`;
      if (s.type === "update_field" && !s.field) return `Step ${i + 1}: choose a field to update`;
    }
    return null;
  }

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", description: "Give your sequence a name first.", variant: "destructive" });
      return;
    }
    const problem = validate();
    if (problem) {
      toast({ title: "Incomplete step", description: problem, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        triggerType,
        triggerConfig:
          triggerType === "added_to_list"
            ? { listId: triggerListId || undefined }
            : triggerType === "tagged"
              ? { tag: triggerTag.trim() }
              : {},
      };
      let id = sequence?.id;
      if (id) {
        await api.patch(`/api/sequences/${id}`, payload);
      } else {
        const created = await api.post<{ sequence: { id: string } }>("/api/sequences", payload);
        id = created.sequence.id;
      }
      await api.put(`/api/sequences/${id}/steps`, {
        steps: steps.map((s) => ({
          type: s.type,
          name: STEP_META[s.type].label,
          delayAmount: Math.max(0, Math.min(365, Math.round(s.delayAmount || 0))),
          delayUnit: s.delayUnit,
          config: stepConfig(s),
        })),
      });
      if (activateAfter && id) {
        await api.post(`/api/sequences/${id}/activate`, { action: "activate" });
      }
      onSaved();
    } catch {
      toast({ title: "Could not save sequence", description: "Check the steps and try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const previewHtml = useMemo(
    () => renderTokens(selected?.type === "send_email" ? selected.bodyHtml || "<p></p>" : ""),
    [selected]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
            {sequence ? "Edit sequence" : "New sequence"}
          </DialogTitle>
          <DialogDescription>
            Steps run top to bottom. Each step can wait before it fires.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto pr-1 sm:max-h-[70vh]">
          <div className="grid gap-5 lg:grid-cols-2">
            {/* ── Left: basics + step flow ── */}
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="seq-name">Name</Label>
                  <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Onboarding drip" maxLength={140} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seq-desc">Description</Label>
                  <Input id="seq-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this automation do?" maxLength={500} />
                </div>
                <div className="space-y-1.5">
                  <Label>Trigger</Label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger aria-label="Trigger"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contact_created">When contact created</SelectItem>
                      <SelectItem value="added_to_list">When added to list</SelectItem>
                      <SelectItem value="tagged">When tagged</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {triggerType === "added_to_list" && (
                  <div className="space-y-1.5">
                    <Label>List</Label>
                    <Select value={triggerListId} onValueChange={setTriggerListId}>
                      <SelectTrigger aria-label="Trigger list"><SelectValue placeholder="Choose a list" /></SelectTrigger>
                      <SelectContent>
                        {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {triggerType === "tagged" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="seq-tag">Tag</Label>
                    <Input id="seq-tag" value={triggerTag} onChange={(e) => setTriggerTag(e.target.value)} placeholder="newsletter-lead" maxLength={40} />
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</p>
                {steps.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No steps yet — add the first one below.
                  </div>
                ) : (
                  <ol className="relative space-y-2">
                    {steps.map((s, i) => {
                      const meta = STEP_META[s.type];
                      const Icon = meta.icon;
                      const isSelected = s.key === selectedKey;
                      return (
                        <li key={s.key} className="relative flex gap-2.5">
                          {i < steps.length - 1 && (
                            <span className="absolute left-[19px] top-10 -bottom-2 w-0.5 bg-border" aria-hidden />
                          )}
                          <div
                            className={cn(
                              "z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                              isSelected
                                ? "border-teal-600 bg-teal-600 text-white"
                                : "border-border bg-background text-muted-foreground"
                            )}
                          >
                            {i + 1}
                          </div>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedKey(s.key)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedKey(s.key); }
                            }}
                            className={cn(
                              "min-h-[64px] flex-1 cursor-pointer rounded-lg border p-2.5 transition-colors",
                              isSelected
                                ? "border-teal-600/60 bg-teal-50/60 dark:border-teal-500/50 dark:bg-teal-950/40"
                                : "bg-card hover:bg-muted/50"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                                <Icon className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                                {meta.label}
                              </span>
                              <span className="flex shrink-0 items-center">
                                <button
                                  type="button"
                                  className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                  disabled={i === 0}
                                  onClick={(e) => { e.stopPropagation(); moveStep(s.key, -1); }}
                                  aria-label={`Move step ${i + 1} up`}
                                >
                                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                  disabled={i === steps.length - 1}
                                  onClick={(e) => { e.stopPropagation(); moveStep(s.key, 1); }}
                                  aria-label={`Move step ${i + 1} down`}
                                >
                                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                  onClick={(e) => { e.stopPropagation(); deleteStep(s.key); }}
                                  aria-label={`Delete step ${i + 1}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </span>
                            </div>
                            <p className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">{stepSummary(s)}</p>
                            {s.type !== "wait" && s.delayAmount > 0 && (
                              <Badge variant="outline" className="mt-1.5 gap-1 text-[10px] font-normal text-muted-foreground">
                                <Clock className="h-3 w-3" aria-hidden /> waits {fmtDelay(s.delayAmount, s.delayUnit)} first
                              </Badge>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}

                <div className="mt-3">
                  <Select
                    value={addType}
                    onValueChange={(v) => { addStep(v as StepType); setAddType(""); }}
                    disabled={steps.length >= 30}
                  >
                    <SelectTrigger aria-label="Add step" className="min-h-11 w-full">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Plus className="h-4 w-4" aria-hidden />
                        <SelectValue placeholder="Add step" />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STEP_META) as StepType[]).map((t) => {
                        const Icon = STEP_META[t].icon;
                        return (
                          <SelectItem key={t} value={t}>
                            <span className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5" aria-hidden /> {STEP_META[t].label}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {steps.length >= 30 && (
                    <p className="mt-1 text-xs text-muted-foreground">Maximum of 30 steps reached.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Right: step editor ── */}
            <div className="rounded-xl border bg-muted/30 p-4">
              {!selected ? (
                <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                  <div className="rounded-full bg-teal-100 p-3 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
                    <PenLine className="h-5 w-5" aria-hidden />
                  </div>
                  <p className="mt-3 text-sm font-medium">Edit a step</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                    Select a step on the left to configure its message, delay or action.
                  </p>
                </div>
              ) : (
                <StepEditor
                  key={selected.key}
                  step={selected}
                  index={steps.findIndex((s) => s.key === selected.key) + 1}
                  previewOpen={previewOpen}
                  setPreviewOpen={setPreviewOpen}
                  previewHtml={previewHtml}
                  onPatch={(patch) => patchStep(selected.key, patch)}
                />
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          {!(sequence?.status === "active") ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={activateAfter} onCheckedChange={setActivateAfter} aria-label="Activate after saving" />
              Activate immediately
            </label>
          ) : (
            <span className="text-xs text-muted-foreground">This sequence is live — changes apply to new enrollments.</span>
          )}
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy} className="bg-teal-600 hover:bg-teal-700">
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
              Save sequence
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step editor panel ───────────────────────────────────────

function StepEditor({
  step, index, previewOpen, setPreviewOpen, previewHtml, onPatch,
}: {
  step: BuilderStep; index: number;
  previewOpen: boolean; setPreviewOpen: (v: boolean) => void;
  previewHtml: string; onPatch: (patch: Partial<BuilderStep>) => void;
}) {
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const isWait = step.type === "wait";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b pb-3">
        <div className="rounded-lg bg-teal-100 p-1.5 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold">{meta.label}</p>
          <p className="text-[11px] text-muted-foreground">Step {index}</p>
        </div>
      </div>

      {step.type === "send_email" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="step-subject">Subject</Label>
            <Input
              id="step-subject" value={step.subject} maxLength={200}
              onChange={(e) => onPatch({ subject: e.target.value })}
              placeholder="Hey {{first_name}}, quick question…"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="step-bodyhtml">Body (HTML)</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setPreviewOpen(!previewOpen)}>
                <Eye className="mr-1 h-3 w-3" aria-hidden /> {previewOpen ? "Hide preview" : "Preview"}
              </Button>
            </div>
            <Textarea
              id="step-bodyhtml" value={step.bodyHtml} rows={8}
              onChange={(e) => onPatch({ bodyHtml: e.target.value })}
              className="font-mono text-xs" aria-label="Email HTML body"
            />
          </div>
          {previewOpen && (
            <iframe
              title="Step email preview"
              srcDoc={previewHtml}
              className="h-56 w-full rounded-lg border bg-white"
              sandbox="allow-same-origin"
            />
          )}
        </>
      )}

      {step.type === "send_whatsapp" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="step-wabody">WhatsApp message</Label>
            <Textarea
              id="step-wabody" value={step.bodyText} rows={6} maxLength={1024}
              onChange={(e) => onPatch({ bodyText: e.target.value })}
              placeholder="Hi {{first_name}}! ⚡ Quick update…"
            />
            <p className="text-xs text-muted-foreground">{step.bodyText.length}/1024 characters</p>
          </div>
          <div className="rounded-lg bg-stone-50 p-3 dark:bg-stone-900">
            <div className="max-w-[260px] rounded-2xl rounded-br-sm bg-lime-100 p-3 text-sm shadow dark:bg-lime-900">
              {renderTokens(step.bodyText) || <span className="text-stone-400">Message preview…</span>}
              <p className="mt-1 text-right text-[10px] text-stone-500">delivered ✓✓</p>
            </div>
          </div>
        </>
      )}

      {(step.type === "add_tag" || step.type === "remove_tag") && (
        <div className="space-y-1.5">
          <Label htmlFor="step-tag">Tag name</Label>
          <Input
            id="step-tag" value={step.tag} maxLength={40}
            onChange={(e) => onPatch({ tag: e.target.value })}
            placeholder="engaged-lead"
          />
          <p className="text-xs text-muted-foreground">
            {step.type === "add_tag" ? "The tag will be added to the contact." : "The tag will be removed from the contact."}
          </p>
        </div>
      )}

      {step.type === "update_field" && (
        <>
          <div className="space-y-1.5">
            <Label>Field</Label>
            <Select value={step.field} onValueChange={(v) => onPatch({ field: v })}>
              <SelectTrigger aria-label="Field to update"><SelectValue placeholder="Choose a field" /></SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="step-value">Value</Label>
            <Input
              id="step-value" value={step.value} maxLength={200}
              onChange={(e) => onPatch({ value: e.target.value })}
              placeholder="customer"
            />
          </div>
        </>
      )}

      <div className="space-y-1.5 border-t pt-3">
        <Label htmlFor="step-delay-amount">
          {isWait ? "Wait duration" : "Wait before this step"}
        </Label>
        <div className="flex gap-2">
          <Input
            id="step-delay-amount" type="number" min={0} max={365}
            className="w-24" value={String(step.delayAmount)}
            onChange={(e) => {
              const n = Number(e.target.value);
              onPatch({ delayAmount: Number.isFinite(n) ? Math.max(0, Math.min(365, Math.floor(n))) : 0 });
            }}
            aria-label="Delay amount"
          />
          <Select value={step.delayUnit} onValueChange={(v) => onPatch({ delayUnit: v as DelayUnit })}>
            <SelectTrigger aria-label="Delay unit" className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {isWait
            ? "The automation pauses for this long before continuing to the next step."
            : "Optional pause that runs before this step fires."}
        </p>
      </div>
    </div>
  );
}

// ─── Enroll contacts dialog ──────────────────────────────────

function EnrollDialog({ sequence, onClose }: { sequence: Sequence; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Contact[]>([]);

  const results = useQuery({
    queryKey: ["contacts-search", search],
    queryFn: () =>
      api.get<{ contacts: Contact[] }>(`/api/contacts?search=${encodeURIComponent(search)}&limit=10`),
  });

  function onSearchChange(v: string) {
    setSearchInput(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSearch(v), 250);
  }

  function toggle(c: Contact) {
    setSelected((prev) =>
      prev.some((x) => x.id === c.id) ? prev.filter((x) => x.id !== c.id) : [...prev, c]
    );
  }

  const enroll = useMutation({
    mutationFn: () =>
      api.post<{ enrolled: number; skipped: number }>(`/api/sequences/${sequence.id}/enroll`, {
        contactIds: selected.map((c) => c.id),
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      toast({
        title: `Enrolled ${d.enrolled} contact${d.enrolled === 1 ? "" : "s"}`,
        description: d.skipped > 0 ? `${d.skipped} were already active in this sequence.` : "Step 1 is scheduled for each of them.",
      });
      onClose();
    },
    onError: () => toast({ title: "Enroll failed", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll contacts into &quot;{sequence.name}&quot;</DialogTitle>
          <DialogDescription>They start at step 1 immediately.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search contacts by name, email or company…"
            aria-label="Search contacts"
          />

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((c) => (
                <Badge key={c.id} variant="secondary" className="gap-1 bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                  {c.firstName || c.email}
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    aria-label={`Remove ${c.firstName || c.email} from selection`}
                    className="rounded-full hover:bg-teal-200 dark:hover:bg-teal-900"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div
            className={`max-h-64 divide-y overflow-y-auto rounded-lg border ${SCROLLBAR}`}
            aria-label="Contact results"
          >
            {results.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (results.data?.contacts ?? []).length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {search ? `No contacts match "${search}".` : "No contacts found."}
              </p>
            ) : (
              (results.data?.contacts ?? []).map((c) => {
                const checked = selected.some((x) => x.id === c.id);
                return (
                  <label
                    key={c.id}
                    className="flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(c)} aria-label={`Select ${c.email}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.email}{c.company ? ` · ${c.company}` : ""}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => enroll.mutate()}
            disabled={selected.length === 0 || enroll.isPending}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {enroll.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Enroll {selected.length > 0 ? `${selected.length} contact${selected.length === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
