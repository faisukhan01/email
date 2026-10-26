"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Check, Copy, FlaskConical, KeyRound, Loader2, LogOut, Mail, Plug, RefreshCcwDot,
  Server, ShieldAlert, UserRound, Webhook,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface IntegrationInfo {
  emailProvider: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPassSet: boolean;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  resendApiKeySet: boolean;
  waPhoneNumberId: string | null;
  waAccessTokenSet: boolean;
  waVerifyToken: string | null;
}

interface IntegrationsData {
  integration: IntegrationInfo;
  simulationMode: boolean;
}

interface ApiKeyRecord {
  id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null;
}

interface ApiKeysData { keys: ApiKeyRecord[] }

interface EngineData {
  reachable: boolean;
  engine: {
    status: string; worker?: string; tickInterval?: number; hint?: string;
    queue?: { pending: number; running: number; dead: number };
  };
}

interface MeData {
  user: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string; simulationMode: boolean; timezone: string; currency: string } | null;
  connected: boolean;
  channelMode?: string;
}

/** Browser-only value (window.location.origin) without setState-in-effect. */
function useOrigin(): string {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  );
}

// ─── View ────────────────────────────────────────────────────

export function SettingsView() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Channels, API access, the automation engine and your profile.</p>
      </div>

      <Tabs defaultValue="channels">
        <TabsList className="grid w-full grid-cols-4 sm:w-auto sm:grid-cols-4">
          <TabsTrigger value="channels" className="gap-1.5 text-xs sm:text-sm"><Plug className="h-3.5 w-3.5" aria-hidden />Channels</TabsTrigger>
          <TabsTrigger value="apikeys" className="gap-1.5 text-xs sm:text-sm"><KeyRound className="h-3.5 w-3.5" aria-hidden />API Keys</TabsTrigger>
          <TabsTrigger value="engine" className="gap-1.5 text-xs sm:text-sm"><Server className="h-3.5 w-3.5" aria-hidden />Engine</TabsTrigger>
          <TabsTrigger value="profile" className="gap-1.5 text-xs sm:text-sm"><UserRound className="h-3.5 w-3.5" aria-hidden />Profile</TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="mt-4"><ChannelsTab /></TabsContent>
        <TabsContent value="apikeys" className="mt-4"><ApiKeysTab /></TabsContent>
        <TabsContent value="engine" className="mt-4"><EngineTab /></TabsContent>
        <TabsContent value="profile" className="mt-4"><ProfileTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Channels tab ────────────────────────────────────────────

function ChannelsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.get<IntegrationsData>("/api/settings/integrations"),
  });

  const setSimulation = useMutation({
    mutationFn: (v: boolean) => api.put("/api/settings/integrations", { simulationMode: v }),
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast({
        title: v ? "Simulation mode enabled" : "Simulation mode disabled",
        description: v
          ? "Outbound messages route through a realistic simulator; no real emails leave."
          : "Messages will now go out through your configured provider.",
      });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast({ title: "Could not update simulation mode", variant: "destructive" });
    },
  });

  if (integrations.isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>;
  }
  if (integrations.error || !integrations.data) {
    return (
      <EmptyState
        icon={Plug}
        title="Could not load channel settings"
        description="Refresh the page to try again."
        action={<Button variant="outline" onClick={() => integrations.refetch()}>Retry</Button>}
      />
    );
  }

  const d = integrations.data;

  return (
    <div className="space-y-4">
      {/* Simulation mode */}
      <Card className="rounded-lg bg-muted/40 shadow-none">
        <CardContent className="flex items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> Simulation mode
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Routes every send through a realistic simulator — delivery, opens and clicks are tracked, but no real emails or WhatsApp messages leave the platform.
            </p>
            {d.integration.emailProvider === "simulator" && !d.simulationMode && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Provider is &quot;simulator&quot; — configure SMTP or Resend below for real delivery.
              </p>
            )}
          </div>
          <Switch
            checked={d.simulationMode}
            disabled={setSimulation.isPending}
            onCheckedChange={(v) => setSimulation.mutate(v)}
            aria-label="Toggle simulation mode"
            className="mt-1 shrink-0"
          />
        </CardContent>
      </Card>

      {/* Provider + integration form (mounts once data is available so state initializes from the server) */}
      <ChannelsForm data={d} />
    </div>
  );
}

