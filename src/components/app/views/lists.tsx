"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { EmptyState, formatNumber } from "../shared";
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
import { useToast } from "@/hooks/use-toast";
import {
  ListChecks, Plus, Loader2, Pencil, Trash2, Users, Eye, SlidersHorizontal,
  Layers, FlaskConical, X, Contact,
} from "lucide-react";

// ─── API shapes ──────────────────────────────────────────────

interface ListRow {
  id: string; name: string; description: string;
  _count: { contacts: number };
}
interface ListsResponse { lists: ListRow[] }

interface SegmentRule {
  field: string; operator: string; value: string; conjunction: "AND" | "OR";
}
interface Segment {
  id: string; name: string; description: string;
  rules: SegmentRule[];
}
interface SegmentsResponse { segments: Segment[] }
interface SegmentPreview {
  total: number; matchedCount: number; sample: { id: string; email: string }[];
}
interface ListContactsResponse {
  contacts: { id: string; email: string; firstName: string; lastName: string }[];
  total: number;
}

const SEGMENT_FIELDS = [
  "email", "firstName", "lastName", "company", "country", "city", "jobTitle",
  "status", "lifecycleStage", "tags", "leadScore", "phone",
] as const;

const SEGMENT_OPERATORS = [
  "equals", "not_equals", "contains", "not_contains", "starts_with",
  "gt", "lt", "in", "not_empty", "is_empty",
] as const;

const NO_VALUE_OPERATORS = new Set(["not_empty", "is_empty"]);

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Please try again.";
}

function humanize(token: string): string {
  return token.replace(/_/g, " ");
}

// ─── Main view ───────────────────────────────────────────────

export function ListsView() {
  const [tab, setTab] = useState("lists");

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <TabsList>
          <TabsTrigger value="lists" className="gap-1.5">
            <ListChecks className="h-3.5 w-3.5" aria-hidden /> Lists
          </TabsTrigger>
          <TabsTrigger value="segments" className="gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Segments
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="lists"><ListsTab /></TabsContent>
      <TabsContent value="segments"><SegmentsTab /></TabsContent>
    </Tabs>
  );
}

// ─── Lists tab ───────────────────────────────────────────────

function ListsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const openContact = useAppStore((s) => s.openContact);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ListRow | null>(null);
  const [viewing, setViewing] = useState<ListRow | null>(null);

  const lists = useQuery({ queryKey: ["lists"], queryFn: () => api.get<ListsResponse>("/api/lists") });

  const deleteList = useMutation({
    mutationFn: (id: string) => api.del(`/api/lists/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      toast({ title: "List deleted" });
    },
    onError: (err) => {
      // 409 / FK constraint — surface the reason gracefully instead of crashing
      toast({
        title: "Could not delete list",
        description: err instanceof ApiError
          ? `${err.message}${err.remediation ? ` — ${err.remediation}` : ""}`
          : describeError(err),
        variant: "destructive",
      });
    },
  });

  function openEditor(list?: ListRow) {
    setEditing(list ?? null);
    setEditorOpen(true);
  }

  const rows = lists.data?.lists ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Static groups of contacts — great for newsletters and broadcasts.
        </p>
        <Button onClick={() => openEditor()} className="shrink-0">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New list
        </Button>
      </div>

      {lists.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No lists yet"
          description="Create a list to group contacts for campaigns, sequences and reporting."
          action={
            <Button onClick={() => openEditor()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create list
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => (
            <div key={l.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{l.name}</p>
                  {l.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{l.description}</p>
                  )}
                </div>
                <div className="shrink-0 rounded-md bg-muted p-1.5 text-muted-foreground">
                  <Users className="h-4 w-4" aria-hidden />
                </div>
              </div>

              <p className="mt-3 text-xs font-medium text-muted-foreground">
                {formatNumber(l._count?.contacts ?? 0)} contact{(l._count?.contacts ?? 0) === 1 ? "" : "s"}
              </p>

              <div className="mt-3 flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setViewing(l)}>
                  <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> View contacts
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openEditor(l)}>Edit</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => {
                    if (confirm(`Delete list "${l.name}"? Contacts are not deleted.`)) {
                      deleteList.mutate(l.id);
                    }
                  }}
                  aria-label={`Delete list ${l.name}`}
                  disabled={deleteList.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ListEditorDialog
        key={editing?.id ?? "new"}
        open={editorOpen}
        list={editing}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditing(null);
        }}
        onSaved={(isNew) => {
          setEditorOpen(false);
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["lists"] });
          toast({ title: isNew ? "List created" : "List updated" });
        }}
      />

      <ListContactsDialog
        list={viewing}
        onClose={() => setViewing(null)}
        onOpenContact={(id) => { setViewing(null); openContact(id); }}
      />
    </div>
  );
}

// ─── List editor ─────────────────────────────────────────────

function ListEditorDialog({
  open, list, onOpenChange, onSaved,
}: {
  open: boolean; list: ListRow | null;
  onOpenChange: (o: boolean) => void; onSaved: (isNew: boolean) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (list) {
      setName(list.name);
      setDescription(list.description ?? "");
    } else {
      setName(""); setDescription("");
    }
  }, [list, open]);

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = { name: name.trim(), description: description.trim().slice(0, 500) };
      if (list) await api.patch(`/api/lists/${list.id}`, payload);
      else await api.post("/api/lists", payload);
      onSaved(!list);
    } catch (err) {
      toast({ title: "Could not save list", description: describeError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{list ? "Edit list" : "New list"}</DialogTitle>
          <DialogDescription>Lists are static segments of contacts you curate manually.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="list-name">Name *</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Newsletter — weekly"
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-desc">Description</Label>
            <Textarea
              id="list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this list for?"
              maxLength={500}
              className="min-h-[80px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {list ? "Save changes" : "Create list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── View contacts in a list ─────────────────────────────────

function ListContactsDialog({
  list, onClose, onOpenContact,
}: {
  list: ListRow | null; onClose: () => void; onOpenContact: (id: string) => void;
}) {
  const contacts = useQuery({
    queryKey: ["list-contacts", list?.id],
    queryFn: () => api.get<ListContactsResponse>(`/api/contacts?listId=${list?.id}&limit=100`),
    enabled: !!list,
  });

  return (
    <Dialog open={!!list} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{list?.name}</DialogTitle>
          <DialogDescription>Click a contact to open their full profile.</DialogDescription>
        </DialogHeader>
        {contacts.isLoading || !list ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
          </div>
        ) : (contacts.data?.contacts ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
            <Contact className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No contacts in this list yet.</p>
            <p className="text-xs text-muted-foreground">Add them from the Contacts view or a bulk action.</p>
          </div>
        ) : (
          <ScrollArea className="h-80 rounded-lg border">
            <ul className="divide-y">
              {(contacts.data?.contacts ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onOpenContact(c.id)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                    </span>
                    <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Segments tab ────────────────────────────────────────────

function SegmentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);

  const segments = useQuery({ queryKey: ["segments"], queryFn: () => api.get<SegmentsResponse>("/api/segments") });

  const deleteSegment = useMutation({
    mutationFn: (id: string) => api.del(`/api/segments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["segments"] });
      toast({ title: "Segment deleted" });
    },
    onError: (err) => toast({ title: "Could not delete segment", description: describeError(err), variant: "destructive" }),
  });

  function openEditor(segment?: Segment) {
    setEditing(segment ?? null);
    setEditorOpen(true);
  }

  const rows = segments.data?.segments ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Dynamic groups computed from rules — always up to date.
        </p>
        <Button onClick={() => openEditor()} className="shrink-0">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New segment
        </Button>
      </div>

      {segments.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No segments yet"
          description="Build rule-based segments like “Score > 70 in the US” and target them from any campaign."
          action={
            <Button onClick={() => openEditor()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create segment
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <div key={s.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.name}</p>
                  {s.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
                  )}
                </div>
                <div className="shrink-0 rounded-md bg-muted p-1.5 text-muted-foreground">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1">
                {s.rules.length === 0 && (
                  <span className="text-xs text-muted-foreground">No conditions — matches everyone</span>
                )}
                {s.rules.slice(0, 3).map((r, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                        {r.conjunction}
                      </span>
                    )}
                    <Badge variant="outline" className="max-w-full text-[11px]">
                      <span className="truncate">
                        {humanize(r.field)} {humanize(r.operator)}{r.value ? ` "${r.value}"` : ""}
                      </span>
                    </Badge>
                  </span>
                ))}
                {s.rules.length > 3 && (
                  <Badge variant="secondary" className="text-[11px]">+{s.rules.length - 3}</Badge>
                )}
              </div>

              <div className="mt-3 flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => openEditor(s)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => {
                    if (confirm(`Delete segment "${s.name}"? Campaigns using it will fall back to no audience.`)) {
                      deleteSegment.mutate(s.id);
                    }
                  }}
                  aria-label={`Delete segment ${s.name}`}
                  disabled={deleteSegment.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SegmentEditorDialog
        key={editing?.id ?? "new"}
        open={editorOpen}
        segment={editing}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditing(null);
        }}
        onSaved={(isNew) => {
          setEditorOpen(false);
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["segments"] });
          toast({ title: isNew ? "Segment created" : "Segment updated" });
        }}
      />
    </div>
  );
}

// ─── Segment rule builder ────────────────────────────────────

interface EditableRule { field: string; operator: string; value: string; conjunction: "AND" | "OR" }

