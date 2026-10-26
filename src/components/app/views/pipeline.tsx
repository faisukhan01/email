"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api } from "@/lib/api";
import { EmptyState, StatCard, formatDate, formatMoney } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, CalendarDays, CircleDollarSign, GripVertical, KanbanSquare,
  Loader2, Mail, Plus, Target, Trash2, Trophy,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface DealContact {
  id: string; email: string; firstName: string; lastName: string; company: string | null;
}

interface Deal {
  id: string; title: string; value: number; currency: string; stage: string;
  probability: number; contactId: string | null; contact: DealContact | null;
  expectedCloseAt: string | null; closedAt: string | null; position: number;
  notes: string | null; source: string; updatedAt: string;
}

interface DealsResponse { deals: Deal[] }
interface ContactsResponse { contacts: DealContact[]; total: number }

const STAGES = [
  { id: "new", label: "New", dot: "bg-teal-500" },
  { id: "qualified", label: "Qualified", dot: "bg-lime-500" },
  { id: "proposal", label: "Proposal", dot: "bg-amber-500" },
  { id: "negotiation", label: "Negotiation", dot: "bg-orange-500" },
  { id: "won", label: "Won", dot: "bg-emerald-500" },
  { id: "lost", label: "Lost", dot: "bg-red-500" },
] as const;

type StageId = (typeof STAGES)[number]["id"];
const STAGE_IDS = STAGES.map((s) => s.id) as string[];

/** Mixed collision detection: pointer-accurate for mouse/touch, rect-based for keyboard. */
const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

// ─── View ────────────────────────────────────────────────────

