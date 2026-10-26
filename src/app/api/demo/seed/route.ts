import { db } from "@/lib/db";
import { handleRoute, ok, withAuth } from "@/lib/api-helpers";
import { recordEvent } from "@/lib/messaging";

export const dynamic = "force-dynamic";

const FIRST = ["Ayesha", "Omar", "Fatima", "Bilal", "Zara", "Hassan", "Mariam", "Ali", "Sana", "Usman", "Hira", "Ahmed", "Noor", "Imran", "Amina", "Kamran", "Sadia", "Tariq", "Rabia", "Faisal"];
const LAST = ["Khan", "Ahmed", "Malik", "Sheikh", "Raza", "Iqbal", "Farooq", "Siddiqui", "Butt", "Chaudhry", "Awan", "Qureshi", "Baig", "Hussain", "Mirza"];
const COMPANIES = ["TechVerse", "DataBridge", "CloudSprint", "NovaLabs", "PixelForge", "SwiftCart", "MediSync", "FinEdge", "AgriGrow", "EduSpark"];
const COUNTRIES = ["Pakistan", "UAE", "Saudi Arabia", "United Kingdom", "United States", "Canada", "Singapore"];
const CITIES: Record<string, string> = {
  Pakistan: "Karachi", UAE: "Dubai", "Saudi Arabia": "Riyadh", "United Kingdom": "London",
  "United States": "New York", Canada: "Toronto", Singapore: "Singapore",
};

function pick<T>(arr: T[], i?: number): T {
  return i !== undefined ? arr[i % arr.length] : arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 3600 * 1000);
}

