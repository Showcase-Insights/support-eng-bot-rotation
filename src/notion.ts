import { Client as NotionClient, isFullPage } from "@notionhq/client";
import type {
  CreatePageParameters,
  QueryDataSourceResponse,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";

type PageProperties = CreatePageParameters["properties"];

const notion = new NotionClient({
  auth: process.env.NOTION_TOKEN!,
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

/**
 * Look up the Notion page (if any) for a given week, regardless of whether
 * the row has an assigned Name. Useful for upserts and for detecting
 * “row exists but is unassigned”.
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
 * Upsert a sign-up for a given week. If a Notion row already exists for the
 * week (whether or not it has a Name), update it in place; otherwise create
 * a new page. This prevents duplicate rows when an unassigned row exists.
 */
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
 * Update an existing Notion sign-up row. Used when re-assigning a week
 * (e.g. when the previous assignee was removed from the Google Group).
 */
export async function updateSignUp(
  pageId: string,
  name: string,
  email: string,
  autoAssigned: boolean
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: buildSignUpProperties(
      null,
      name,
      email,
      autoAssigned
    ) as UpdatePageParameters["properties"],
  });
}

/**
 * Clear the assignee on an existing Notion sign-up row, leaving the Week
 * column intact. Intended for explicit “un-assign” operations.
 */
export async function clearSignUp(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Name: { title: [] },
      Email: { email: null },
      "Auto-assigned": { checkbox: false },
    } as UpdatePageParameters["properties"],
  });
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
