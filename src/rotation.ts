import type { GroupMember } from "./groups";
import type { YearToDateAssignment } from "./notion";

/** Fisher-Yates shuffle (in place, returns same array). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Normalize name for case-insensitive comparison */
function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * State for fair rotation picker across multiple picks.
 */
export class FairRotationPicker {
  private memberByName = new Map<string, GroupMember>();
  private assignedThisYear = new Map<string, string[]>(); // name -> [dates]
  private allWeeks: Array<{ weekStart: string; assignee?: string }> = [];

  constructor(
    private members: GroupMember[],
    ytdAssignments: YearToDateAssignment[],
    weeks: Array<{ weekStart: string; assignee?: string }>,
  ) {
    if (members.length === 0) {
      throw new Error("No members found in the Google Group.");
    }

    // Build member lookup
    for (const m of members) {
      this.memberByName.set(normalizeName(m.name), m);
      this.memberByName.set(normalizeName(m.email), m);
    }

    // Track who has been assigned this year and when
    for (const { name, weekStart } of ytdAssignments) {
      const normalized = normalizeName(name);
      const member = this.memberByName.get(normalized);
      if (!member) continue;
      const key = normalizeName(member.name);
      if (!this.assignedThisYear.has(key)) {
        this.assignedThisYear.set(key, []);
      }
      this.assignedThisYear.get(key)!.push(weekStart);
    }

    this.allWeeks = weeks;
  }

  /**
   * Pick a member for the given week index using fair rotation rules:
   * 1. Prioritize members who haven't been assigned this year
   * 2. If everyone has been assigned, pick from those with earliest assignments
   * 3. Avoid assigning someone who was assigned 2 weeks before or after
   */
  pickForWeek(weekIndex: number): GroupMember {
    // Get eligible members (excluding those within 2 weeks)
    const excludedNames = new Set<string>();

    // Check 2 weeks before
    for (let i = Math.max(0, weekIndex - 2); i < weekIndex; i++) {
      if (this.allWeeks[i]?.assignee) {
        excludedNames.add(normalizeName(this.allWeeks[i].assignee!));
      }
    }

    // Check 2 weeks after
    for (
      let i = weekIndex + 1;
      i <= Math.min(this.allWeeks.length - 1, weekIndex + 2);
      i++
    ) {
      if (this.allWeeks[i]?.assignee) {
        excludedNames.add(normalizeName(this.allWeeks[i].assignee!));
      }
    }

    let eligible = this.members.filter(
      (m) => !excludedNames.has(normalizeName(m.name)),
    );

    if (eligible.length === 0) {
      // Fallback if exclusion is too strict
      eligible = this.members;
    }

    // Separate into: not assigned this year vs assigned this year
    const notAssignedThisYear: GroupMember[] = [];
    const assignedWithInfo: Array<{
      member: GroupMember;
      count: number;
      mostRecentDate: string;
    }> = [];

    for (const member of eligible) {
      const key = normalizeName(member.name);
      const dates = this.assignedThisYear.get(key);

      if (!dates || dates.length === 0) {
        notAssignedThisYear.push(member);
      } else {
        // Sort dates to find most recent assignment
        const sorted = [...dates].sort();
        assignedWithInfo.push({
          member,
          count: dates.length,
          mostRecentDate: sorted[sorted.length - 1],
        });
      }
    }

    let picked: GroupMember;

    if (notAssignedThisYear.length > 0) {
      // Rule 1: Pick randomly from those who haven't gone this year
      const shuffled = shuffle([...notAssignedThisYear]);
      picked = shuffled[0];
    } else {
      // Rule 2: Everyone has gone, pick from those with fewest assignments,
      // then among ties pick from those with oldest most-recent-assignment
      assignedWithInfo.sort((a, b) => {
        // First, sort by count (ascending - fewer assignments first)
        if (a.count !== b.count) return a.count - b.count;
        // If tied on count, sort by most recent date (ascending - oldest first)
        return a.mostRecentDate.localeCompare(b.mostRecentDate);
      });
      // Get all members with the lowest count and oldest recent date
      const best = assignedWithInfo[0];
      const bestMembers = assignedWithInfo
        .filter(
          (a) =>
            a.count === best.count &&
            a.mostRecentDate === best.mostRecentDate,
        )
        .map((a) => a.member);
      const shuffled = shuffle(bestMembers);
      picked = shuffled[0];
    }

    // Update state: record this assignment
    const key = normalizeName(picked.name);
    if (!this.assignedThisYear.has(key)) {
      this.assignedThisYear.set(key, []);
    }
    this.assignedThisYear.get(key)!.push(this.allWeeks[weekIndex].weekStart);
    this.allWeeks[weekIndex] = {
      ...this.allWeeks[weekIndex],
      assignee: picked.name,
    };

    return picked;
  }
}
