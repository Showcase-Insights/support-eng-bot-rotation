import type { AuditResult } from "./audit";

export async function notifySlackQuarterly(results: AuditResult[]): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const changes = results.filter((r) => r.changed);
  if (changes.length === 0) {
    console.log("  Slack: no updates to report, skipping notification");
    return;
  }

  const header = `:calendar: *Support rotation — ${changes.length} update(s) this run*`;

  const changeLabels: Record<string, string> = {
    "new-assignment": "🎲 New",
    "synced-to-calendar": "📅 Synced to calendar",
    "synced-to-notion": "📝 <https://www.notion.so/letshighlight/33d267bfb84780cc98fdcb271eee7010?v=33d267bfb847803b9338000c19ccd735|Synced to Notion>",
    "calendar-updated": "🔄 Calendar updated",
  };

  const lines = changes.map((r) => {
    const label = changeLabels[r.changed!] ?? "🔧";
    return `${label}: *${r.weekStart}* — ${r.assignee}`;
  });

  const text = [header, "", ...lines].join("\n");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    console.warn(`  Slack notification failed: ${res.status}`);
  } else {
    console.log(`  Slack notified with ${changes.length} update(s)`);
  }
}
