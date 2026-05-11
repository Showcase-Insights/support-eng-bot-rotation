import { beforeEach, describe, expect, it, vi } from "vitest";

// Env must be set BEFORE importing `../src/notion` (which reads it at
// module load to construct the Notion client).
process.env.NOTION_TOKEN ??= "test-token";
process.env.NOTION_DATABASE_ID ??= "test-db";

// vi.mock is hoisted to the top of the file, so any variables it references
// must also be hoisted via vi.hoisted.
const { pagesCreate, pagesUpdate, request } = vi.hoisted(() => ({
  pagesCreate: vi.fn().mockResolvedValue({ id: "new-page" }),
  pagesUpdate: vi.fn().mockResolvedValue({ id: "existing-page" }),
  request: vi.fn(),
}));

vi.mock("@notionhq/client", () => {
  return {
    Client: class {
      pages = { create: pagesCreate, update: pagesUpdate };
      request = request;
    },
    isFullPage: (page: unknown): page is { id: string; properties: unknown } =>
      typeof page === "object" && page !== null && "id" in page,
  };
});

// Import after mocks are set up
import { writeSignUp } from "../src/notion";

describe("writeSignUp upsert behavior", () => {
  beforeEach(() => {
    pagesCreate.mockClear();
    pagesUpdate.mockClear();
    request.mockReset();
  });

  it("creates a new page when no row exists for the week", async () => {
    // getPageIdForWeek query returns no results
    request.mockResolvedValueOnce({ results: [] });

    await writeSignUp("2026-07-06", "Alice", "alice@example.com", true);

    expect(pagesCreate).toHaveBeenCalledTimes(1);
    expect(pagesUpdate).not.toHaveBeenCalled();
    const arg = pagesCreate.mock.calls[0][0];
    expect(arg.parent).toEqual({ database_id: "test-db" });
    expect(arg.properties.Week).toEqual({ date: { start: "2026-07-06" } });
  });

  it("updates the existing page when a row already exists for the week", async () => {
    // getPageIdForWeek query returns one page (e.g. an unassigned row)
    request.mockResolvedValueOnce({
      results: [
        {
          id: "existing-page-id",
          properties: { Name: { type: "title", title: [] } },
        },
      ],
    });

    await writeSignUp("2026-07-13", "Bob", "bob@example.com", true);

    expect(pagesUpdate).toHaveBeenCalledTimes(1);
    expect(pagesCreate).not.toHaveBeenCalled();
    const arg = pagesUpdate.mock.calls[0][0];
    expect(arg.page_id).toBe("existing-page-id");
    // Week column is intentionally not patched on updates
    expect(arg.properties.Week).toBeUndefined();
    expect(arg.properties.Name).toEqual({
      title: [{ text: { content: "Bob" } }],
    });
  });
});
