"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { EmptyState, StatusBadge, formatDate } from "../shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  BookUser, Plus, Loader2, Search, MoreHorizontal, Pencil, Trash2, Tags,
  Import, Users, X, UploadCloud, FileWarning, Filter,
} from "lucide-react";

// ─── API shapes ──────────────────────────────────────────────

interface Contact {
  id: string; email: string; firstName: string; lastName: string; phone: string;
  company: string; jobTitle: string; country: string; city: string; status: string;
  lifecycleStage: string; leadScore: number; tags: string[]; source: string;
  lastActivityAt: string | null; createdAt: string;
}
interface ContactsResponse { contacts: Contact[]; total: number; limit: number; offset: number }
interface ListRow { id: string; name: string; description?: string; _count?: { contacts: number } }
interface ListsResponse { lists: ListRow[] }
interface ImportResult {
  created: number; updated: number; skipped: number;
  errors: { row: number; email: string; reason: string }[];
}
interface BulkResult { affected: number }

const PAGE_SIZE = 20;
const STATUS_FILTERS = ["subscribed", "unsubscribed", "bounced"] as const;
const CONTACT_STATUSES = ["subscribed", "unsubscribed", "bounced", "complained"] as const;
const LIFECYCLE_STAGES = ["subscriber", "lead", "mql", "sql", "customer", "evangelist"] as const;
const FORM_FIELDS = ["email", "firstName", "lastName", "phone", "company", "country", "city", "jobTitle"] as const;

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Please try again.";
}

function contactName(c: Pick<Contact, "firstName" | "lastName" | "email">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
}

// ─── CSV parsing (minimal quoted-field support) ──────────────

const HEADER_ALIASES: Record<string, string> = {
  email: "email", emailaddress: "email", mail: "email",
  firstname: "firstName", fname: "firstName", first: "firstName",
  lastname: "lastName", lname: "lastName", last: "lastName",
  phone: "phone", mobile: "phone", phonenumber: "phone",
  company: "company", organization: "company", org: "company",
  country: "country", city: "city",
  jobtitle: "jobTitle", title: "jobTitle", role: "jobTitle",
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsv(text: string): { rows: Record<string, string>[]; error: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], error: "Paste at least a header row and one data row." };
  const headers = splitCsvLine(lines[0]).map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? "");
  if (!headers.includes("email")) {
    return { rows: [], error: "No email column found. Include a header named 'email'." };
  }
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h && FORM_FIELDS.includes(h as (typeof FORM_FIELDS)[number])) row[h] = cells[i] ?? "";
    });
    if (row.email) rows.push(row);
  }
  return { rows, error: rows.length === 0 ? "No data rows with an email found." : null };
}

// ─── Main view ───────────────────────────────────────────────

