import type { GroupMember } from "./groups";

/**
 * Build a round-robin assignment queue for `slotsNeeded` slots.
 *
 * Each "round" is a full Fisher-Yates shuffle of the entire roster.
 * Round 1 fills the first `members.length` slots (everyone gets exactly one
 * slot before anyone gets a second). Round 2 fills the next batch, and so on.
 *
 * With 8 members and 13 weeks:
 *   • Round 1 (slots 1–8):  one slot each, random order
 *   • Round 2 (slots 9–13): 5 randomly chosen members get a second slot
 *
 * No member gets a second slot before every other member has had one first.
 */
export function buildRotationQueue(
  members: GroupMember[],
  slotsNeeded: number
): GroupMember[] {
  if (members.length === 0) {
    throw new Error("No members found in the Google Group.");
  }
  const queue: GroupMember[] = [];
  while (queue.length < slotsNeeded) {
    // Fisher-Yates shuffle of a fresh copy of the roster
    const round = [...members];
    for (let i = round.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [round[i], round[j]] = [round[j], round[i]];
    }
    // Prevent the same person appearing in consecutive weeks at a round
    // boundary (e.g. last slot of round 1 = first slot of round 2).
    // Swap the first element of this round with the next available
    // different member if a collision exists.
    if (queue.length > 0) {
      const lastEmail = queue[queue.length - 1].email;
      if (round[0].email === lastEmail && round.length > 1) {
        // Find the first element that differs and swap it to position 0
        const swapIdx = round.findIndex((m) => m.email !== lastEmail);
        if (swapIdx !== -1) {
          [round[0], round[swapIdx]] = [round[swapIdx], round[0]];
        }
      }
    }
    queue.push(...round.slice(0, Math.min(round.length, slotsNeeded - queue.length)));
  }
  return queue;
}
