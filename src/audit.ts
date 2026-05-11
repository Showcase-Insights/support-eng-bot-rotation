import type { GroupMember } from "./groups";
import { getExistingAssignee, upsertRotationEvent } from "./calendar";
import { getSignUpForWeek, writeSignUp, getRecentlyAssigned } from "./notion";
import { pickMember } from "./rotation";

export interface WeekSlot {
  weekStart: string;  // YYYY-MM-DD (Monday)
  weekEnd: string;    // YYYY-MM-DD (Sunday)
}

export interface AuditResult {
  weekStart: string;
  weekEnd: string;
  assignee: string;
  source: "existing" | "notion" | "random";
  changed?: "synced-to-calendar" | "synced-to-notion" | "calendar-updated" | "new-assignment";
}

/**
 * Generate every Mon→Sun week slot for the next 3 months starting today.
 */
export function getQuarterWeeks(): WeekSlot[] {
  const weeks: WeekSlot[] = [];

  // Start from the next Monday on or after today
  const start = new Date();
  const dayOfWeek = start.getDay();
  const daysUntilMonday = dayOfWeek === 1 ? 0 : (8 - dayOfWeek) % 7;
  start.setDate(start.getDate() + daysUntilMonday);
  start.setHours(0, 0, 0, 0);

  // End date: 3 months from today
  const end = new Date();
  end.setMonth(end.getMonth() + 3);

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const cursor = new Date(start);

  while (cursor < end) {
    const monday = new Date(cursor);
    const sunday = new Date(cursor);
    sunday.setDate(monday.getDate() + 6);
    weeks.push({ weekStart: fmt(monday), weekEnd: fmt(sunday) });
    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks;
}

/**
 * Audit all weeks in the next quarter.
 * - Skip weeks that already have a calendar event
 * - Use Notion sign-ups where present
 * - Fill remaining empty weeks with random selection
 */
export async function auditQuarter(members: GroupMember[]): Promise<AuditResult[]> {
  const weeks = getQuarterWeeks();
  const results: AuditResult[] = [];

  console.log(`\nAuditing ${weeks.length} weeks (${weeks[0].weekStart} → ${weeks[weeks.length - 1].weekEnd})\n`);

  for (const { weekStart, weekEnd } of weeks) {
    process.stdout.write(`  Week of ${weekStart}: `);

    // 1. Check both sources
    const notionSignUp = await getSignUpForWeek(weekStart);
    const calendarAssignee = await getExistingAssignee(weekStart, weekEnd);

    if (notionSignUp && calendarAssignee) {
      // Both exist — check if they match, update calendar if they don't
      if (notionSignUp.name.toLowerCase() !== calendarAssignee.toLowerCase()) {
        const email = notionSignUp.email ?? `${notionSignUp.name.toLowerCase().replace(/ /g, ".")}@unknown.com`;
        await upsertRotationEvent(weekStart, weekEnd, notionSignUp.name, email);
        console.log(`synced calendar to match notion → ${notionSignUp.name} (was ${calendarAssignee})`);
        results.push({ weekStart, weekEnd, assignee: notionSignUp.name, source: "existing", changed: "calendar-updated" });
      } else {
        console.log(`already assigned → ${notionSignUp.name}`);
        results.push({ weekStart, weekEnd, assignee: notionSignUp.name, source: "existing" });
      }
      continue;
    }

    if (notionSignUp) {
      // Notion has it, calendar doesn't — sync to calendar
      const email = notionSignUp.email ?? `${notionSignUp.name.toLowerCase().replace(/ /g, ".")}@unknown.com`;
      await upsertRotationEvent(weekStart, weekEnd, notionSignUp.name, email);
      console.log(`notion sign-up → ${notionSignUp.name} (synced to calendar)`);
      results.push({ weekStart, weekEnd, assignee: notionSignUp.name, source: "notion", changed: "synced-to-calendar" });
      continue;
    }

    if (calendarAssignee) {
      // Calendar has it, Notion doesn't — sync to Notion
      const member = members.find((m) => m.name.toLowerCase() === calendarAssignee.toLowerCase());
      const email = member?.email ?? `${calendarAssignee.toLowerCase().replace(/ /g, ".")}@unknown.com`;
      await writeSignUp(weekStart, calendarAssignee, email, false);
      console.log(`calendar assigned → ${calendarAssignee} (synced to notion)`);
      results.push({ weekStart, weekEnd, assignee: calendarAssignee, source: "existing", changed: "synced-to-notion" });
      continue;
    }

    // Neither has it — randomly assign, ensuring everyone goes once per cycle
    const recentlyAssigned = await getRecentlyAssigned(members.length);
    const picked = pickMember(members, recentlyAssigned);
    await writeSignUp(weekStart, picked.name, picked.email, true);
    await upsertRotationEvent(weekStart, weekEnd, picked.name, picked.email);
    console.log(`randomly assigned → ${picked.name}`);
    results.push({ weekStart, weekEnd, assignee: picked.name, source: "random", changed: "new-assignment" });
  }

  return results;
}

/**
 * Print a summary table of all weeks and their assignees.
 */
export function printAuditSummary(results: AuditResult[]): void {
  const alreadyFilled = results.filter((r) => r.source === "existing").length;
  const fromNotion    = results.filter((r) => r.source === "notion").length;
  const autoFilled    = results.filter((r) => r.source === "random").length;

  console.log("\n─────────────────────────────────────────────");
  console.log("Quarterly audit summary");
  console.log("─────────────────────────────────────────────");
  console.log(`Total weeks audited : ${results.length}`);
  console.log(`Already filled      : ${alreadyFilled}`);
  console.log(`From Notion sign-up : ${fromNotion}`);
  console.log(`Auto-filled (random): ${autoFilled}`);
  console.log("─────────────────────────────────────────────\n");

  console.log("Full schedule:");
  for (const r of results) {
    const tag = r.source === "existing" ? "✓" : r.source === "notion" ? "N" : "R";
    console.log(`  [${tag}] ${r.weekStart}  ${r.assignee}`);
  }
  console.log("\n  Legend: ✓ existing  N notion sign-up  R randomly assigned\n");
}