export function ContactsView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const openContact = useAppStore((s) => s.openContact);

  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput); // debounce: query key only updates after typing settles
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [tagTarget, setTagTarget] = useState<Contact | null>(null);
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");
  const [importOpen, setImportOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (search.trim()) params.set("search", search.trim());
  if (status !== "all") params.set("status", status);

  const contacts = useQuery({
    queryKey: ["contacts", { search: search.trim(), status, offset }],
    queryFn: () => api.get<ContactsResponse>(`/api/contacts?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const lists = useQuery({ queryKey: ["lists"], queryFn: () => api.get<ListsResponse>("/api/lists") });

  const total = contacts.data?.total ?? 0;
  const rows = contacts.data?.contacts ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allPageSelected = rows.length > 0 && rows.every((c) => selection.has(c.id));
  const somePageSelected = rows.some((c) => selection.has(c.id));

  const deleteContact = useMutation({
    mutationFn: (id: string) => api.del(`/api/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast({ title: "Contact deleted" });
    },
    onError: (err) => toast({ title: "Could not delete contact", description: describeError(err), variant: "destructive" }),
  });

  const bulkAction = useMutation({
    mutationFn: (vars: { action: "add_tag" | "add_to_list" | "set_status" | "delete"; contactIds: string[]; value?: string }) =>
      api.post<BulkResult>("/api/contacts/bulk", vars),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
      setSelection(new Set());
      const labels: Record<string, string> = {
        add_tag: "Tag added", add_to_list: "Contacts added to list",
        set_status: "Status updated", delete: "Contacts deleted",
      };
      toast({ title: labels[vars.action] ?? "Done", description: `${data.affected} contact${data.affected === 1 ? "" : "s"} updated.` });
    },
    onError: (err) => toast({ title: "Bulk action failed", description: describeError(err), variant: "destructive" }),
  });

  const selectedIds = useMemo(() => Array.from(selection), [selection]);

  function toggleRow(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllPage() {
    setSelection((prev) => {
      const next = new Set(prev);
      if (allPageSelected) rows.forEach((c) => next.delete(c.id));
      else rows.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function resetToFirstPage() {
    setOffset(0);
    setSelection(new Set());
  }

  function openEditor(contact?: Contact) {
    setEditing(contact ?? null);
    setEditorOpen(true);
  }

  function openTagDialog(contact: Contact, mode: "add" | "remove") {
    setTagTarget(contact);
    setTagMode(mode);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); resetToFirstPage(); }}
              placeholder="Search name, email, company…"
              className="pl-9"
              aria-label="Search contacts"
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => { setStatus(v); resetToFirstPage(); }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Import className="mr-1.5 h-4 w-4" aria-hidden /> Import CSV
          </Button>
          <Button onClick={() => openEditor()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add contact
          </Button>
        </div>
      </div>

      {/* Bulk toolbar */}
      {selection.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted p-2.5">
          <span className="px-1 text-sm font-medium text-foreground">
            {selection.size} selected
          </span>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <Button size="sm" variant="outline" onClick={() => setBulkTagOpen(true)}>
            <Tags className="mr-1 h-3.5 w-3.5" aria-hidden /> Add tag
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Users className="mr-1 h-3.5 w-3.5" aria-hidden /> Add to list
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Choose a list</DropdownMenuLabel>
              {(lists.data?.lists ?? []).length === 0 && (
                <DropdownMenuItem disabled>No lists yet</DropdownMenuItem>
              )}
              {lists.data?.lists.map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onClick={() => bulkAction.mutate({ action: "add_to_list", contactIds: selectedIds, value: l.id })}
                >
                  {l.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">Set status</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Set status to…</DropdownMenuLabel>
              {CONTACT_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  className="capitalize"
                  onClick={() => bulkAction.mutate({ action: "set_status", contactIds: selectedIds, value: s })}
                >
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950"
            onClick={() => {
              if (confirm(`Delete ${selection.size} selected contact${selection.size === 1 ? "" : "s"}? This cannot be undone.`)) {
                bulkAction.mutate({ action: "delete", contactIds: selectedIds });
              }
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>Clear</Button>
          {bulkAction.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
        </div>
      )}

      {/* Table */}
      {contacts.isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BookUser}
          title={search || status !== "all" ? "No contacts match your filters" : "No contacts yet"}
          description={
            search || status !== "all"
              ? "Try a different search term or clear the status filter."
              : "Add your first contact manually or import a CSV file to get started."
          }
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Import className="mr-1.5 h-4 w-4" aria-hidden /> Import CSV
              </Button>
              <Button onClick={() => openEditor()}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add contact
              </Button>
            </div>
          }
        />
      ) : (
        <Card className="rounded-lg py-0">
          <div className="max-h-[560px] overflow-auto rounded-lg">
            <Table className="min-w-[860px]">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAllPage}
                      aria-label="Select all contacts on this page"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => openContact(c.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selection.has(c.id)}
                        onCheckedChange={() => toggleRow(c.id)}
                        aria-label={`Select ${contactName(c)}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate font-medium">{contactName(c)}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{c.company || "—"}</TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{c.lifecycleStage}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={
                          c.leadScore >= 70
                            ? "font-semibold text-emerald-600"
                            : c.leadScore >= 40
                              ? "font-medium text-amber-600"
                              : "text-muted-foreground"
                        }
                      >
                        {c.leadScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[160px] flex-wrap items-center gap-1">
                        {c.tags.length === 0 && <span className="text-muted-foreground">—</span>}
                        {c.tags.slice(0, 2).map((t) => (
                          <Badge key={t} variant="secondary" className="max-w-[80px] truncate">{t}</Badge>
                        ))}
                        {c.tags.length > 2 && (
                          <Badge variant="secondary" className="text-muted-foreground">+{c.tags.length - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${contactName(c)}`}>
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditor(c)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openTagDialog(c, "add")}>
                            <Tags className="mr-2 h-3.5 w-3.5" aria-hidden /> Add tag
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openTagDialog(c, "remove")} disabled={c.tags.length === 0}>
                            <X className="mr-2 h-3.5 w-3.5" aria-hidden /> Remove tag
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-700"
                            onClick={() => {
                              if (confirm(`Delete "${contactName(c)}"? This cannot be undone.`)) {
                                deleteContact.mutate(c.id);
                              }
                            }}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Pagination */}
          <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {formatRange(offset, total)} of {total} contact{total === 1 ? "" : "s"} · Page {page} of {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || contacts.isFetching}
                onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setSelection(new Set()); }}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total || contacts.isFetching}
                onClick={() => { setOffset(offset + PAGE_SIZE); setSelection(new Set()); }}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Create / edit dialog */}
      <ContactFormDialog
        key={editing?.id ?? "new"}
        open={editorOpen}
        contact={editing}
        lists={lists.data?.lists ?? []}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditing(null);
        }}
        onSaved={(isNew) => {
          setEditorOpen(false);
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["contacts"] });
          qc.invalidateQueries({ queryKey: ["lists"] });
          qc.invalidateQueries({ queryKey: ["contact"] });
          toast({ title: isNew ? "Contact created" : "Contact updated" });
        }}
      />

      {/* Row-level tag dialog */}
      <TagDialog
        open={!!tagTarget}
        mode={tagMode}
        contact={tagTarget}
        onOpenChange={(o) => { if (!o) setTagTarget(null); }}
      />

      {/* Bulk tag dialog */}
      <BulkTagDialog
        open={bulkTagOpen}
        count={selection.size}
        onOpenChange={setBulkTagOpen}
        onApply={(tag) => {
          setBulkTagOpen(false);
          bulkAction.mutate({ action: "add_tag", contactIds: selectedIds, value: tag });
        }}
      />

      {/* CSV import dialog */}
      <ImportDialog
        open={importOpen}
        lists={lists.data?.lists ?? []}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}

