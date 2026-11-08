import { expect, test, type Page } from "@playwright/test";
import type { WorkspaceState } from "../lib/domain";
import type { ManagedConnection } from "../lib/evidence-connectors/live-types";
import { CONNECTOR_TEMPLATES } from "../lib/evidence-connectors/index";

const base = process.env.CAUSALITY_UI_TEST_BASEURL || "http://127.0.0.1:8788";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error("Live connector UI tests require a local preview.");
const token = "synthetic_ui_case_token_not_a_real_secret_12345";
const name = "Ticketing evidence";

async function setup(page: Page) {
  const identity = `live-connector-ui-${crypto.randomUUID()}`;
  const headers = { "oai-authenticated-user-id": identity, "oai-authenticated-user-email": `${identity}@example.test`, "oai-authenticated-user-full-name": "Synthetic Connection Reviewer", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8" };
  await page.context().setExtraHTTPHeaders(headers);
  expect((await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: "createWorkspace", name: "Connection UI workspace" } })).status()).toBe(200);
  const seeded = await page.request.post(`${base}/api/workspace`, { headers: { ...headers, Origin: base }, data: { action: "seedDemo" } });
  expect(seeded.status()).toBe(200);
  const state = await seeded.json() as WorkspaceState;
  const requests: Record<string, unknown>[] = [];
  const connections: ManagedConnection[] = [];
  let error = "";
  await page.route("**/api/connectors", route => route.fulfill({ json: { templates: CONNECTOR_TEMPLATES, connections: [], storage: "aws", setupMode: "guided" } }));
  await page.route("**/api/connectors/live", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { connections, storage: "aws" } });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (error) return route.fulfill({ status: 403, json: { error } });
    if (body.action === "connect") {
      const now = new Date().toISOString();
      const connection: ManagedConnection = { id: "live_ui_connection", name: String(body.name), baseUrl: String(body.baseUrl), externalCaseId: String(body.externalCaseId), merchantName: "Example Ticket Business", merchantId: "merchant_example", orderRef: "ORDER-1042", paymentRef: "pi_example_1042", status: "connected", verifiedAt: now, createdAt: now, updatedAt: now };
      connections.splice(0, connections.length, connection);
      return route.fulfill({ json: { connection } });
    }
    const connection = connections.find(item => item.id === body.connectionId);
    if (!connection) return route.fulfill({ status: 404, json: { error: "Connection not found." } });
    if (body.action === "disconnect") connection.status = "disconnected";
    if (body.action === "recheck") connection.verifiedAt = new Date().toISOString();
    if (body.action === "import") return route.fulfill({ json: { state, caseId: state.cases[0].id } });
    return route.fulfill({ json: { connection } });
  });
  await page.route("**/api/investigations", route => route.request().method() === "GET" ? route.fulfill({ json: { config: { bedrockConfigured: false, merchantConfigured: false, archiveConfigured: false, region: "us-east-1" } } }) : route.continue());
  await page.goto("/workspace?view=integrations");
  await page.getByText("Custom data sources", { exact: false }).click();
  return { requests, connections, setError: (message: string) => { error = message; } };
}

async function fillConnection(page: Page, endpoint = "https://evidence.example.com") {
  const panel = page.getByRole("region", { name: "Installed evidence connections" });
  await panel.getByRole("button", { name: "Add endpoint", exact: true }).click();
  await panel.getByRole("textbox", { name: "Connection name", exact: true }).fill(name);
  await panel.getByRole("textbox", { name: "Approved case ID", exact: true }).fill("approved_case_1042");
  await panel.getByLabel("Connector HTTPS base URL", { exact: false }).fill(endpoint);
  await panel.getByLabel("Approved-case access token", { exact: false }).fill(token);
  return panel;
}

test("a workspace connects, clears the secret, rechecks and imports through its saved endpoint", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { requests } = await setup(page);
  const panel = await fillConnection(page);
  await expect(panel.getByLabel("Approved-case access token", { exact: false })).toHaveAttribute("type", "password");
  await panel.getByRole("button", { name: "Verify and connect", exact: true }).click();
  const connection = panel.getByRole("article", { name: `Connection ${name}` });
  await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
  expect(requests[0]).toEqual({ action: "connect", name, baseUrl: "https://evidence.example.com", externalCaseId: "approved_case_1042", token });
  await expect(connection).toContainText("Example Ticket Business");
  await expect(connection).toContainText("ORDER-1042");
  await panel.getByRole("button", { name: "Add endpoint", exact: true }).click();
  await expect(panel.getByLabel("Approved-case access token", { exact: false })).toHaveValue("");
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }))).not.toContain(token);
  await connection.getByRole("button", { name: "Verify again", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("verified successfully");
  expect(requests.at(-1)).toEqual({ action: "recheck", connectionId: "live_ui_connection" });
  await connection.getByRole("button", { name: "Import approved case", exact: true }).click();
  await expect(page).toHaveURL(/view=cases/);
  await expect(page.getByRole("button", { name: "Run sample investigation", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("disconnect requires an explicit choice and disables subsequent reads", async ({ page }) => {
  const { requests } = await setup(page);
  const panel = await fillConnection(page);
  await panel.getByRole("button", { name: "Verify and connect", exact: true }).click();
  const connection = panel.getByRole("article", { name: `Connection ${name}` });
  await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(connection).toContainText("imported evidence stays");
  expect(requests).toHaveLength(1);
  await connection.getByRole("button", { name: "Keep connection", exact: true }).click();
  await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
  await connection.getByRole("button", { name: "Confirm disconnect", exact: true }).click();
  await expect(connection.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(connection.getByRole("button", { name: "Import approved case", exact: true })).toBeDisabled();
  await expect(connection.getByRole("button", { name: "Verify again", exact: true })).toBeDisabled();
  await connection.getByRole("button", { name: "Reconnect with a new token", exact: true }).click();
  await expect(panel.getByLabel("Approved-case access token", { exact: false })).toHaveValue("");
  await expect(panel.getByRole("button", { name: "Verify and connect", exact: true })).toBeDisabled();
});

test("a rejected grant clears the token, shows the error and remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { setError } = await setup(page);
  setError("The connector denied this approved case. Check its access grant.");
  const panel = await fillConnection(page);
  await panel.getByRole("button", { name: "Verify and connect", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("denied this approved case");
  await expect(panel.getByLabel("Approved-case access token", { exact: false })).toHaveValue("");
  await expect(panel.getByRole("button", { name: "Verify and connect", exact: true })).toBeDisabled();
  await expect(panel.getByRole("article")).toHaveCount(0);
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport + 1);
});

test("insecure or credential-bearing endpoints are rejected before sending the token", async ({ page }) => {
  const { requests } = await setup(page);
  const panel = await fillConnection(page, "http://evidence.example.com");
  await panel.getByRole("button", { name: "Verify and connect", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Use an HTTPS base URL");
  expect(requests).toHaveLength(0);
  await panel.getByLabel("Connector HTTPS base URL", { exact: false }).fill("https://user:password@evidence.example.com");
  await panel.getByRole("button", { name: "Verify and connect", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("without credentials");
  expect(requests).toHaveLength(0);
});
