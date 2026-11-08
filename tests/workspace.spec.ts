import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openCase(page: Page, id: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`CW-${id}`) }).click();
  await expect(
    page.getByRole("heading", { name: "Ticket not received", exact: true }),
  ).toBeVisible();
}

async function investigate(page: Page) {
  const initial = page.getByRole("button", {
    name: /^(Investigate case|Restart investigation)$/,
  });
  if (await initial.isVisible()) await initial.click();
  else
    await page.getByRole("button", { name: "Run again", exact: true }).click();
}

test("investigate, inspect a source, edit, review, and export both packet formats", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openCase(page, "1042");
  await expect(
    page.getByText("Synthetic example", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Demo investigation", { exact: true }),
  ).toBeVisible();
  await investigate(page);
  await expect(
    page.getByRole("heading", { name: "Evidence supports a response." }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await page.getByRole("button", { name: /Payment captured/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Evidence record" }),
  ).toBeVisible();
  await expect(
    page.getByText("pi_demo_atm_1042", { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Response", exact: true }).click();
  const draft = page.getByRole("textbox", {
    name: "Response draft",
    exact: true,
  });
  await draft.fill(
    `${await draft.inputValue()}\n\nPrepared for internal review by the organizer.`,
  );
  await page
    .getByRole("textbox", { name: /Internal review note/ })
    .fill("Checked the customer acknowledgement against its source.");
  await expect(
    page.getByRole("button", { name: "Export response", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  const markdownPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export response", exact: true })
    .click();
  const markdown = await markdownPromise;
  expect(markdown.suggestedFilename()).toBe("casework-case_atm_1042.md");
  const markdownBody = await readFile((await markdown.path())!, "utf8");
  expect(markdownBody).toContain(
    "Prepared for internal review by the organizer.",
  );
  expect(markdownBody).toContain("case_atm_1042:support-3");
  const jsonPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Evidence JSON", exact: true })
    .click();
  const packet = JSON.parse(
    await readFile((await (await jsonPromise).path())!, "utf8"),
  );
  expect(packet.case.id).toBe("case_atm_1042");
  expect(packet.case.sourceMode).toBe("synthetic");
  expect(packet.report.reviewedAt).toBeTruthy();
  expect(packet.report.reviewerNote).toContain("customer acknowledgement");
  expect(packet.evidence.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Reviewed", exact: true }).click();
  await expect(page.getByRole("button", { name: /CW-1042/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("failed delivery produces mixed findings and missing evidence stays visible", async ({
  page,
}) => {
  await openCase(page, "1043");
  await investigate(page);
  await expect(
    page.getByRole("heading", { name: "There are two sides to this case." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What we couldn't establish" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(
    page.getByText("Partial coverage", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Unavailable", { exact: true }).first(),
  ).toBeVisible();
});

test("stop ends the run and a fresh investigation can finish with insufficient evidence", async ({
  page,
}) => {
  await openCase(page, "1044");
  await investigate(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pick up the investigation." }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.getByText("stopped", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Restart investigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "More evidence is needed." }),
  ).toBeVisible();
});

test("search, unavailable connections, and case navigation work on mobile without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Search cases" })
    .fill("no-matching-order");
  await expect(
    page.getByText("No matching cases", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: /CW-1042/ }).click();
  await expect(
    page.getByRole("heading", { name: "Ticket not received", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to cases" }).click();
  await page.getByRole("button", { name: "Add a case", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a case" })).toBeVisible();
  await expect(
    page.getByText("Connect your evidence API first.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Amazon Bedrock", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("an API failure provides a readable error without a broken page", async ({
  page,
}) => {
  await page.route("**/api/cases", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          "The evidence workspace is temporarily unavailable. Try again shortly.",
      }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(
    page.getByRole("heading", { name: "Disputes, with the facts." }),
  ).toBeVisible();
});