function ChannelsForm({ data }: { data: IntegrationsData }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const baseline = useRef<IntegrationInfo>(data.integration);

  const [emailProvider, setEmailProvider] = useState(data.integration.emailProvider);
  const [smtpHost, setSmtpHost] = useState(data.integration.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(data.integration.smtpPort ?? ""));
  const [smtpSecure, setSmtpSecure] = useState(data.integration.smtpSecure ?? true);
  const [smtpUser, setSmtpUser] = useState(data.integration.smtpUser ?? "");
  const [smtpPass, setSmtpPass] = useState("");
  const [fromName, setFromName] = useState(data.integration.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(data.integration.fromEmail ?? "");
  const [replyTo, setReplyTo] = useState(data.integration.replyTo ?? "");
  const [resendApiKey, setResendApiKey] = useState("");
  const [waPhoneNumberId, setWaPhoneNumberId] = useState(data.integration.waPhoneNumberId ?? "");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState(data.integration.waVerifyToken ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const b = baseline.current;
      const payload: Record<string, unknown> = {};
      if (emailProvider !== b.emailProvider) payload.emailProvider = emailProvider;
      if (smtpHost !== (b.smtpHost ?? "")) payload.smtpHost = smtpHost;
      {
        const port = Number(smtpPort);
        if (smtpPort !== String(b.smtpPort ?? "") && Number.isInteger(port) && port >= 1 && port <= 65535) {
          payload.smtpPort = port;
        }
      }
      if (smtpSecure !== (b.smtpSecure ?? true)) payload.smtpSecure = smtpSecure;
      if (smtpUser !== (b.smtpUser ?? "")) payload.smtpUser = smtpUser;
      if (fromName !== (b.fromName ?? "")) payload.fromName = fromName;
      if (fromEmail !== (b.fromEmail ?? "")) payload.fromEmail = fromEmail;
      if (replyTo !== (b.replyTo ?? "")) payload.replyTo = replyTo;
      if (waPhoneNumberId !== (b.waPhoneNumberId ?? "")) payload.waPhoneNumberId = waPhoneNumberId;
      if (waVerifyToken !== (b.waVerifyToken ?? "")) payload.waVerifyToken = waVerifyToken;
      // Secrets are only ever sent when the user typed a new value.
      if (smtpPass.trim()) payload.smtpPass = smtpPass;
      if (resendApiKey.trim()) payload.resendApiKey = resendApiKey;
      if (waAccessToken.trim()) payload.waAccessToken = waAccessToken;

      if (Object.keys(payload).length === 0) {
        toast({ title: "Nothing to save", description: "No settings were changed." });
        return;
      }

      await api.put("/api/settings/integrations", payload);
      baseline.current = {
        ...b,
        ...(payload as Partial<IntegrationInfo>),
        smtpPassSet: payload.smtpPass ? true : b.smtpPassSet,
        resendApiKeySet: payload.resendApiKey ? true : b.resendApiKeySet,
        waAccessTokenSet: payload.waAccessToken ? true : b.waAccessTokenSet,
      };
      setSmtpPass(""); setResendApiKey(""); setWaAccessToken("");
      qc.invalidateQueries({ queryKey: ["integrations"] });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast({ title: "Channel settings saved" });
    } catch {
      toast({ title: "Could not save settings", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-lg shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Delivery channels</CardTitle>
        <CardDescription>Configure how email and WhatsApp messages are delivered. Saved secrets are encrypted and never shown again.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email provider */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="int-provider">Email provider</Label>
            <Select value={emailProvider} onValueChange={setEmailProvider}>
              <SelectTrigger id="int-provider" aria-label="Email provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="simulator">Simulator (safe testing)</SelectItem>
                <SelectItem value="smtp">SMTP server</SelectItem>
                <SelectItem value="resend">Resend API</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Active provider for all email campaigns and automations.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="int-fromname">Default from name</Label>
            <Input id="int-fromname" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Growth Team" maxLength={80} />
            <p className="text-xs text-muted-foreground">Used when a campaign doesn&apos;t set its own sender.</p>
          </div>
        </div>

        {/* SMTP */}
        <section className="rounded-lg border p-4" aria-label="SMTP settings">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden /> SMTP server
            <Badge variant="secondary" className={emailProvider === "smtp" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ""}>
              {emailProvider === "smtp" ? "Active" : "Inactive"}
            </Badge>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">Host</Label>
              <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">Port</Label>
              <Input id="smtp-port" type="number" min={1} max={65535} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">Username</Label>
              <Input id="smtp-user" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="postmaster@example.com" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-pass">Password</Label>
              <Input
                id="smtp-pass" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={data.integration.smtpPassSet ? "•••• (unchanged)" : "Not set"}
                autoComplete="new-password"
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch id="smtp-secure" checked={smtpSecure} onCheckedChange={setSmtpSecure} />
              <Label htmlFor="smtp-secure" className="cursor-pointer">Use TLS/SSL secure connection</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="int-fromemail">From email</Label>
              <Input id="int-fromemail" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="hello@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="int-replyto">Reply-to</Label>
              <Input id="int-replyto" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="support@company.com" />
            </div>
          </div>
        </section>

        {/* Resend */}
        <section className="rounded-lg border p-4" aria-label="Resend settings">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden /> Resend API
            <Badge variant="secondary" className={emailProvider === "resend" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ""}>
              {emailProvider === "resend" ? "Active" : "Inactive"}
            </Badge>
            {data.integration.resendApiKeySet && <Badge variant="outline" className="text-[10px]">key saved</Badge>}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="resend-key">API key</Label>
            <Input
              id="resend-key" type="password" value={resendApiKey} onChange={(e) => setResendApiKey(e.target.value)}
              placeholder={data.integration.resendApiKeySet ? "•••• (unchanged)" : "re_…"}
              autoComplete="new-password"
            />
          </div>
        </section>

        {/* WhatsApp Cloud */}
        <section className="rounded-lg border p-4" aria-label="WhatsApp Cloud API settings">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Webhook className="h-4 w-4 text-muted-foreground" aria-hidden /> WhatsApp Cloud API
            {data.integration.waAccessTokenSet && <Badge variant="outline" className="text-[10px]">token saved</Badge>}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wa-phone">Phone number ID</Label>
              <Input id="wa-phone" value={waPhoneNumberId} onChange={(e) => setWaPhoneNumberId(e.target.value)} placeholder="1234567890" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-token">Access token</Label>
              <Input
                id="wa-token" type="password" value={waAccessToken} onChange={(e) => setWaAccessToken(e.target.value)}
                placeholder={data.integration.waAccessTokenSet ? "•••• (unchanged)" : "EAAG…"}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="wa-verify">Webhook verify token</Label>
              <Input id="wa-verify" value={waVerifyToken} onChange={(e) => setWaVerifyToken(e.target.value)} placeholder="Any random string you also set in Meta's webhook config" />
              <p className="text-xs text-muted-foreground">
                Set the webhook URL in the Engine tab inside your Meta app configuration.
              </p>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Save channel settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── API keys tab ────────────────────────────────────────────

function ApiKeysTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [createdRaw, setCreatedRaw] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api.get<ApiKeysData>("/api/settings/api-keys") });

  const createKey = useMutation({
    mutationFn: (keyName: string) => api.post<{ raw: string }>("/api/settings/api-keys", { name: keyName }),
    onSuccess: (data) => {
      setCreatedRaw(data.raw);
      setName("");
      setCopied(false);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: () => toast({ title: "Could not create API key", variant: "destructive" }),
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.del(`/api/settings/api-keys?id=${encodeURIComponent(id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "API key revoked" });
    },
    onError: () => toast({ title: "Could not revoke key", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Create API key</CardTitle>
          <CardDescription>Authenticate external tools against the REST API with a bearer token.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              createKey.mutate(name.trim());
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Zapier integration"
              maxLength={60}
              aria-label="API key name"
            />
            <Button type="submit" disabled={!name.trim() || createKey.isPending} className="shrink-0">
              {createKey.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />}
              Create key
            </Button>
          </form>
        </CardContent>
      </Card>

      {keys.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : !keys.data || keys.data.keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys"
          description="Create a key to let external services trigger automations and read data securely."
        />
      ) : (
        <Card className="rounded-lg shadow-none">
          <CardContent className="p-0">
            <ul className="divide-y">
              {keys.data.keys.map((k) => (
                <li key={k.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{k.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{k.prefix}••••••••</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Created {new Date(k.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {" · "}
                      {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never used"}
                    </p>
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                    disabled={revokeKey.isPending}
                    onClick={() => { if (confirm(`Revoke "${k.name}"? Apps using it will stop working.`)) revokeKey.mutate(k.id); }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Raw key shown exactly once */}
      <Dialog open={!!createdRaw} onOpenChange={(o) => { if (!o) setCreatedRaw(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy it now — <span className="font-semibold text-amber-600 dark:text-amber-400">you won&apos;t see this again</span>. Only a hash is stored server-side.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/50 p-3">
            <code className="block break-all font-mono text-xs" data-testid="raw-api-key">{createdRaw}</code>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(createdRaw ?? "").then(() => {
                  setCopied(true);
                  toast({ title: "API key copied to clipboard" });
                }).catch(() => toast({ title: "Copy failed — select the key manually", variant: "destructive" }));
              }}
            >
              {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden />}
              {copied ? "Copied" : "Copy key"}
            </Button>
            <Button variant="outline" onClick={() => setCreatedRaw(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Engine tab ──────────────────────────────────────────────

function EngineTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const origin = useOrigin();

  const engine = useQuery({
    queryKey: ["engine"],
    queryFn: () => api.get<EngineData>("/api/engine"),
    refetchInterval: 5000,
  });

  const triggerTick = useMutation({
    mutationFn: () => api.post<{ tick?: { stats?: { claimed: number; done: number; failed: number; requeued: number } } }>("/api/engine"),
    onSuccess: (data) => {
      const s = data.tick?.stats;
      toast({
        title: "Engine tick complete",
        description: s ? `Claimed ${s.claimed ?? 0} · Completed ${s.done ?? 0} · Failed ${s.failed ?? 0} · Requeued ${s.requeued ?? 0}` : "Queue processed.",
      });
      qc.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: () =>
      toast({
        title: "Engine unreachable",
        description: "The engine processes queued work automatically every 15 seconds.",
        variant: "destructive",
      }),
  });

  const e = engine.data?.engine;
  const online = !!engine.data?.reachable;
  const queue = e?.queue;
  const onlineAt = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

  const webhookUrl = `${origin}/api/webhooks/whatsapp`;
  const openPixel = `${origin}/api/track/open/{messageId}`;
  const subscribeUrl = `${origin}/api/public/subscribe`;

  const subscribeExample = useMemo(
    () =>
      JSON.stringify(
        {
          workspaceId: "your-workspace-id",
          email: "person@example.com",
          firstName: "Alex",
          lastName: "Morgan",
          listId: "optional-list-id",
        },
        null,
        2
      ),
    []
  );

  function copyText(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast({ title: `${label} copied` }),
      () => toast({ title: "Copy failed", variant: "destructive" })
    );
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <Card className="rounded-lg shadow-none">
        <CardContent className="p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${online ? "bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20" : "bg-red-500 shadow-[0_0_0_3px] shadow-red-500/20"}`}
                role="status"
                aria-label={online ? "Engine online" : "Engine offline"}
              />
              <div>
                <p className="text-sm font-semibold">Automation engine is {online ? "online" : "offline"}</p>
                <p className="text-xs text-muted-foreground">
                  {online
                    ? `Status "${e?.status}" · worker ${e?.worker ?? "—"} · tick every ${e?.tickInterval ?? 15}s · checked ${onlineAt}`
                    : e?.hint ?? "The engine mini-service is not responding."}
                </p>
              </div>
            </div>
            <Button onClick={() => triggerTick.mutate()} disabled={triggerTick.isPending} variant="outline" className="shrink-0">
              {triggerTick.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCcwDot className="mr-1.5 h-4 w-4" aria-hidden />}
              Trigger tick now
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Pending", value: queue?.pending ?? 0, hint: "Waiting to be claimed", dot: "bg-zinc-400 dark:bg-zinc-600" },
              { label: "Running", value: queue?.running ?? 0, hint: "Leased by a worker", dot: "bg-amber-500" },
              { label: "Dead", value: queue?.dead ?? 0, hint: "Exceeded retries", dot: "bg-red-500" },
            ].map((q) => (
              <div key={q.label} className="rounded-lg border bg-muted/40 p-3 text-center">
                <p className="text-xl font-semibold tabular-nums">{q.value}</p>
                <p className="flex items-center justify-center gap-1.5 text-xs font-medium">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${q.dot}`} aria-hidden />
                  {q.label}
                </p>
                <p className="text-[10px] text-muted-foreground">{q.hint}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Webhooks & endpoints */}
      <Card className="rounded-lg shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Webhooks &amp; public endpoints</CardTitle>
          <CardDescription>Absolute URLs for this workspace deployment — copy them into external tools.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <EndpointRow
            label="WhatsApp webhook (Meta callback)"
            url={webhookUrl}
            description="Set as the callback URL in your Meta WhatsApp app configuration (GET verify + POST events)."
            onCopy={() => copyText(webhookUrl, "Webhook URL")}
          />
          <EndpointRow
            label="Open-tracking pixel (automatic)"
            url={openPixel}
            description="Injected into every tracked email automatically — {messageId} is replaced per recipient. No manual setup needed."
            onCopy={() => copyText(openPixel, "Pixel URL")}
          />
          <div className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Public subscribe endpoint</p>
                <code className="block truncate font-mono text-xs text-muted-foreground">{subscribeUrl}</code>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => copyText(subscribeUrl, "Subscribe URL")}>
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> Copy
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">POST JSON to subscribe people from custom landing pages:</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed" aria-label="Example subscribe payload">
{subscribeExample}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EndpointRow({
  label, url, description, onCopy,
}: {
  label: string; url: string; description: string; onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <code className="block truncate font-mono text-xs text-muted-foreground">{url}</code>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onCopy}>
          <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> Copy
        </Button>
      </div>
    </div>
  );
}

// ─── Profile tab ─────────────────────────────────────────────

function ProfileTab() {
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const me = useQuery({ queryKey: ["auth-me"], queryFn: () => api.get<MeData>("/api/auth/me") });

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Session may already be gone — reload regardless.
    }
    window.location.reload();
  }

  if (me.isLoading) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

  const user = me.data?.user;
  const workspace = me.data?.workspace;

  return (
    <Card className="rounded-lg shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Profile &amp; workspace</CardTitle>
        <CardDescription>Account details are managed by your workspace administrator.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{user?.name ?? "—"}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <p className="truncate rounded-lg border bg-muted/40 px-3 py-2 text-sm">{user?.email ?? "—"}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Workspace</Label>
            <p className="truncate rounded-lg border bg-muted/40 px-3 py-2 text-sm">{workspace?.name ?? "—"}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{workspace?.timezone ?? "Asia/Karachi"}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Simulation mode</Label>
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              {workspace ? (
                workspace.simulationMode
                  ? <Badge variant="secondary">Active — safe testing</Badge>
                  : <Badge variant="outline">Off — live delivery</Badge>
              ) : "—"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Email channel</Label>
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm capitalize">
              {me.data?.channelMode ? `${me.data.channelMode} provider` : "—"}
            </p>
          </div>
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button variant="destructive" onClick={signOut} disabled={signingOut}>
            {signingOut ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="mr-1.5 h-4 w-4" aria-hidden />}
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