export function PipelineView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  /** Suppresses the click that browsers fire right after a drag ends. */
  const suppressClickRef = useRef(false);

  const deals = useQuery({
    queryKey: ["deals"],
    queryFn: () => api.get<DealsResponse>("/api/deals"),
  });
  const contacts = useQuery({
    queryKey: ["contacts", "picker"],
    queryFn: () => api.get<ContactsResponse>("/api/contacts?limit=200"),
    staleTime: 60_000,
  });

  // Optimistic cross-column move: patch cache first, revert on error.
  const moveDeal = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api.patch(`/api/deals/${id}`, { stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const prev = qc.getQueryData<DealsResponse>(["deals"]);
      qc.setQueryData<DealsResponse>(["deals"], (old) =>
        old
          ? {
              deals: old.deals.map((d) =>
                d.id === id
                  ? {
                      ...d,
                      stage,
                      probability: stage === "won" ? 100 : stage === "lost" ? 0 : d.probability,
                      closedAt: ["won", "lost"].includes(stage) ? new Date().toISOString() : null,
                    }
                  : d
              ),
            }
          : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["deals"], ctx.prev);
      toast({ title: "Could not move deal", description: "The stage change was reverted.", variant: "destructive" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });

  const deleteDeal = useMutation({
    mutationFn: (id: string) => api.del(`/api/deals/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast({ title: "Deal deleted" });
    },
    onError: () => toast({ title: "Could not delete deal", variant: "destructive" }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const allDeals = useMemo(() => deals.data?.deals ?? [], [deals.data]);

  const summary = useMemo(() => {
    const open = allDeals.filter((d) => d.stage !== "won" && d.stage !== "lost");
    const won = allDeals.filter((d) => d.stage === "won");
    const lost = allDeals.filter((d) => d.stage === "lost");
    return {
      openValue: open.reduce((a, d) => a + d.value, 0),
      wonValue: won.reduce((a, d) => a + d.value, 0),
      wonCount: won.length,
      lostCount: lost.length,
      openCount: open.length,
      winRate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
    };
  }, [allDeals]);

  function handleDragStart(event: DragStartEvent) {
    const deal = allDeals.find((d) => d.id === event.active.id) ?? null;
    setActiveDeal(deal);
    suppressClickRef.current = true;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);
    // Release the click-suppression after the trailing click event has fired.
    setTimeout(() => { suppressClickRef.current = false; }, 120);
    if (!over) return;
    const stage = String(over.id);
    if (!STAGE_IDS.includes(stage)) return;
    const deal = allDeals.find((d) => d.id === active.id);
    if (!deal || deal.stage === stage) return;
    moveDeal.mutate({ id: deal.id, stage });
  }

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(deal: Deal) {
    if (suppressClickRef.current) return;
    setEditing(deal);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard title="Open pipeline" value={formatMoney(summary.openValue)} sub={`${summary.openCount} active deals`} icon={KanbanSquare} />
        <StatCard title="Revenue won" value={formatMoney(summary.wonValue)} sub={`${summary.wonCount} deals won`} icon={Trophy} />
        <StatCard
          title="Win rate"
          value={`${summary.winRate}%`}
          sub={summary.wonCount + summary.lostCount > 0 ? `${summary.wonCount}W / ${summary.lostCount}L closed` : "No closed deals yet"}
          icon={Target}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Drag deals between stages — dropping on <span className="font-medium text-foreground">Won</span> or <span className="font-medium text-foreground">Lost</span> closes them automatically.
        </p>
        <Button onClick={openCreate} className="shrink-0 bg-teal-600 hover:bg-teal-700">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New deal
        </Button>
      </div>

      {deals.isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72 min-w-[260px] flex-1 rounded-xl lg:min-w-0" />
          ))}
        </div>
      ) : allDeals.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="No deals in your pipeline"
          description="Track sales opportunities as they move from first contact to a closed win. Create your first deal to get started."
          action={
            <Button onClick={openCreate} className="bg-teal-600 hover:bg-teal-700">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create deal
            </Button>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveDeal(null);
            setTimeout(() => { suppressClickRef.current = false; }, 120);
          }}
        >
          {/* Horizontal scroll on mobile, 6-up grid on desktop */}
          <div className="flex gap-4 overflow-x-auto pb-3 lg:grid lg:grid-cols-6 lg:overflow-x-visible">
            {STAGES.map((stage) => (
              <PipelineColumn
                key={stage.id}
                stage={stage}
                deals={allDeals.filter((d) => d.stage === stage.id)}
                onEdit={openEdit}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 180 }}>
            {activeDeal ? (
              <div className="w-[240px] rotate-1 opacity-90">
                <DealCardBody deal={activeDeal} dragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Create / edit dialog — keyed so state re-initializes per deal */}
      {dialogOpen && (
        <DealDialog
          key={editing?.id ?? "new"}
          deal={editing}
          contacts={contacts.data?.contacts ?? []}
          onClose={() => { setDialogOpen(false); setEditing(null); }}
          onDelete={(id) => {
            setDialogOpen(false);
            setEditing(null);
            deleteDeal.mutate(id);
          }}
        />
      )}
    </div>
  );
}

// ─── Column ──────────────────────────────────────────────────

function PipelineColumn({
  stage, deals, onEdit,
}: {
  stage: (typeof STAGES)[number];
  deals: Deal[];
  onEdit: (deal: Deal) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = deals.reduce((a, d) => a + d.value, 0);

  return (
    <section
      ref={setNodeRef}
      aria-label={`${stage.label} stage, ${deals.length} deals, ${formatMoney(total)}`}
      className={`flex min-w-[260px] flex-1 flex-col rounded-xl border bg-muted/40 p-2 transition-colors lg:min-w-0 ${
        isOver ? "border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/60" : ""
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-1 pb-1 pt-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${stage.dot}`} aria-hidden />
          <h3 className="truncate text-sm font-semibold">{stage.label}</h3>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {deals.length}
          </span>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{formatMoney(total)}</span>
      </header>

      <div className="flex min-h-[120px] flex-1 flex-col gap-2 pt-1">
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-6">
            <p className="text-xs text-muted-foreground">Drop deals here</p>
          </div>
        ) : (
          deals.map((deal) => <DealCard key={deal.id} deal={deal} onEdit={onEdit} />)
        )}
      </div>
    </section>
  );
}

// ─── Card (draggable) ────────────────────────────────────────

function DealCard({ deal, onEdit }: { deal: Deal; onEdit: (deal: Deal) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onEdit(deal)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <DealCardBody deal={deal} />
    </div>
  );
}

function DealCardBody({ deal, dragging = false }: { deal: Deal; dragging?: boolean }) {
  const name = deal.contact ? [deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(" ") : "";
  return (
    <div aria-hidden={dragging}>
      <div className="flex items-start justify-between gap-1.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{deal.title}</p>
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
      </div>

      {deal.contact ? (
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {deal.contact.company && (
            <p className="flex items-center gap-1 truncate">
              <Building2 className="h-3 w-3 shrink-0" aria-hidden /> {deal.contact.company}
            </p>
          )}
          <p className="flex items-center gap-1 truncate">
            <Mail className="h-3 w-3 shrink-0" aria-hidden /> {name || deal.contact.email}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs italic text-muted-foreground/70">No contact linked</p>
      )}

      <p className="mt-2 text-base font-bold tabular-nums">{formatMoney(deal.value, deal.currency)}</p>

      <div className="mt-2 flex items-center gap-2">
        <Progress value={deal.probability} className="h-1" aria-label={`Probability ${deal.probability}%`} />
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{deal.probability}%</span>
      </div>

      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <CalendarDays className="h-3 w-3" aria-hidden />
        {deal.closedAt ? `Closed ${formatDate(deal.closedAt)}` : `Close ${formatDate(deal.expectedCloseAt)}`}
      </p>
    </div>
  );
}

// ─── Create / edit dialog ────────────────────────────────────

function DealDialog({
  deal, contacts, onClose, onDelete,
}: {
  deal: Deal | null;
  contacts: DealContact[];
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(deal?.title ?? "");
  const [contactId, setContactId] = useState(deal?.contactId ?? "none");
  const [value, setValue] = useState(String(deal?.value ?? 0));
  const [stage, setStage] = useState<string>(deal?.stage ?? "new");
  const [probability, setProbability] = useState(String(deal?.probability ?? 10));
  const [expectedCloseAt, setExpectedCloseAt] = useState(
    deal?.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : ""
  );
  const [notes, setNotes] = useState(deal?.notes ?? "");
  const [source, setSource] = useState(deal?.source ?? "manual");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        value: Math.max(0, Number(value) || 0),
        stage,
        probability: Math.min(100, Math.max(0, Math.round(Number(probability) || 0))),
        contactId: contactId !== "none" ? contactId : undefined,
        expectedCloseAt: expectedCloseAt ? new Date(`${expectedCloseAt}T12:00:00Z`).toISOString() : undefined,
        notes,
        source: source.trim() || undefined,
      };
      if (deal) {
        await api.patch(`/api/deals/${deal.id}`, payload);
      } else {
        await api.post("/api/deals", payload);
      }
      qc.invalidateQueries({ queryKey: ["deals"] });
      toast({ title: deal ? "Deal updated" : "Deal created" });
      onClose();
    } catch {
      toast({ title: "Could not save deal", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{deal ? "Edit deal" : "New deal"}</DialogTitle>
          <DialogDescription>
            {deal ? "Update the opportunity details." : "Add an opportunity to your sales pipeline."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="deal-title">Title</Label>
            <Input
              id="deal-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Acme Inc — annual plan" maxLength={160}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deal-contact">Contact</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger id="deal-contact" aria-label="Contact">
                <SelectValue placeholder="Choose a contact" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">No contact</SelectItem>
                {contacts.map((c) => {
                  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
                  return (
                    <SelectItem key={c.id} value={c.id}>
                      {name ? `${name} · ${c.email}` : c.email}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-value">Value (USD)</Label>
              <Input id="deal-value" type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-probability">Probability (%)</Label>
              <Input id="deal-probability" type="number" min={0} max={100} step={1} value={probability} onChange={(e) => setProbability(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-stage">Stage</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger id="deal-stage" aria-label="Stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-close">Expected close</Label>
              <Input id="deal-close" type="date" value={expectedCloseAt} onChange={(e) => setExpectedCloseAt(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-source">Source</Label>
              <Input id="deal-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="manual" maxLength={40} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deal-notes">Notes</Label>
            <Textarea id="deal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} placeholder="Context, next steps, pricing agreed…" />
          </div>
        </div>

        <DialogFooter className="mt-1 items-center gap-2 sm:justify-between">
          {deal ? (
            <Button
              variant="ghost" size="sm"
              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
              disabled={busy}
              onClick={() => { if (confirm(`Delete "${deal.title}"? This cannot be undone.`)) onDelete(deal.id); }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy} className="bg-teal-600 hover:bg-teal-700">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <CircleDollarSign className="mr-1.5 h-4 w-4" aria-hidden />}
              {deal ? "Save changes" : "Create deal"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