function formatRange(offset: number, total: number): string {
  if (total === 0) return "0";
  const end = Math.min(offset + PAGE_SIZE, total);
  return `${offset + 1}–${end}`;
}

// ─── Create / edit contact ───────────────────────────────────

const EMPTY_FORM = {
  email: "", firstName: "", lastName: "", phone: "", company: "",
  jobTitle: "", country: "", city: "", status: "subscribed",
  lifecycleStage: "subscriber", tags: "", listId: "none",
};

function ContactFormDialog({
  open, contact, lists, onOpenChange, onSaved,
}: {
  open: boolean; contact: Contact | null; lists: ListRow[];
  onOpenChange: (o: boolean) => void; onSaved: (isNew: boolean) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  // Reset form when the dialog opens for a different contact (render-phase sync, exemplar pattern)
  useMemo(() => {
    if (contact) {
      setForm({
        email: contact.email, firstName: contact.firstName, lastName: contact.lastName,
        phone: contact.phone, company: contact.company, jobTitle: contact.jobTitle,
        country: contact.country, city: contact.city, status: contact.status,
        lifecycleStage: contact.lifecycleStage, tags: contact.tags.join(", "), listId: "none",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [contact, open]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.email.trim() || !form.email.includes("@")) {
      toast({ title: "Valid email required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        email: form.email.trim().toLowerCase(),
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim(),
        company: form.company.trim(), jobTitle: form.jobTitle.trim(), country: form.country.trim(),
        city: form.city.trim(), status: form.status, lifecycleStage: form.lifecycleStage,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 30),
      };
      if (contact) {
        await api.patch(`/api/contacts/${contact.id}`, payload);
      } else {
        await api.post("/api/contacts", {
          ...payload,
          ...(form.listId !== "none" ? { listIds: [form.listId] } : {}),
        });
      }
      onSaved(!contact);
    } catch (err) {
      toast({ title: "Could not save contact", description: describeError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof EMPTY_FORM, label: string, placeholder?: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`ct-${key}`}>{label}</Label>
      <Input
        id={`ct-${key}`}
        type={type}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        maxLength={type === "email" ? 320 : 120}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            {contact ? "Update the contact profile. Changes sync to every tool instantly." : "Create a new contact and optionally assign them to a list."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ct-email">Email *</Label>
            <Input
              id="ct-email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="jane@acme.com"
              maxLength={320}
              required
            />
          </div>
          {field("firstName", "First name", "Jane")}
          {field("lastName", "Last name", "Doe")}
          {field("phone", "Phone", "+1 555 000 0000", "tel")}
          {field("company", "Company", "Acme Inc")}
          {field("jobTitle", "Job title", "Head of Growth")}
          {field("country", "Country", "United States")}
          {field("city", "City", "San Francisco")}

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTACT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lifecycle stage</Label>
            <Select value={form.lifecycleStage} onValueChange={(v) => set("lifecycleStage", v)}>
              <SelectTrigger aria-label="Lifecycle stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIFECYCLE_STAGES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ct-tags">Tags</Label>
            <Input
              id="ct-tags"
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="vip, newsletter, webinar-2024"
            />
            <p className="text-xs text-muted-foreground">Comma separated, max 30 tags.</p>
          </div>

          {!contact && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Add to list</Label>
              <Select value={form.listId} onValueChange={(v) => set("listId", v)}>
                <SelectTrigger aria-label="Add to list"><SelectValue placeholder="No list" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No list</SelectItem>
                  {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {contact ? "Save changes" : "Create contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row-level add / remove tag ──────────────────────────────

function TagDialog({
  open, mode, contact, onOpenChange,
}: {
  open: boolean; mode: "add" | "remove"; contact: Contact | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tag, setTag] = useState("");

  const patchTags = useMutation({
    mutationFn: (vars: { id: string; tags: string[]; verb: string }) =>
      api.patch(`/api/contacts/${vars.id}`, { tags: vars.tags }).then(() => vars.verb),
    onSuccess: (verb) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact"] });
      toast({ title: verb === "added" ? "Tag added" : "Tag removed" });
    },
    onError: (err) => toast({ title: "Could not update tags", description: describeError(err), variant: "destructive" }),
  });

  function addTag() {
    const t = tag.trim().slice(0, 40);
    if (!t || !contact) return;
    if (contact.tags.includes(t)) {
      toast({ title: "Tag already exists on this contact", variant: "destructive" });
      return;
    }
    patchTags.mutate({ id: contact.id, tags: [...contact.tags, t].slice(0, 30), verb: "added" });
    setTag("");
  }

  function removeTag(t: string) {
    if (!contact) return;
    patchTags.mutate({ id: contact.id, tags: contact.tags.filter((x) => x !== t), verb: "removed" });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setTag(""); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add tag" : "Remove tag"}</DialogTitle>
          <DialogDescription className="truncate">
            {contact ? contactName(contact) : ""}
          </DialogDescription>
        </DialogHeader>

        {mode === "add" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="row-tag">Tag name</Label>
              <Input
                id="row-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder="vip"
                maxLength={40}
                autoFocus
              />
            </div>
            {contact && contact.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <Badge key={t} variant="outline" className="bg-card font-normal text-muted-foreground">{t}</Badge>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {contact?.tags.map((t) => (
              <Badge key={t} variant="outline" className="gap-1 bg-card py-1 pl-2.5 font-normal text-muted-foreground">
                {t}
                <button
                  onClick={() => removeTag(t)}
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label={`Remove tag ${t}`}
                  disabled={patchTags.isPending}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <DialogFooter>
          {mode === "add" ? (
            <Button onClick={addTag} disabled={patchTags.isPending || !tag.trim()}>
              {patchTags.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
              Add tag
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk tag ────────────────────────────────────────────────

function BulkTagDialog({
  open, count, onOpenChange, onApply,
}: {
  open: boolean; count: number; onOpenChange: (o: boolean) => void; onApply: (tag: string) => void;
}) {
  const { toast } = useToast();
  const [tag, setTag] = useState("");

  function apply() {
    const t = tag.trim().slice(0, 40);
    if (!t) {
      toast({ title: "Enter a tag name", variant: "destructive" });
      return;
    }
    onApply(t);
    setTag("");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setTag(""); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add tag to {count} contact{count === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>The tag will be appended to every selected contact.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-tag">Tag name</Label>
          <Input
            id="bulk-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
            placeholder="webinar-2024"
            maxLength={40}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!tag.trim()}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CSV import ──────────────────────────────────────────────

function ImportDialog({
  open, lists, onOpenChange,
}: {
  open: boolean; lists: ListRow[]; onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [csvText, setCsvText] = useState("");
  const [listId, setListId] = useState("none");
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(() => parseCsv(csvText), [csvText]);

  const importMutation = useMutation({
    mutationFn: (vars: { contacts: Record<string, string>[]; listId?: string }) =>
      api.post<ImportResult>("/api/contacts/import", {
        contacts: vars.contacts.slice(0, 2000),
        ...(vars.listId ? { listId: vars.listId } : {}),
      }),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
      toast({
        title: "Import finished",
        description: `${data.created} created · ${data.updated} updated · ${data.skipped} skipped.`,
      });
    },
    onError: (err) => toast({ title: "Import failed", description: describeError(err), variant: "destructive" }),
  });

  function reset() {
    setCsvText(""); setListId("none"); setResult(null);
  }

  function submit() {
    if (parsed.error || parsed.rows.length === 0) {
      toast({ title: "Cannot import", description: parsed.error ?? "Nothing to import.", variant: "destructive" });
      return;
    }
    importMutation.mutate({ contacts: parsed.rows, listId: listId === "none" ? undefined : listId });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Paste CSV text or upload a file. The first row must be headers — recognized columns: email, firstName, lastName, phone, company, country, city, jobTitle.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xl font-semibold text-emerald-600">{result.created}</p>
                <p className="text-xs text-muted-foreground">Created</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xl font-semibold text-amber-600">{result.updated}</p>
                <p className="text-xs text-muted-foreground">Updated</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xl font-semibold text-muted-foreground">{result.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-900 dark:bg-orange-950/40">
                <p className="flex items-center gap-1.5 text-sm font-medium text-orange-800 dark:text-orange-300">
                  <FileWarning className="h-4 w-4" aria-hidden /> {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped
                </p>
                <ul className="mt-2 space-y-1 text-xs text-orange-800/90 dark:text-orange-300/90">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>Row {e.row} ({e.email}): {e.reason}</li>
                  ))}
                  {result.errors.length > 5 && <li>…and {result.errors.length - 5} more</li>}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="csv-file">Upload file</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    setCsvText(text);
                    setResult(null);
                    toast({ title: `Loaded ${file.name}`, description: "Review the parsed row count below." });
                  } catch {
                    toast({ title: "Could not read file", variant: "destructive" });
                  }
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="csv-text">Or paste CSV</Label>
              <Textarea
                id="csv-text"
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); setResult(null); }}
                placeholder={"email,firstName,lastName,company\ndana@acme.com,Dana,Reed,Acme Inc"}
                className="min-h-[140px] font-mono text-xs"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {csvText.trim()
                  ? parsed.error
                    ? parsed.error
                    : `${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} parsed, ready to import.`
                  : "Waiting for CSV input…"}
              </span>
              {csvText && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>Clear</Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Optionally add imported contacts to</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger aria-label="Target list"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No list</SelectItem>
                  {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>Cancel</Button>
              <Button
                onClick={submit}
                disabled={importMutation.isPending || !parsed.rows.length || !!parsed.error}
              >
                {importMutation.isPending ? (
                  <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> Importing…</>
                ) : (
                  <><UploadCloud className="mr-1.5 h-4 w-4" aria-hidden /> Import {parsed.rows.length || ""}</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
