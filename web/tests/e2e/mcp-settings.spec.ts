import { test, expect } from "@playwright/test";
import { fixture } from "./synthetic-fixture";

test("MCP grants require explicit consent, stay separate and protect in-flight credentials", async ({ page }) => {
  await fixture(page, []);
  const grants: { scope: string; created_at: string }[] = [];
  const changes: string[] = [];
  let release = () => {};
  let held = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/integration/agent-grants**", async route => {
    const method = route.request().method();
    const scope = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (method === "GET") return route.fulfill({ json: grants });
    changes.push(method + " " + scope);
    if (held && method === "POST") await gate;
    if (method === "DELETE") {
      grants.splice(grants.findIndex(grant => grant.scope === scope), 1);
      return route.fulfill({ status: 204 });
    }
    grants.push({ scope, created_at: "2026-11-02T00:00:00Z" });
    return route.fulfill({ json: { scope, token: scope[0].repeat(43) } });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const panel = settings.locator("details").filter({ has: page.locator("summary", { hasText: "Marvin / MCP connection" }) });
  await panel.locator("summary").first().click();
  await panel.getByRole("button", { name: "Issue read grant", exact: true }).click();
  expect(changes).toEqual([]);
  await expect(panel).toContainText("private items");
  await panel.getByRole("button", { name: "Allow and issue credential", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Sign out", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  held = false; release();
  await expect(panel.getByLabel("read credential.", { exact: false })).toHaveValue("r".repeat(43));
  await panel.getByRole("button", { name: "Issue save grant", exact: true }).click();
  await panel.getByRole("button", { name: "Allow and issue credential", exact: true }).click();
  await expect(panel.getByLabel("save credential.", { exact: false })).toHaveValue("s".repeat(43));
  await panel.getByRole("button", { name: "Revoke read grant", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm revocation", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Issue read grant", exact: true })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Replace save grant", exact: true })).toBeEnabled();
  expect(changes).toEqual(["POST read", "POST save", "DELETE read"]);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Settings", exact: true });
  await reopened.getByText("Marvin / MCP connection", { exact: true }).click();
  await expect(reopened.locator("#agent-credential")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("s".repeat(43));
});

test("unavailable MCP grant status disables mutations until a successful retry", async ({ page }) => {
  await fixture(page, []);
  let failed = true, mutations = 0;
  await page.route("**/api/integration/agent-grants**", route => {
    if (route.request().method() !== "GET") mutations++;
    return route.fulfill(failed ? { status: 503, json: { error: "Synthetic grant status unavailable" } } : { json: [] });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByText("Marvin / MCP connection", { exact: true }).click();
  await expect(settings.getByRole("button", { name: "Issue read grant", exact: true })).toBeDisabled();
  await expect(settings.getByRole("alert")).toContainText("Synthetic grant status unavailable");
  failed = false;
  await settings.getByRole("button", { name: "Retry grant status", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Issue read grant", exact: true })).toBeEnabled();
  expect(mutations).toBe(0);
});

