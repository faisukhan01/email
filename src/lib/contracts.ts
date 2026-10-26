import { z } from "zod";

// ─── Shared primitives ───────────────────────────────────────
export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const idSchema = z.string().min(1).max(64);
export const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(30).optional();

export const CHANNELS = ["email", "whatsapp"] as const;
export const CONTACT_STATUSES = ["subscribed", "unsubscribed", "bounced", "complained"] as const;
export const LIFECYCLE_STAGES = [
  "subscriber", "lead", "mql", "sql", "customer", "evangelist",
] as const;
export const DEAL_STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export const SEQUENCE_STEP_TYPES = [
  "send_email", "send_whatsapp", "wait", "update_field", "add_tag", "remove_tag",
] as const;
export const TRIGGER_TYPES = ["contact_created", "added_to_list", "tagged", "manual"] as const;
export const CAMPAIGN_STATUSES = [
  "draft", "scheduled", "sending", "sent", "paused", "failed",
] as const;

// ─── Auth ────────────────────────────────────────────────────
export const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

// ─── Contacts ────────────────────────────────────────────────
export const contactCreateSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().max(80).optional().default(""),
  lastName: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(32).optional().default(""),
  company: z.string().trim().max(120).optional().default(""),
  jobTitle: z.string().trim().max(120).optional().default(""),
  country: z.string().trim().max(80).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  status: z.enum(CONTACT_STATUSES).optional().default("subscribed"),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional().default("subscriber"),
  tags: tagsSchema,
  source: z.string().trim().max(40).optional().default("manual"),
  notes: z.string().max(4000).optional().default(""),
  listIds: z.array(idSchema).optional(),
});

export const contactUpdateSchema = contactCreateSchema.partial().omit({ listIds: true }).extend({
  leadScore: z.number().int().min(0).max(100).optional(),
  customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const contactImportSchema = z.object({
  contacts: z.array(z.record(z.string(), z.string())).min(1).max(2000),
  listId: idSchema.optional(),
});

export const bulkActionSchema = z.object({
  action: z.enum(["add_tag", "remove_tag", "add_to_list", "delete", "set_status"]),
  contactIds: z.array(idSchema).min(1).max(500),
  value: z.string().trim().max(120).optional(),
});

// ─── Lists & Segments ────────────────────────────────────────
export const listUpsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().default(""),
});

export const segmentRuleSchema = z.object({
  field: z.enum(["email", "firstName", "lastName", "company", "country", "city", "jobTitle",
    "status", "lifecycleStage", "tags", "leadScore", "phone"]),
  operator: z.enum(["equals", "not_equals", "contains", "not_contains", "starts_with",
    "gt", "lt", "in", "not_empty", "is_empty"]),
  value: z.string().max(200).optional().default(""),
  conjunction: z.enum(["AND", "OR"]).optional().default("AND"),
});

export const segmentUpsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().default(""),
  rules: z.array(segmentRuleSchema).max(20),
});

// ─── Templates ───────────────────────────────────────────────
export const templateUpsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel: z.enum(CHANNELS).default("email"),
  category: z.string().trim().max(40).optional().default("general"),
  subject: z.string().max(200).optional().default(""),
  bodyHtml: z.string().max(200_000).optional().default(""),
  bodyText: z.string().max(20_000).optional().default(""),
  variables: z.array(z.string().max(40)).max(30).optional().default([]),
});

// ─── Campaigns ───────────────────────────────────────────────
export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(140),
  channel: z.enum(CHANNELS).default("email"),
  subject: z.string().max(200).optional().default(""),
  preheader: z.string().max(200).optional().default(""),
  fromName: z.string().max(80).optional().default(""),
  fromEmail: z.string().max(120).optional().default(""),
  replyTo: z.string().max(120).optional().default(""),
  bodyHtml: z.string().max(200_000).optional().default(""),
  bodyText: z.string().max(20_000).optional().default(""),
  audienceType: z.enum(["all", "list", "segment"]).default("list"),
  listId: idSchema.optional(),
  segmentRules: z.array(segmentRuleSchema).max(20).optional(),
  trackOpens: z.boolean().optional().default(true),
  trackClicks: z.boolean().optional().default(true),
});

export const campaignUpdateSchema = campaignCreateSchema.partial();

export const campaignSendSchema = z.object({
  mode: z.enum(["now", "schedule"]),
  scheduledAt: z.string().datetime().optional(),
});

// ─── Sequences ───────────────────────────────────────────────
export const sequenceUpsertSchema = z.object({
  name: z.string().trim().min(1).max(140),
  description: z.string().max(500).optional().default(""),
  triggerType: z.enum(TRIGGER_TYPES).optional().default("contact_created"),
  triggerConfig: z.record(z.string(), z.unknown()).optional().default({}),
});

export const sequenceStepSchema = z.object({
  id: idSchema.optional(),
  type: z.enum(SEQUENCE_STEP_TYPES),
  name: z.string().max(140).optional().default(""),
  delayAmount: z.number().int().min(0).max(365).optional().default(0),
  delayUnit: z.enum(["minutes", "hours", "days"]).optional().default("days"),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

export const sequenceStepsReplaceSchema = z.object({
  steps: z.array(sequenceStepSchema).max(30),
});

export const enrollSchema = z.object({
  contactIds: z.array(idSchema).min(1).max(500),
});

// ─── Deals ───────────────────────────────────────────────────
export const dealCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  contactId: idSchema.optional(),
  value: z.number().min(0).max(1e12).optional().default(0),
  stage: z.enum(DEAL_STAGES).optional().default("new"),
  probability: z.number().int().min(0).max(100).optional().default(10),
  source: z.string().max(40).optional().default("manual"),
  expectedCloseAt: z.string().datetime().optional(),
  notes: z.string().max(4000).optional().default(""),
});

export const dealUpdateSchema = dealCreateSchema.partial().extend({
  position: z.number().int().min(0).max(10000).optional(),
});

// ─── Activities ──────────────────────────────────────────────
export const activityCreateSchema = z.object({
  contactId: idSchema.optional(),
  dealId: idSchema.optional(),
  type: z.enum(["note", "email", "call", "meeting", "whatsapp"]).default("note"),
  title: z.string().trim().min(1).max(160),
  content: z.string().max(4000).optional().default(""),
});

// ─── Settings ────────────────────────────────────────────────
export const integrationSchema = z.object({
  emailProvider: z.enum(["simulator", "smtp", "resend"]).optional(),
  smtpHost: z.string().max(200).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(200).optional(),
  smtpPass: z.string().max(200).optional(),
  fromName: z.string().max(80).optional(),
  fromEmail: z.string().max(120).optional(),
  replyTo: z.string().max(120).optional(),
  resendApiKey: z.string().max(200).optional(),
  waPhoneNumberId: z.string().max(80).optional(),
  waAccessToken: z.string().max(400).optional(),
  waVerifyToken: z.string().max(120).optional(),
  simulationMode: z.boolean().optional(),
});

export const testSendSchema = z.object({
  channel: z.enum(CHANNELS),
  to: z.string().trim().min(3).max(320),
});

// ─── Public form ─────────────────────────────────────────────
export const publicSubscribeSchema = z.object({
  workspaceId: idSchema,
  email: emailSchema,
  firstName: z.string().max(80).optional().default(""),
  lastName: z.string().max(80).optional().default(""),
  listId: idSchema.optional(),
});
