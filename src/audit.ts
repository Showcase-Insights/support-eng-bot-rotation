import type { GroupMember } from "./groups";
import { getExistingAssignee, upsertRotationEvent } from "./calendar";
import {
  getSignUpForWeek,
  writeSignUp,
  updateSignUp,
  getPageIdForWeek,
} from "./notion";
import { buildRotationQueue } from "./rotation";

export interface WeekSlot {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string; // YYYY-MM-DD (Sunday)
}

export interface AuditResult {
  weekStart: string;
  weekEnd: string;
  assignee: string;
  source: "existing" | "notion" | "random";
  changed?:
    | "synced-to-calendar"
    | "synced-to-notion"
    | "calendar-updated"
    | "new-assignment"
    | "reassigned-removed-member";
}

/**
 * Generate every Mon→Sun week slot for the next 3 months starting today.
 */
export function getQuarterWeeks(): WeekSlot[] {
  const weeks: WeekSlot[] = [];

  // Always start from the *next* Monday, even if today is Monday,
  // so we never touch the current week of rotation.
  const start = new Date();
  const dayOfWeek = start.getDay();
  const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
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
 * Returns true when `assigneeName` (and/or `assigneeEmail`) corresponds to
 * a current member of the Google Group. Comparison is case-insensitive on
 * both name and email so we don't churn over capitalization differences.
 */
function isAssigneeInGroup(
  assigneeName: string,
  assigneeEmail: string | undefined,
  members: GroupMember[],
): boolean {
  const nameLc = assigneeName.toLowerCase();
  const emailLc = assigneeEmail?.toLowerCase();
  return members.some(
    (m) =>
      m.name.toLowerCase() === nameLc ||
      (!!emailLc && m.email.toLowerCase() === emailLc),
  );
}

export interface AuditOptions {
  /**
   * When true, the audit prints the planned schedule but performs no
   * Notion or Google Calendar writes. Useful for previewing what `npm
   * start` would do.
   */
  dryRun?: boolean;
}

/**
 * Audit all weeks in the next quarter.
 * - Skip weeks that already have a calendar event
 * - Use Notion sign-ups where present
 * - Fill remaining empty weeks with random selection
 */
export async function auditQuarter(
  members: GroupMember[],
  opts: AuditOptions = {},
): Promise<AuditResult[]> {
  const { dryRun = false } = opts;
  const weeks = getQuarterWeeks();
  const results: AuditResult[] = [];
  const tag = dryRun ? "[DRY-RUN] " : "";

  console.log(
    `\n${tag}Auditing ${weeks.length} weeks (${weeks[0].weekStart} → ${weeks[weeks.length - 1].weekEnd})\n`,
  );

  // Round-robin queue: round 1 gives everyone exactly one slot (shuffled
  // randomly), round 2 gives 5 randomly chosen members a second slot.
  // With 8 members × 13 weeks: 5 people get 2 weeks, 3 people get 1 week.
  // No one gets a second slot before everyone has had one first.
  const rotationQueue = buildRotationQueue(members, weeks.length);
  let queueIdx = 0;

  for (const { weekStart, weekEnd } of weeks) {
    process.stdout.write(`  Week of ${weekStart}: `);

    // 1. Check both sources
    const notionSignUp = await getSignUpForWeek(weekStart);
    const calendarAssignee = await getExistingAssignee(weekStart, weekEnd);

    // 2. If either source names an assignee no longer in the Google Group,
    // re-assign for this (future) week. Notion + Calendar are written
    // together so they stay in sync.
    const notionAssigneeMissing =
      notionSignUp &&
      !isAssigneeInGroup(notionSignUp.name, notionSignUp.email, members);
    const calendarAssigneeMissing =
      !!calendarAssignee &&
      !isAssigneeInGroup(calendarAssignee, undefined, members);

    if (notionAssigneeMissing || calendarAssigneeMissing) {
      const removedName = notionSignUp?.name ?? calendarAssignee ?? "unknown";
      const replacement = rotationQueue[queueIdx++];

      if (!dryRun) {
        const existingPage = await getPageIdForWeek(weekStart);
        if (existingPage) {
          await updateSignUp(
            existingPage.pageId,
            replacement.name,
            replacement.email,
            true,
          );
        } else {
          await writeSignUp(
            weekStart,
            replacement.name,
            replacement.email,
            true,
          );
        }
        await upsertRotationEvent(
          weekStart,
          weekEnd,
          replacement.name,
          replacement.email,
        );
      }
      console.log(
        `${tag}re-assigned (was ${removedName}, no longer in group) → ${replacement.name}`,
      );
      results.push({
        weekStart,
        weekEnd,
        assignee: replacement.name,
        source: "random",
        changed: "reassigned-removed-member",
      });
      continue;
    }

    if (notionSignUp && calendarAssignee) {
      // Both exist — check if they match, update calendar if they don't
      if (notionSignUp.name.toLowerCase() !== calendarAssignee.toLowerCase()) {
        const email =
          notionSignUp.email ??
          `${notionSignUp.name.toLowerCase().replace(/ /g, ".")}@unknown.com`;
        if (!dryRun)
          await upsertRotationEvent(
            weekStart,
            weekEnd,
            notionSignUp.name,
            email,
          );
        console.log(
          `${tag}synced calendar to match notion → ${notionSignUp.name} (was ${calendarAssignee})`,
        );
        results.push({
          weekStart,
          weekEnd,
          assignee: notionSignUp.name,
          source: "existing",
          changed: "calendar-updated",
        });
      } else {
        console.log(`${tag}already assigned → ${notionSignUp.name}`);
        results.push({
          weekStart,
          weekEnd,
          assignee: notionSignUp.name,
          source: "existing",
        });
      }
      continue;
    }

    if (notionSignUp) {
      // Notion has it, calendar doesn't — sync to calendar
      const email =
        notionSignUp.email ??
        `${notionSignUp.name.toLowerCase().replace(/ /g, ".")}@unknown.com`;
      if (!dryRun)
        await upsertRotationEvent(weekStart, weekEnd, notionSignUp.name, email);
      console.log(
        `${tag}notion sign-up → ${notionSignUp.name} (synced to calendar)`,
      );
      results.push({
        weekStart,
        weekEnd,
        assignee: notionSignUp.name,
        source: "notion",
        changed: "synced-to-calendar",
      });
      continue;
    }

    if (calendarAssignee) {
      // Calendar has it, Notion doesn't — sync to Notion
      const member = members.find(
        (m) => m.name.toLowerCase() === calendarAssignee.toLowerCase(),
      );
      const email =
        member?.email ??
        `${calendarAssignee.toLowerCase().replace(/ /g, ".")}@unknown.com`;
      if (!dryRun) await writeSignUp(weekStart, calendarAssignee, email, false);
      console.log(
        `${tag}calendar assigned → ${calendarAssignee} (synced to notion)`,
      );
      results.push({
        weekStart,
        weekEnd,
        assignee: calendarAssignee,
        source: "existing",
        changed: "synced-to-notion",
      });
      continue;
    }

    // Neither has it (this also covers the “Notion row exists but Name is
    // empty” case — getSignUpForWeek returns null and writeSignUp upserts
    // into the existing row).
    const picked = rotationQueue[queueIdx++];
    if (!dryRun) {
      await writeSignUp(weekStart, picked.name, picked.email, true);
      await upsertRotationEvent(weekStart, weekEnd, picked.name, picked.email);
    }
    console.log(`${tag}randomly assigned → ${picked.name}`);
    results.push({
      weekStart,
      weekEnd,
      assignee: picked.name,
      source: "random",
      changed: "new-assignment",
    });
  }

  return results;
}

/**
 * Print a summary table of all weeks and their assignees.
 */
export function printAuditSummary(results: AuditResult[]): void {
  const alreadyFilled = results.filter((r) => r.source === "existing").length;
  const fromNotion = results.filter((r) => r.source === "notion").length;
  const autoFilled = results.filter((r) => r.source === "random").length;

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
    const tag =
      r.source === "existing" ? "✓" : r.source === "notion" ? "N" : "R";
    console.log(`  [${tag}] ${r.weekStart}  ${r.assignee}`);
  }
  console.log(
    "\n  Legend: ✓ existing  N notion sign-up  R randomly assigned\n",
  );
}
