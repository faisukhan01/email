"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, ChannelBadge, formatDate, formatDateTime } from "./shared";
import { useAppStore } from "@/lib/store";
import { Activity, Mail, Phone, Building2, MapPin, Briefcase, Plus, Loader2, History, TrendingUp } from "lucide-react";

interface ContactDetail {
  contact: {
    id: string; email: string; firstName: string; lastName: string; phone: string;
    company: string; jobTitle: string; country: string; city: string; status: string;
    lifecycleStage: string; leadScore: number; tags: string; source: string;
    notes: string; createdAt: string; lastActivityAt: string | null;
  };
  lists: { id: string; name: string }[];
  messages: {
    id: string; channel: string; subject: string; status: string; provider: string;
    sentAt: string | null; openedAt: string | null; clickedAt: string | null; error: string | null;
  }[];
  activities: { id: string; type: string; title: string; content: string; createdAt: string }[];
  events: { id: string; type: string; createdAt: string }[];
}

export function ContactDrawer() {
  const { contactDrawer, closeContact } = useAppStore();
  const qc = useQueryClient();
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  const open = !!contactDrawer;
  const contactId = contactDrawer?.contactId ?? "";

  const { data, isLoading } = useQuery({
    queryKey: ["contact", contactId],
    queryFn: () => api.get<ContactDetail>(`/api/contacts/${contactId}`),
    enabled: open && !!contactId,
  });

  const addNote = useMutation({
    mutationFn: () =>
      api.post("/api/activities", {
        contactId,
        type: "note",
        title: noteTitle || "Note",
        content: noteContent,
      }),
    onSuccess: () => {
      setNoteTitle("");
      setNoteContent("");
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
    },
  });

  const c = data?.contact;
  const tags: string[] = c
    ? typeof c.tags === "string"
      ? JSON.parse(c.tags || "[]")
      : Array.isArray(c.tags)
        ? c.tags
        : []
    : [];

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          closeContact();
          setNoteTitle("");
          setNoteContent("");
        }
      }}
      shouldScaleBackground={false}
    >
      <DrawerContent className="h-[92dvh]">
        <div className="mx-auto h-full w-full max-w-3xl overflow-hidden">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="flex items-center gap-3">
              <span className="truncate">
                {c ? `${c.firstName} ${c.lastName}`.trim() || c.email : "Contact"}
              </span>
              {c && <StatusBadge status={c.status} />}
            </DrawerTitle>
            <DrawerDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden />{c?.email ?? ""}</span>
              {c?.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden />{c.phone}</span>}
              {c?.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" aria-hidden />{c.company}</span>}
              {(c?.city || c?.country) && (
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{[c.city, c.country].filter(Boolean).join(", ")}</span>
              )}
              {c?.jobTitle && <span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" aria-hidden />{c.jobTitle}</span>}
            </DrawerDescription>
          </DrawerHeader>

          {isLoading || !c ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Tabs defaultValue="overview" className="px-4 pb-6">
              <TabsList className="mb-3 w-full justify-start sm:w-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="messages">Messages ({data.messages.length})</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[56dvh] pr-2">
                <TabsContent value="overview" className="mt-0 space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Lead score</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xl font-semibold">
                        {c.leadScore} <TrendingUp className="h-4 w-4 text-teal-600" aria-hidden />
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Lifecycle</p>
                      <p className="mt-1 text-sm font-semibold capitalize">{c.lifecycleStage}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Source</p>
                      <p className="mt-1 text-sm font-semibold capitalize">{c.source}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Added</p>
                      <p className="mt-1 text-sm font-semibold">{formatDate(c.createdAt)}</p>
                    </div>
                  </div>

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <Badge key={t} variant="outline" className="border-teal-300 text-teal-800 dark:border-teal-700 dark:text-teal-300">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {data.lists.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Lists</p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.lists.map((l) => (
                          <Badge key={l.id} variant="secondary">{l.name}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <Separator />

                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                      <Plus className="h-4 w-4" aria-hidden /> Add note
                    </p>
                    <div className="space-y-2">
                      <Input
                        placeholder="Note title (optional)"
                        value={noteTitle}
                        onChange={(e) => setNoteTitle(e.target.value)}
                        maxLength={160}
                      />
                      <Textarea
                        placeholder="What happened?"
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        maxLength={4000}
                        rows={3}
                      />
                      <Button
                        size="sm"
                        onClick={() => addNote.mutate()}
                        disabled={addNote.isPending}
                        className="bg-teal-600 hover:bg-teal-700"
                      >
                        {addNote.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
                        Save note
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="messages" className="mt-0">
                  {data.messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No messages sent to this contact yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.messages.map((m) => (
                        <li key={m.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 truncate text-sm font-medium">
                              <ChannelBadge channel={m.channel} />
                              <span className="truncate">{m.subject || "(no subject)"}</span>
                            </span>
                            <StatusBadge status={m.status} />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {m.sentAt ? `Sent ${formatDateTime(m.sentAt)}` : "Queued"}
                            {m.openedAt && ` · Opened ${formatDateTime(m.openedAt)}`}
                            {m.clickedAt && ` · Clicked ${formatDateTime(m.clickedAt)}`}
                            {m.error && ` · ${m.error}`}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="timeline" className="mt-0">
                  {data.activities.length === 0 && data.events.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No timeline entries yet.</p>
                  ) : (
                    <ol className="relative space-y-3 border-l pl-4">
                      {[
                        ...data.activities.map((a) => ({
                          key: a.id, type: a.type, title: a.title, content: a.content, at: a.createdAt,
                        })),
                        ...data.events.map((e) => ({
                          key: e.id, type: "event", title: e.type.replace(/[._]/g, " "), content: "", at: e.createdAt,
                        })),
                      ]
                        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                        .slice(0, 30)
                        .map((item) => (
                          <li key={item.key} className="relative">
                            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-teal-500 bg-background" aria-hidden />
                            <p className="flex items-center gap-2 text-sm font-medium capitalize">
                              <History className="h-3 w-3 text-muted-foreground" aria-hidden />
                              {item.title}
                            </p>
                            {item.content && <p className="mt-0.5 text-xs text-muted-foreground">{item.content}</p>}
                            <time className="text-[11px] text-muted-foreground">{formatDateTime(item.at)}</time>
                          </li>
                        ))}
                    </ol>
                  )}
                </TabsContent>
              </ScrollArea>
            </Tabs>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
