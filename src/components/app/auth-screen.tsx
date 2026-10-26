"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        await api.post("/api/auth/register", { name, email, password });
      } else {
        await api.post("/api/auth/login", { email, password });
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function demoLogin() {
    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/login", { email: "demo@flowengine.app", password: "demo12345" });
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Demo unavailable — create your account instead");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      {/* Brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-teal-950 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-teal-800/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-emerald-800/30 blur-3xl" />
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <span className="text-lg font-semibold">FlowEngine</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            Every channel. One command center.
          </h1>
          <p className="mt-4 text-teal-200">
            Email campaigns, WhatsApp broadcasts, drip automations and a sales pipeline —
            orchestrated by a lease-based automation engine with full send-level evidence.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm text-teal-100">
            <li>• Multi-channel campaigns with open & click tracking</li>
            <li>• Visual drip sequences that react to your contacts</li>
            <li>• WhatsApp Cloud API integration</li>
            <li>• Kanban sales CRM with revenue analytics</li>
          </ul>
        </div>
        <p className="relative z-10 text-xs text-teal-300/70">
          Powered by Next.js 16 · FastAPI engine · Turso (libSQL)
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-white">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <span className="text-lg font-semibold">FlowEngine</span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight">
            {mode === "login" ? "Welcome back" : "Create your workspace"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login"
              ? "Sign in to your automation command center."
              : "Free to start — no credit card required."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                  required
                  minLength={1}
                  autoComplete="name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                required
                minLength={mode === "register" ? 8 : 1}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {mode === "login" ? "Sign in" : "Create workspace"}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={demoLogin} disabled={busy}>
            Explore the demo workspace
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              className="font-medium text-teal-700 underline-offset-4 hover:underline dark:text-teal-400"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
