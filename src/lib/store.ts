"use client";

import { create } from "zustand";

export type ViewId =
  | "dashboard"
  | "contacts"
  | "lists"
  | "campaigns"
  | "sequences"
  | "whatsapp"
  | "pipeline"
  | "templates"
  | "analytics"
  | "settings";

export type ContactDrawerTarget = { contactId: string } | null;

interface AppState {
  activeView: ViewId;
  setView: (view: ViewId) => void;
  contactDrawer: ContactDrawerTarget;
  openContact: (contactId: string) => void;
  closeContact: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: "dashboard",
  setView: (view) => set({ activeView: view }),
  contactDrawer: null,
  openContact: (contactId) => set({ contactDrawer: { contactId } }),
  closeContact: () => set({ contactDrawer: null }),
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
