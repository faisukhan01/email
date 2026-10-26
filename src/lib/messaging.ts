import { db } from "./db";

/** Renders {{token}} placeholders with contact fields. Unknown tokens stay verbatim. */
export function renderTemplate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, token: string) => {
    const value = vars[token] ?? vars[token.toLowerCase()];
    return value !== undefined ? value : match;
  });
}

export function contactVars(contact: {
  email: string; firstName: string; lastName: string; phone: string;
  company: string; jobTitle: string; country: string; city: string;
}): Record<string, string> {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return {
    email: contact.email,
    first_name: contact.firstName || contact.email.split("@")[0],
    last_name: contact.lastName,
    full_name: name || contact.email,
    phone: contact.phone,
    company: contact.company,
    job_title: contact.jobTitle,
    country: contact.country,
    city: contact.city,
  };
}

/** Strips HTML tags for a plain-text snippet (bounded, REA-style). */
export function htmlToSnippet(html: string, maxLen = 160): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

export interface SegmentRule {
  field: string;
  operator: string;
  value?: string;
  conjunction?: "AND" | "OR";
}

function ruleMatches(rule: SegmentRule, c: {
  email: string; firstName: string; lastName: string; company: string; country: string;
  city: string; jobTitle: string; status: string; lifecycleStage: string; leadScore: number;
  phone: string; tags: string;
}): boolean {
  const tags: string[] = JSON.parse(c.tags || "[]");
  const fieldValues: Record<string, string | number> = {
    email: c.email, firstName: c.firstName, lastName: c.lastName, company: c.company,
    country: c.country, city: c.city, jobTitle: c.jobTitle, status: c.status,
    lifecycleStage: c.lifecycleStage, leadScore: c.leadScore, phone: c.phone,
    tags: tags.join(","),
  };
  const actual = fieldValues[rule.field];
  const v = rule.value ?? "";
  switch (rule.operator) {
    case "equals": return String(actual).toLowerCase() === v.toLowerCase();
    case "not_equals": return String(actual).toLowerCase() !== v.toLowerCase();
    case "contains": return String(actual).toLowerCase().includes(v.toLowerCase());
    case "not_contains": return !String(actual).toLowerCase().includes(v.toLowerCase());
    case "starts_with": return String(actual).toLowerCase().startsWith(v.toLowerCase());
    case "gt": return Number(actual) > Number(v);
    case "lt": return Number(actual) < Number(v);
    case "in": return v.split(",").map((s) => s.trim().toLowerCase()).includes(String(actual).toLowerCase());
    case "not_empty": return String(actual).trim() !== "";
    case "is_empty": return String(actual).trim() === "";
    default: return false;
  }
}

export function matchesAllRules(
  contact: Parameters<typeof ruleMatches>[1],
  rules: SegmentRule[]
): boolean {
  if (rules.length === 0) return true;
  let acc = ruleMatches(rules[0], contact);
  for (let i = 1; i < rules.length; i++) {
    const m = ruleMatches(rules[i], contact);
    const conj = rules[i].conjunction ?? "AND";
    acc = conj === "OR" ? acc || m : acc && m;
  }
  return acc;
}

/** Appends a structured event to the workspace event stream. */
export async function recordEvent(params: {
  workspaceId: string;
  type: string;
  contactId?: string | null;
  campaignId?: string | null;
  messageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.event.create({
      data: {
        workspaceId: params.workspaceId,
        type: params.type,
        contactId: params.contactId ?? null,
        campaignId: params.campaignId ?? null,
        messageId: params.messageId ?? null,
        metadata: JSON.stringify(params.metadata ?? {}),
      },
    });
  } catch (e) {
    // Events are observational (REA): never mutate the result truth.
    console.error("[event] failed to record", params.type, e);
  }
}
