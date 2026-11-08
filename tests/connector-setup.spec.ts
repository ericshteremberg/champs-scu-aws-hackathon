import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { WorkspaceState } from "../lib/domain";
import { CONNECTOR_TEMPLATES, getConnectorTemplate, previewConnector } from "../lib/evidence-connectors/index";
import type { ConnectorManifest } from "../lib/evidence-connectors/types";
import type { EvidenceConnection } from "../lib/evidence-connectors/api-types";

const base = process.env.CAUSALITY_UI_TEST_BASEURL || "http://127.0.0.1:8788";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error("Connector browser tests require a local preview.");

async function setup(page: Page, initiallyUnavailable = false) {
  const id = `connector-ui-${crypto.randomUUID()}`;
  const headers = {
    "oai-authenticated-user-id": id,
    "oai-authenticated-user-email": `${id}@example.test`,
    "oai-authenticated-user-full-name": "Synthetic Connector Reviewer",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  await page.context().setExtraHTTPHeaders(headers);
  const created = await page.request.post(`${base}/api/workspace`, {
    headers: { ...headers, Origin: base },
    data: { action: "createWorkspace", name: "Synthetic Connector Workspace" },
  });
  expect(created.status()).toBe(200);
  let state = await created.json() as WorkspaceState;
  const connections: EvidenceConnection[] = [];
  let unavailable = initiallyUnavailable;
  await page.route("**/api/workspace", route => route.request().method() === "GET" ? route.fulfill({ json: state }) : route.continue());
  await page.route("**/api/investigations", route => route.request().method() === "GET" ? route.fulfill({ json: { config: { bedrockConfigured: false, merchantConfigured: false, archiveConfigured: false, region: "us-east-1" } } }) : route.continue());
  await page.route("**/api/connectors**", async route => {
    if (unavailable) return route.fulfill({ status: 503, json: { error: "Evidence connector setup requires the AWS backend." } });
    const url = new URL(route.request().url());
    if (url.pathname === "/api/connectors/install") {
      const item = connections.find(connection => connection.id === url.searchParams.get("connectionId"));
      if (!item) return route.fulfill({ status: 404, json: { error: "Configuration not found." } });
      return route.fulfill({ json: {
        files: [{ name: "connector-manifest.json", content: JSON.stringify(item.manifest, null, 2) }, { name: "read-role.sql", content: "-- Reviewed read permissions" }],
        instructions: ["Download connector-manifest.json.", "Run the guided installer in your hosting environment.", "Keep database credentials beside the database."],
      } });
    }
    if (route.request().method() === "GET") return route.fulfill({ json: { templates: CONNECTOR_TEMPLATES, connections, storage: "aws", setupMode: "guided" } });
    const body = route.request().postDataJSON() as { action: string; templateId: string; manifest: ConnectorManifest; name: string; connectionId: string };
    try {
      if (body.action === "preview") return route.fulfill({ json: { preview: previewConnector(body.manifest, body.templateId) } });
      if (body.action === "save") {
        previewConnector(body.manifest, body.templateId);
        const connection: EvidenceConnection = { id: `conn_ui_${connections.length + 1}`, name: body.name, manifest: body.manifest, templateId: body.templateId, status: "demo_ready", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        connections.push(connection);
        return route.fulfill({ json: { connection } });
      }
      const connection = connections.find(item => item.id === body.connectionId);
      if (!connection) return route.fulfill({ status: 404, json: { error: "Configuration not found." } });
      if (body.action === "revoke") {
        connection.status = "revoked";
        return route.fulfill({ json: { connection } });
      }
      if (body.action === "import_demo") {
        const preview = previewConnector(connection.manifest, connection.templateId);
        const caseId = `case_ui_${connection.id}`;
        const timestamp = new Date().toISOString();
        state = { ...state, cases: [...state.cases.filter(item => item.id !== caseId), {
          id: caseId, title: `${preview.case.reason} (connector sample)`, customerName: preview.case.customerLabel, email: "", amount: preview.case.amount, currency: preview.case.currency,
          status: "needs_review", reason: preview.case.claim, orderRef: preview.case.orderRef, dueAt: preview.case.dueAt, source: "demo", createdAt: timestamp, updatedAt: timestamp, findings: [],
          evidence: preview.sections.flatMap(section => section.records.map(record => ({ id: record.id, caseId, source: "database" as const, title: record.title, content: record.detail, occurredAt: record.occurredAt, reference: record.sourceId }))),
        }] };
        return route.fulfill({ json: { caseId, state } });
      }
      return route.fulfill({ status: 400, json: { error: "Unknown connector action." } });
    } catch (error) {
      return route.fulfill({ status: 400, json: { error: error instanceof Error ? error.message : "Invalid mapping." } });
    }
  });
  await page.goto("/workspace?view=integrations");
  await page.getByText("Custom data sources", { exact: false }).click();
  return { connections, available: () => { unavailable = false; } };
}

for (const templateId of ["atmsphr-tickets", "rentul-rentals"] as const) {
  test(`${templateId} guided setup previews case boundaries, downloads mapping and opens a sample`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const { connections } = await setup(page);
    const template = getConnectorTemplate(templateId);
    const setupSection = page.getByRole("region", { name: "Evidence connectors" });
    await setupSection.getByRole("button", { name: "Add evidence connector", exact: true }).click();
    await setupSection.getByRole("button", { name: new RegExp(template.name) }).click();
    await setupSection.getByLabel("Connection name", { exact: true }).fill(`${template.name} reviewed`);
    await setupSection.getByRole("button", { name: "Review mapping", exact: true }).click();
    await expect(setupSection.getByRole("button", { name: "Preview case access", exact: true })).toBeDisabled();
    await setupSection.getByRole("checkbox", { name: /I have reviewed/ }).check();
    await setupSection.getByRole("button", { name: "Preview case access", exact: true }).click();
    await expect(setupSection.getByText("Boundary checks passed", { exact: true })).toBeVisible();
    await expect(setupSection.getByText("Unrelated case", { exact: true })).toBeVisible();
    await expect(setupSection.getByRole("region", { name: "Permitted case evidence" })).toContainText(templateId === "atmsphr-tickets" ? "Ticket" : "Rental");
    await setupSection.getByRole("button", { name: "Save configuration", exact: true }).click();
    await expect(setupSection.getByText("Install connector", { exact: true })).toBeVisible();
    await expect(setupSection.getByText("This saved setup is not a live connection.", { exact: false })).toBeVisible();
    const file = page.waitForEvent("download");
    await setupSection.getByRole("button", { name: "connector-manifest.json", exact: true }).click();
    const content = JSON.parse(await readFile((await (await file).path())!, "utf8"));
    expect(content).toEqual(connections[0].manifest);
    expect(content.order.table).toBe(template.manifest.order.table);
    await setupSection.getByRole("button", { name: "Open sample investigation", exact: true }).click();
    await expect(page).toHaveURL(/view=cases/);
    await expect(page.getByRole("button", { name: "Run sample investigation", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("mapping changes require confirmation again and an invalid relationship remains editable", async ({ page }) => {
  await setup(page);
  const section = page.getByRole("region", { name: "Evidence connectors" });
  await section.getByRole("button", { name: "Add evidence connector" }).click();
  await section.getByRole("button", { name: "Review mapping", exact: true }).click();
  await section.getByRole("checkbox", { name: /I have reviewed/ }).check();
  await section.getByText("Review purchase mapping", { exact: false }).click();
  await section.getByRole("combobox", { name: "Payment reference", exact: true }).selectOption("order_number");
  await expect(section.getByRole("checkbox", { name: /I have reviewed/ })).not.toBeChecked();
  await section.getByRole("checkbox", { name: /I have reviewed/ }).check();
  await section.getByRole("button", { name: "Preview case access", exact: true }).click();
  await expect(section.getByRole("alert")).toBeVisible();
  await expect(section.getByRole("button", { name: "Save configuration", exact: true })).toHaveCount(0);
  await section.getByRole("combobox", { name: "Payment reference", exact: true }).selectOption("payment_ref");
  await section.getByRole("checkbox", { name: /I have reviewed/ }).check();
  await section.getByRole("button", { name: "Preview case access", exact: true }).click();
  await expect(section.getByText("Boundary checks passed", { exact: true })).toBeVisible();
});

test("setup displays backend unavailability honestly and supports retry on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { available } = await setup(page, true);
  const section = page.getByRole("region", { name: "Evidence connectors" });
  await expect(section.getByRole("alert")).toContainText("requires the AWS backend");
  await expect(section.getByRole("button", { name: "Add evidence connector" })).toBeDisabled();
  available();
  await section.getByRole("button", { name: "Retry loading", exact: true }).click();
  await section.getByRole("button", { name: "Add evidence connector" }).click();
  await expect(section.getByRole("heading", { name: "Choose a template", exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});
