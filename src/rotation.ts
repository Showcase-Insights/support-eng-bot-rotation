import type { GroupMember } from "./groups";

/**
 * Pick a random member, preferring those not recently assigned.
 * Falls back to the full roster if everyone has been recently assigned.
 */
export function pickMember(
  members: GroupMember[],
  recentlyAssigned: string[]
): GroupMember {
  if (members.length === 0) {
    throw new Error("No members found in the Google Group.");
  }

  const recentSet = new Set(recentlyAssigned.map((n) => n.toLowerCase()));

  // Prefer members who haven't been on support recently
  const eligible = members.filter(
    (m) => !recentSet.has(m.name.toLowerCase()) && !recentSet.has(m.email.toLowerCase())
  );

  const pool = eligible.length > 0 ? eligible : members;
  return pool[Math.floor(Math.random() * pool.length)];
}