/** Rich demo dataset so a fresh workspace looks alive immediately. */
export async function POST() {
  return handleRoute(async () =>
    withAuth(async (ctx) => {
      const existing = await db.contact.count({ where: { workspaceId: ctx.workspaceId } });
      if (existing > 20) {
        return ok({ skipped: true, reason: `Workspace already has ${existing} contacts` });
      }

      // ── Lists ──
      const [listNewsletter, listLeads, listVip] = await Promise.all([
        db.list.create({ data: { workspaceId: ctx.workspaceId, name: "Newsletter Subscribers", description: "Monthly product newsletter audience" } }),
        db.list.create({ data: { workspaceId: ctx.workspaceId, name: "Inbound Leads", description: "Leads captured from website forms" } }),
        db.list.create({ data: { workspaceId: ctx.workspaceId, name: "VIP Customers", description: "High-value accounts" } }),
      ]);

      // ── Contacts ──
      const contactData = Array.from({ length: 48 }, (_, i) => {
        const first = pick(FIRST, i);
        const last = pick(LAST, i * 3 + 1);
        const country = pick(COUNTRIES, i * 7 + 2);
        const company = pick(COMPANIES, i * 5 + 3);
        const statusRoll = i % 11 === 0 ? "unsubscribed" : i % 17 === 0 ? "bounced" : "subscribed";
        const stage = pick(["subscriber", "lead", "mql", "sql", "customer"], i);
        const tags = [
          ...(i % 3 === 0 ? ["trial-user"] : []),
          ...(i % 4 === 0 ? ["webinar-attendee"] : []),
          ...(i % 5 === 0 ? ["high-intent"] : []),
        ];
        return {
          workspaceId: ctx.workspaceId,
          email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
          firstName: first, lastName: last,
          phone: `+92 3${(i % 10) * 11 + 10} ${1000000 + i * 137}`,
          company, jobTitle: pick(["CEO", "CTO", "Marketing Manager", "Sales Director", "Founder", "Product Manager"], i),
          country, city: CITIES[country] ?? "",
          status: statusRoll,
          lifecycleStage: stage,
          leadScore: Math.min(95, 15 + ((i * 13) % 80)),
          tags: JSON.stringify(tags),
          source: pick(["import", "form", "api", "manual"], i),
          lastActivityAt: daysAgo(i % 14),
          createdAt: daysAgo(14 - (i % 14)),
        };
      });
      await db.contact.createMany({ data: contactData });
      const contacts = await db.contact.findMany({
        where: { workspaceId: ctx.workspaceId },
        select: { id: true, email: true, status: true, lifecycleStage: true },
      });

      // ── List memberships ──
      const memberships: { listId: string; contactId: string }[] = [];
      contacts.forEach((c, i) => {
        if (i % 2 === 0) memberships.push({ listId: listNewsletter.id, contactId: c.id });
        if (i % 3 === 0) memberships.push({ listId: listLeads.id, contactId: c.id });
        if (c.lifecycleStage === "customer" || i % 9 === 0) memberships.push({ listId: listVip.id, contactId: c.id });
      });
      await db.listMembership.createMany({ data: memberships });

      // ── Segment ──
      await db.segment.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: "Hot Leads (score 60+)",
          description: "Engaged leads ready for sales outreach",
          rules: JSON.stringify([
            { field: "leadScore", operator: "gt", value: "60", conjunction: "AND" },
            { field: "status", operator: "equals", value: "subscribed", conjunction: "AND" },
          ]),
        },
      });

      // ── Templates ──
      await db.template.createMany({
        data: [
          {
            workspaceId: ctx.workspaceId,
            name: "Product Launch Announcement",
            channel: "email",
            category: "marketing",
            subject: "🚀 {{first_name}}, something big just launched",
            bodyHtml: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h1 style="color:#0f172a">Hi {{first_name}}, it's here!</h1>
  <p style="color:#334155;font-size:16px;line-height:1.6">We just shipped our biggest release yet — multi-channel automations that combine email, WhatsApp and sales in one flow.</p>
  <p style="margin:32px 0"><a href="https://example.com/launch" style="background:#0d9488;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">See what's new</a></p>
  <p style="color:#64748b;font-size:13px">Best, <br/>The {{company}} Team</p>
</div>`,
            bodyText: "Hi {{first_name}}, we just launched multi-channel automations. Check it out: https://example.com/launch",
            variables: JSON.stringify(["first_name", "company"]),
          },
          {
            workspaceId: ctx.workspaceId,
            name: "Welcome Series — Day 1",
            channel: "email",
            category: "onboarding",
            subject: "Welcome aboard, {{first_name}}!",
            bodyHtml: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#0f172a">Welcome, {{first_name}} 👋</h2>
  <p style="color:#334155">Thanks for joining. Here are 3 quick things to get started:</p>
  <ol style="color:#334155"><li>Import your contacts</li><li>Create your first campaign</li><li>Set up a welcome automation</li></ol>
</div>`,
            bodyText: "Welcome {{first_name}}! Import contacts, create a campaign, and set up an automation to get started.",
            variables: JSON.stringify(["first_name"]),
          },
          {
            workspaceId: ctx.workspaceId,
            name: "WhatsApp — Flash Sale",
            channel: "whatsapp",
            category: "promotional",
            bodyText: "Hi {{first_name}}! ⚡ Flash sale: 40% off for the next 24 hours. Reply YES to claim your spot.",
            variables: JSON.stringify(["first_name"]),
          },
        ],
      });

      // ── Campaigns with realistic message distributions ──
      const campaignDefs = [
        { name: "October Newsletter", channel: "email", subject: "Your monthly round-up is here", sent: 12, openRate: 0.62, clickRate: 0.35, status: "sent", sentAt: daysAgo(9) },
        { name: "Product Launch Blast", channel: "email", subject: "🚀 The wait is over", sent: 8, openRate: 0.71, clickRate: 0.44, status: "sent", sentAt: daysAgo(5) },
        { name: "VIP Exclusive Offer", channel: "email", subject: "An offer just for our VIPs", sent: 6, openRate: 0.83, clickRate: 0.5, status: "sent", sentAt: daysAgo(2) },
        { name: "WhatsApp Flash Sale", channel: "whatsapp", subject: "", sent: 5, openRate: 0.9, clickRate: 0.6, status: "sent", sentAt: daysAgo(1) },
        { name: "Re-engagement Winback", channel: "email", subject: "We miss you — here's 20% off", sent: 0, openRate: 0, clickRate: 0, status: "draft", sentAt: null },
      ];

      for (const def of campaignDefs) {
        const campaign = await db.campaign.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: def.name,
            channel: def.channel,
            status: def.status,
            subject: def.subject,
            preheader: "Sent via AI Automation Platform",
            fromName: "Growth Team",
            fromEmail: "growth@example.com",
            bodyHtml: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px"><h2>${def.subject || def.name}</h2><p style="color:#334155;line-height:1.6">Hi {{first_name}}, this is a demo campaign rendered by the platform. Every send carries a full evidence envelope — provider, status and timestamps.</p><p><a href="https://example.com" style="color:#0d9488;font-weight:600">Learn more →</a></p></div>`,
            audienceType: "list",
            listId: def.channel === "whatsapp" ? listVip.id : listNewsletter.id,
            startedAt: def.sentAt,
            completedAt: def.sentAt,
            trackOpens: true,
            trackClicks: true,
          },
        });
        if (def.sent === 0) continue;

        const recipients = contacts.filter((c) => c.status === "subscribed").slice(0, def.sent);
        for (let i = 0; i < recipients.length; i++) {
          const c = recipients[i];
          const roll = (i * 7 + def.sent) % 100;
          const isBounced = roll < 4;
          const opened = !isBounced && roll < def.openRate * 100;
          const clicked = opened && roll % 100 < def.clickRate * 100;
          const sentAt = def.sentAt ?? daysAgo(3);
          await db.message.create({
            data: {
              workspaceId: ctx.workspaceId,
              campaignId: campaign.id,
              contactId: c.id,
              channel: def.channel,
              toAddress: def.channel === "email" ? c.email : `+92300${1000000 + i}`,
              subject: def.subject,
              bodySnippet: `${def.name} — personalized for the recipient`,
              status: isBounced ? "bounced" : clicked ? "clicked" : opened ? "opened" : "sent",
              provider: def.channel === "email" ? "simulator" : "simulator",
              providerMsgId: `sim_${Math.random().toString(36).slice(2, 12)}`,
              evidence: JSON.stringify({
                provider: "simulator",
                confidence: "observed",
                simulated: true,
                limitations: ["Demo environment — simulated delivery"],
                recordedAt: sentAt.toISOString(),
              }),
              sentAt,
              openedAt: opened ? new Date(sentAt.getTime() + 3600_000 * (1 + i % 5)) : null,
              clickedAt: clicked ? new Date(sentAt.getTime() + 5400_000) : null,
              bouncedAt: isBounced ? sentAt : null,
              createdAt: sentAt,
            },
          });
        }
        await recordEvent({
          workspaceId: ctx.workspaceId,
          type: "campaign.sent",
          campaignId: campaign.id,
          metadata: { recipients: recipients.length },
        });
      }

      // ── Sequence: onboarding automation ──
      const seq = await db.sequence.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: "Welcome & Onboarding Flow",
          description: "Greets new signups, nurtures with value content, then invites to a call",
          status: "active",
          triggerType: "contact_created",
          triggerConfig: JSON.stringify({}),
          enrollExisting: false,
        },
      });
      const steps = [
        { type: "send_email", name: "Welcome email", config: { subject: "Welcome aboard, {{first_name}}!", bodyHtml: "<p>Hi {{first_name}}, welcome to the platform 🎉</p>", delayAmount: 0, delayUnit: "days" } },
        { type: "wait", name: "Wait 1 day", config: { delayAmount: 1, delayUnit: "days" } },
        { type: "send_email", name: "Getting-started tips", config: { subject: "3 tips to get started", bodyHtml: "<p>Hi {{first_name}}, here are 3 tips to hit the ground running.</p>", delayAmount: 0, delayUnit: "days" } },
        { type: "wait", name: "Wait 2 days", config: { delayAmount: 2, delayUnit: "days" } },
        { type: "add_tag", name: "Tag as nurtured", config: { tag: "nurtured" }, delayAmount: 0, delayUnit: "days" },
        { type: "send_email", name: "Book a call", config: { subject: "Ready for a quick call, {{first_name}}?", bodyHtml: "<p>Hi {{first_name}}, grab 15 minutes with our team.</p>", delayAmount: 0, delayUnit: "days" } },
      ];
      const createdSteps = [] as { id: string }[];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        createdSteps.push(
          await db.sequenceStep.create({
            data: { sequenceId: seq.id, position: i + 1, type: s.type, name: s.name, config: JSON.stringify(s.config) },
            select: { id: true },
          })
        );
      }

      // Enroll 6 contacts, mark various states
      const enrollTargets = contacts.filter((c) => c.status === "subscribed").slice(0, 6);
      for (let i = 0; i < enrollTargets.length; i++) {
        const completed = i < 2;
        await db.enrollment.create({
          data: {
            workspaceId: ctx.workspaceId,
            sequenceId: seq.id,
            contactId: enrollTargets[i].id,
            status: completed ? "completed" : "active",
            currentPosition: completed ? 6 : 1 + (i % 4),
            enteredAt: daysAgo(6 - i),
            completedAt: completed ? daysAgo(1) : null,
          },
        });
        await recordEvent({
          workspaceId: ctx.workspaceId,
          type: "sequence.enrolled",
          contactId: enrollTargets[i].id,
          metadata: { sequenceId: seq.id },
        });
      }

      // Second sequence (WhatsApp)
      const seq2 = await db.sequence.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: "Lead Reactivation (WhatsApp)",
          description: "Pings dormant leads on WhatsApp with an exclusive offer",
          status: "paused",
          triggerType: "tagged",
          triggerConfig: JSON.stringify({ tag: "high-intent" }),
        },
      });
      await db.sequenceStep.create({
        data: { sequenceId: seq2.id, position: 1, type: "send_whatsapp", name: "WhatsApp check-in", config: JSON.stringify({ bodyText: "Hi {{first_name}}, quick question — still interested in {{company}} growth? Reply YES for details." }) },
      });

      // ── Deals ──
      const dealDefs = [
        { title: "TechVerse — Annual Plan", value: 12000, stage: "negotiation", probability: 75 },
        { title: "DataBridge — Team License", value: 8400, stage: "proposal", probability: 55 },
        { title: "CloudSprint — Starter", value: 2400, stage: "new", probability: 15 },
        { title: "NovaLabs — Enterprise Pilot", value: 25000, stage: "qualified", probability: 35 },
        { title: "PixelForge — Automation Suite", value: 6800, stage: "won", probability: 100 },
        { title: "SwiftCart — Growth Bundle", value: 15200, stage: "won", probability: 100 },
        { title: "MediSync — CRM Sync", value: 4200, stage: "lost", probability: 0 },
        { title: "FinEdge — Compliance Pack", value: 9800, stage: "proposal", probability: 60 },
      ];
      for (let i = 0; i < dealDefs.length; i++) {
        const d = dealDefs[i];
        const contact = contacts[(i * 5 + 2) % contacts.length];
        await db.deal.create({
          data: {
            workspaceId: ctx.workspaceId,
            contactId: contact.id,
            title: d.title,
            value: d.value,
            stage: d.stage,
            probability: d.probability,
            source: pick(["inbound", "outbound", "referral"], i),
            expectedCloseAt: daysAgo(-14 - i * 3),
            closedAt: ["won", "lost"].includes(d.stage) ? daysAgo(i) : null,
            position: i,
            createdAt: daysAgo(20 - i),
          },
        });
      }

      // ── Activities ──
      await db.activity.createMany({
        data: [
          { workspaceId: ctx.workspaceId, type: "system", title: "Workspace created", content: "Welcome to your automation command center!", createdAt: daysAgo(14) },
          { workspaceId: ctx.workspaceId, type: "note", title: "Quarterly plan drafted", content: "Q4 focus: multi-channel reactivation + upsell sequences.", createdAt: daysAgo(10) },
        ],
      });

      await recordEvent({
        workspaceId: ctx.workspaceId,
        type: "demo.seeded",
        metadata: { contacts: contactData.length, deals: dealDefs.length, sequences: 2 },
      });

      return ok({ seeded: true, contacts: contactData.length, lists: 3, campaigns: campaignDefs.length, sequences: 2, deals: dealDefs.length });
    })
  );
}