function SegmentEditorDialog({
  open, segment, onOpenChange, onSaved,
}: {
  open: boolean; segment: Segment | null;
  onOpenChange: (o: boolean) => void; onSaved: (isNew: boolean) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (segment) {
      setName(segment.name);
      setDescription(segment.description ?? "");
      setRules(
        segment.rules.length > 0
          ? segment.rules.map((r) => ({ field: r.field, operator: r.operator, value: r.value ?? "", conjunction: r.conjunction ?? "AND" }))
          : [newRule()]
      );
    } else {
      setName(""); setDescription(""); setRules([newRule()]);
    }
    setPreview(null);
  }, [segment, open]);

  function newRule(): EditableRule {
    return { field: "email", operator: "contains", value: "", conjunction: "AND" };
  }

  function updateRule(index: number, patch: Partial<EditableRule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  const rulesPayload = useMemo(
    () =>
      rules.map((r) => ({
        field: r.field,
        operator: r.operator,
        value: NO_VALUE_OPERATORS.has(r.operator) ? "" : r.value.trim(),
        conjunction: r.conjunction,
      })),
    [rules]
  );

  async function runPreview() {
    setBusy(true);
    try {
      const data = await api.put<SegmentPreview>("/api/segments", {
        name: name.trim() || "Preview",
        description: description.trim(),
        rules: rulesPayload,
      });
      setPreview(data);
    } catch (err) {
      toast({ title: "Preview failed", description: describeError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (rules.length === 0) {
      toast({ title: "Add at least one condition", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), rules: rulesPayload };
      if (segment) await api.patch(`/api/segments/${segment.id}`, payload);
      else await api.post("/api/segments", payload);
      onSaved(!segment);
    } catch (err) {
      toast({ title: "Could not save segment", description: describeError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{segment ? "Edit segment" : "New segment"}</DialogTitle>
          <DialogDescription>
            Combine conditions with AND / OR. Use “Preview match” to see how many contacts qualify before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seg-name">Name *</Label>
            <Input
              id="seg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hot leads in the US"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seg-desc">Description</Label>
            <Input
              id="seg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this segment target?"
              maxLength={500}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Conditions</Label>
          {rules.map((rule, i) => {
            const needsValue = !NO_VALUE_OPERATORS.has(rule.operator);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
                {i > 0 ? (
                  <Select
                    value={rule.conjunction}
                    onValueChange={(v) => updateRule(i, { conjunction: v as "AND" | "OR" })}
                  >
                    <SelectTrigger className="h-9 w-[74px]" aria-label={`Conjunction for condition ${i + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AND">AND</SelectItem>
                      <SelectItem value="OR">OR</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="inline-flex h-9 min-w-[74px] items-center justify-center rounded-md border border-dashed px-2 text-xs font-medium text-muted-foreground">
                    WHERE
                  </span>
                )}

                <Select value={rule.field} onValueChange={(v) => updateRule(i, { field: v })}>
                  <SelectTrigger className="h-9 w-[132px]" aria-label={`Field for condition ${i + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEGMENT_FIELDS.map((f) => (
                      <SelectItem key={f} value={f}>{humanize(f)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={rule.operator} onValueChange={(v) => updateRule(i, { operator: v })}>
                  <SelectTrigger className="h-9 w-[150px]" aria-label={`Operator for condition ${i + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEGMENT_OPERATORS.map((op) => (
                      <SelectItem key={op} value={op}>{humanize(op)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {needsValue ? (
                  <Input
                    value={rule.value}
                    onChange={(e) => updateRule(i, { value: e.target.value })}
                    placeholder={rule.operator === "in" ? "a, b, c" : "Value"}
                    className="h-9 min-w-[110px] flex-1"
                    maxLength={200}
                    aria-label={`Value for condition ${i + 1}`}
                  />
                ) : (
                  <span className="min-w-[110px] flex-1 text-xs italic text-muted-foreground">no value needed</span>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-red-600"
                  onClick={() => removeRule(i)}
                  disabled={rules.length === 1}
                  aria-label={`Remove condition ${i + 1}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRules((prev) => [...prev, newRule()])}
              disabled={rules.length >= 20}
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add condition
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runPreview}
              disabled={busy || rules.length === 0}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <FlaskConical className="mr-1 h-3.5 w-3.5" aria-hidden />}
              Preview match
            </Button>
          </div>

          {preview && (
            <div className="rounded-lg border bg-muted p-3">
              <p className="text-sm font-medium text-foreground">
                {formatNumber(preview.matchedCount)} of {formatNumber(preview.total)} contacts match
              </p>
              {preview.sample.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {preview.sample.map((s) => (
                    <Badge key={s.id} variant="secondary" className="max-w-[220px]">
                      <span className="truncate">{s.email}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {segment ? "Save changes" : "Create segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
