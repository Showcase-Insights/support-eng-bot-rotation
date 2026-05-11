import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditResult } from "../src/audit";
import { notifySlackQuarterly } from "../src/slack";

describe("notifySlackQuarterly", () => {
  const originalWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);
    // @ts-expect-error - replacing global fetch with a spy
    globalThis.fetch = fetchSpy;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWebhookUrl === undefined) {
      delete process.env.SLACK_WEBHOOK_URL;
    } else {
      process.env.SLACK_WEBHOOK_URL = originalWebhookUrl;
    }
  });

  it("does not ping Slack when a Notion row exists but no assignment was made (no `changed` flags)", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.example/test";

    // Simulates the scenario the user described: a row was added to Notion
    // for a future week but nobody was assigned, so the audit produced
    // results without any `changed` field set.
    const results: AuditResult[] = [
      {
        weekStart: "2026-06-01",
        weekEnd: "2026-06-07",
        assignee: "Alice",
        source: "existing",
      },
      {
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        assignee: "Bob",
        source: "existing",
      },
    ];

    await notifySlackQuarterly(results);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not ping Slack when SLACK_WEBHOOK_URL is unset, even with changes", async () => {
    delete process.env.SLACK_WEBHOOK_URL;

    const results: AuditResult[] = [
      {
        weekStart: "2026-06-01",
        weekEnd: "2026-06-07",
        assignee: "Alice",
        source: "random",
        changed: "new-assignment",
      },
    ];

    await notifySlackQuarterly(results);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does ping Slack when there is at least one `changed` result", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.example/test";

    const results: AuditResult[] = [
      {
        weekStart: "2026-06-01",
        weekEnd: "2026-06-07",
        assignee: "Alice",
        source: "random",
        changed: "reassigned-removed-member",
      },
    ];

    await notifySlackQuarterly(results);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hooks.slack.example/test");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain("Re-assigned (removed member)");
  });
});
