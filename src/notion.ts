import { Client as NotionClient, isFullPage } from "@notionhq/client";
import type {
  CreatePageParameters,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints";

type PageProperties = CreatePageParameters["properties"];

// Pin to the 2022-06-28 API. SDK v5's default (2025-09-03) routes database
// reads/writes through `/v1/data_sources/...`, which our workspace's database
// isn't served by yet — those requests come back as `invalid_request_url`.
// Staying on 2022-06-28 keeps the legacy `databases/{id}/query` endpoint
// (called below via `notion.request`) working until we're ready to migrate.
const notion = new NotionClient({
  auth: process.env.NOTION_TOKEN!,
  notionVersion: "2022-06-28",
});

function queryDatabase(
  databaseId: string,
  filter: Record<string, unknown>
): Promise<QueryDataSourceResponse> {
  return notion.request({
    path: `databases/${databaseId}/query`,
    method: "post",
    body: { filter },
  });
}

export interface SignUp {
  name: string;
  email?: string;
}

export interface WeekPage {
  pageId: string;
  hasName: boolean;
}

function buildSignUpProperties(
  weekStart: string | null,
  name: string,
  email: string,
  autoAssigned: boolean
): PageProperties {
  const props: PageProperties = {
    Name: { title: [{ text: { content: name } }] },
    Email: { email },
    "Auto-assigned": { checkbox: autoAssigned },
  };
  if (weekStart) {
    props.Week = { date: { start: weekStart } };
  }
  return props;
}

/**
 * Look up the Notion page (if any) for a given week, regardless of whether
 * the row has an assigned Name. Useful for upserts.
 */
export async function getPageIdForWeek(weekStart: string): Promise<WeekPage | null> {
  const response = await queryDatabase(process.env.NOTION_DATABASE_ID!, {
    property: "Week",
    date: { equals: weekStart },
  });

  const page = response.results[0];
  if (!page || !isFullPage(page)) return null;

  const nameProp = page.properties["Name"];
  const hasName =
    nameProp?.type === "title" &&
    nameProp.title.length > 0 &&
    nameProp.title[0].plain_text.trim().length > 0;

  return { pageId: page.id, hasName };
}

export async function getSignUpForWeek(weekStart: string): Promise<SignUp | null> {
  const response = await queryDatabase(process.env.NOTION_DATABASE_ID!, {
    property: "Week",
    date: { equals: weekStart },
  });

  const page = response.results[0];
  if (!page || !isFullPage(page)) return null;

  const nameProp = page.properties["Name"];
  const emailProp = page.properties["Email"];

  const name =
    nameProp?.type === "title" && nameProp.title.length > 0
      ? nameProp.title[0].plain_text.trim()
      : null;

  if (!name) return null;

  const email =
    emailProp?.type === "email" ? (emailProp.email ?? undefined) : undefined;

  return { name, email };
}

export async function writeSignUp(
  weekStart: string,
  name: string,
  email: string,
  autoAssigned: boolean
): Promise<void> {
  const existing = await getPageIdForWeek(weekStart);
  if (existing) {
    await updateSignUp(existing.pageId, name, email, autoAssigned);
    return;
  }
  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID! },
    properties: buildSignUpProperties(weekStart, name, email, autoAssigned),
  });
}

/**
 * Update an existing Notion sign-up row.
 */
export async function updateSignUp(
  pageId: string,
  name: string,
  email: string,
  autoAssigned: boolean
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: buildSignUpProperties(null, name, email, autoAssigned) as any,
  });
}

/**
 * Clear the assignee on an existing row, leaving the Week column intact.
 */
export async function clearSignUp(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Name: { title: [] },
      Email: { email: null },
      "Auto-assigned": { checkbox: false },
    } as any,
  });
}

export interface YearToDateAssignment {
  name: string;
  weekStart: string;
}

/**
 * Returns assignees with their week dates for weeks that fall within the
 * current calendar year but BEFORE `beforeDateISO`. Used to implement fair
 * rotation that prioritizes people who haven't gone this year, then those
 * who went earliest.
 */
export async function getYearToDateAssignmentsWithDates(
  beforeDateISO: string
): Promise<YearToDateAssignment[]> {
  const yearStart = new Date();
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);
  const yearStartISO = yearStart.toISOString().split("T")[0];

  const response = await queryDatabase(process.env.NOTION_DATABASE_ID!, {
    and: [
      { property: "Week", date: { on_or_after: yearStartISO } },
      { property: "Week", date: { before: beforeDateISO } },
    ],
  });

  return response.results
    .filter(isFullPage)
    .map((page) => {
      const nameProp = page.properties["Name"];
      const weekProp = page.properties["Week"];
      const name =
        nameProp?.type === "title" && nameProp.title.length > 0
          ? nameProp.title[0].plain_text.trim()
          : "";
      const weekStart =
        weekProp?.type === "date" && weekProp.date?.start
          ? weekProp.date.start
          : "";
      return { name, weekStart };
    })
    .filter((a) => a.name && a.weekStart);
}

/**
 * Returns names of assignees for weeks that fall within the current calendar
 * year but BEFORE `beforeDateISO`. Used to seed the fair-rotation picker so
 * members who were already assigned earlier this year are de-prioritised.
 */
export async function getYearToDateAssignees(beforeDateISO: string): Promise<string[]> {
  const assignments = await getYearToDateAssignmentsWithDates(beforeDateISO);
  return assignments.map((a) => a.name);
}

export async function getRecentlyAssigned(weeks: number = 12): Promise<string[]> {
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);

  const response = await queryDatabase(process.env.NOTION_DATABASE_ID!, {
    property: "Week",
    date: { on_or_after: since.toISOString().split("T")[0] },
  });

  return response.results
    .filter(isFullPage)
    .map((page) => {
      const nameProp = page.properties["Name"];
      return nameProp?.type === "title" && nameProp.title.length > 0
        ? nameProp.title[0].plain_text.trim()
        : "";
    })
    .filter(Boolean);
}
