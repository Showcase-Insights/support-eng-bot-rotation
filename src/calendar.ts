import { google } from "googleapis";
import { JWT } from "google-auth-library";
import * as fs from "fs";

function buildCalendarAuth(): JWT {
  const key = JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS!, "utf8"));

  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject: process.env.GOOGLE_ADMIN_EMAIL!,
  });
}

export async function upsertRotationEvent(
  weekStart: string,
  weekEnd: string,
  memberName: string,
  memberEmail: string
): Promise<void> {
  const auth = buildCalendarAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID!;

  // Remove any existing "Support:" events for the week to avoid duplicates
  const existing = await calendar.events.list({
    calendarId,
    timeMin: `${weekStart}T00:00:00Z`,
    timeMax: `${weekEnd}T23:59:59Z`,
    q: "Support:",
    singleEvents: true,
  });

  for (const ev of existing.data.items ?? []) {
    if (ev.id) {
      await calendar.events.delete({ calendarId, eventId: ev.id });
    }
  }

  // Create the all-day event spanning the full week
  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `Support: ${memberName}`,
      description: `${memberName} (${memberEmail}) is on support rotation this week.`,
      start: { date: weekStart },
      end: { date: weekEnd },
      // Add the assigned person as an attendee so it appears on their calendar
      attendees: [{ email: memberEmail }],
      reminders: {
        useDefault: false,
        overrides: [{ method: "email", minutes: 60 }],
      },
    },
  });

  console.log(`  ✓ Calendar event created: "Support: ${memberName}" (${weekStart} → ${weekEnd})`);
}

/**
 * Check whether a "Support:" event already exists for a given week.
 * Returns the assignee name if found, or null if the week is empty.
 */
export async function getExistingAssignee(weekStart: string, weekEnd: string): Promise<string | null> {
  const auth = buildCalendarAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID!,
    timeMin: `${weekStart}T00:00:00Z`,
    timeMax: `${weekEnd}T23:59:59Z`,
    q: "Support:",
    singleEvents: true,
  });

  const event = (res.data.items ?? []).find((ev) =>
    ev.summary?.startsWith("Support:")
  );

  if (!event?.summary) return null;
  // Extract the name from "Support: Alice Johnson"
  return event.summary.replace(/^Support:\s*/, "").trim();
}
