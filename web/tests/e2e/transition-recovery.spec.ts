import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media } from "../../src/types";
import { fixture } from "./synthetic-fixture";

const editor = (page: Page) => page.locator(".editor-modal");
const output = fileURLToPath(new URL("../../../.local/preview-refinement/transitions/", import.meta.url));

for (const mode of ["create", "update"] as const) for (const field of ["input", "textarea"] as const)
test(`first natural keyboard retry submits once after held ${mode} failure from ${field}`, async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  if (mode === "create") {
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await editor(page).getByRole("textbox", { name: "Title or URL", exact: true }).fill("Natural retry title");
  } else {
    await page.getByRole("button", { name: "Edit A landscape video", exact: true }).click();
    await editor(page).getByRole("textbox", { name: "Title", exact: true }).fill("Natural retry title");
  }
  if (field === "textarea") await editor(page).getByText("Details, image & note", { exact: true }).click();
  const input = editor(page).getByRole("textbox", { name: field === "textarea" ? "Private note" : mode === "create" ? "Title or URL" : "Title", exact: true });
  await input.fill(field === "textarea" ? "Natural retry note" : "Natural retry title");
  await page.evaluate(() => {
    const state = window as Window & { releaseTargets?: string[] }; state.releaseTargets = [];
    document.addEventListener("keyup", event => { if (["Enter", "Control", "Meta"].includes(event.key)) state.releaseTargets!.push((event.target as HTMLElement).tagName); });
  });
  controls.failMedia(); controls.holdMediaWrite();
  await input.press(await primaryKey(page, "Enter"));
  await expect.poll(() => controls.requests.mediaWrites.length).toBe(1);
  await expect(input).toBeDisabled();
  // No form.focus(), synthetic key event, or unrelated chord in this boundary.
  controls.releaseMediaWrite();
  await expect(editor(page).getByRole("alert")).toContainText("Synthetic save unavailable");
  await expect(input).toBeEnabled();
  await input.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" revised");
  controls.failMedia(false); controls.holdMediaWrite();
  await page.keyboard.press(await primaryKey(page, "Enter"));
  await expect.poll(() => controls.requests.mediaWrites.length).toBe(2);
  await expect(input).toBeDisabled();
  expect(await page.evaluate(() => (window as Window & { releaseTargets: string[] }).releaseTargets)).toContain("BODY");
  const key = field === "textarea" ? "notes" : "title";
  expect(controls.requests.mediaWrites[1][key]).toBe(field === "textarea" ? "Natural retry note revised" : "Natural retry title revised");
  controls.releaseMediaWrite();
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites).toHaveLength(2);
});

test("holding the failed-save chord does not retry until it is released and deliberately pressed again", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit A landscape video", exact: true }).click();
  const title = editor(page).getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Held keys");
  controls.failMedia(); controls.holdMediaWrite();
  const modifier = (await primaryKey(page, "Enter")).split("+")[0];
  await page.keyboard.down(modifier); await page.keyboard.down("Enter");
  await expect.poll(() => controls.requests.mediaWrites.length).toBe(1);
  controls.releaseMediaWrite();
  await expect(editor(page).getByRole("alert")).toContainText("Synthetic save unavailable");
  await title.focus();
  await page.keyboard.down("Enter");
  expect(controls.requests.mediaWrites).toHaveLength(1);
  await page.keyboard.up("Enter"); await page.keyboard.up(modifier);
  controls.failMedia(false);
  await title.press(await primaryKey(page, "Enter"));
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites).toHaveLength(2);
});

test("conflict reload locks every draft path and preserves failed drafts before applying the successful latest record", async ({ page }) => {
  const original: Media = { id: "reload-1", kind: "video", title: "Original title", author: "Original author", url: "https://example.com/original", cover_url: "https://images.test/wide.svg", description: "Original description", notes: "Original note", tags: [], status: "pending", visibility: "private", needs_review: true, created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z" };
  const controls = await fixture(page, [original]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.conflictMedia();
  let reads = 0, failReload = true, release = () => {};
  let gate = new Promise<void>(resolve => { release = resolve; });
  const latest = { ...original, title: "Latest server title", notes: "Latest server note", tags: ["Latest tag"], needs_review: false, updated_at: "2026-10-30T01:00:00Z" };
  await page.route("**/api/media", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    reads++; await gate;
    return failReload ? route.fulfill({ status: 503, json: { error: "Synthetic reload unavailable" } }) : route.fulfill({ json: [latest] });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original title", exact: true }).click();
  await editor(page).getByText("Details, image & note", { exact: true }).click();
  const title = editor(page).getByRole("textbox", { name: "Title", exact: true });
  const note = editor(page).getByRole("textbox", { name: "Private note", exact: true });
  const tags = editor(page).getByRole("textbox", { name: "Tags (optional)", exact: true });
  await title.fill("Local title"); await note.fill("Local note"); await tags.fill("Local tag");
  await tags.press(await primaryKey(page, "Enter"));
  await expect(editor(page).getByRole("alert")).toContainText("Synthetic conflicting edit");
  const reload = () => editor(page).getByRole("button", { name: "Discard changes and reload", exact: true });
  await reload().click();
  await expect.poll(() => reads).toBe(1);
  await expect(editor(page).getByRole("status")).toHaveText("Reloading latest item…");
  await expect(title).toBeDisabled(); await expect(note).toBeDisabled(); await expect(tags).toBeDisabled();
  for (const name of ["Type", "Visibility", "Status"]) await expect(editor(page).getByRole("combobox", { name, exact: true })).toBeDisabled();
  await expect(editor(page).getByRole("checkbox")).toBeDisabled();
  await editor(page).locator(".editor-metadata a").focus();
  await page.keyboard.press(await primaryKey(page, "Shift+L"));
  await page.keyboard.press(await primaryKey(page, "Shift+D"));
  await page.keyboard.press(await primaryKey(page, "Enter"));
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByRole("button", { name: "Close dialog", exact: true })).toBeDisabled();
  expect(reads).toBe(1); expect(controls.requests.mediaWrites).toHaveLength(1);
  release();
  await expect(editor(page).getByRole("alert")).toContainText("Synthetic reload unavailable");
  await expect(title).toBeEnabled(); await expect(title).toHaveValue("Local title");
  await expect(note).toHaveValue("Local note"); await expect(tags).toHaveValue("Local tag");
  await title.press(await primaryKey(page, "Enter"));
  await expect.poll(() => controls.requests.mediaWrites.length).toBe(2);
  expect(controls.requests.mediaWrites[1]).toMatchObject({ title: "Local title", notes: "Local note", tags: ["Local tag"] });
  await expect(editor(page).getByRole("alert")).toContainText("Synthetic conflicting edit");
  gate = new Promise<void>(resolve => { release = resolve; }); failReload = false;
  await reload().click(); await expect.poll(() => reads).toBe(2); release();
  await expect(title).toHaveValue("Latest server title"); await expect(title).toBeFocused();
  await expect(note).toHaveValue("Latest server note"); await expect(tags).toHaveValue("Latest tag");
  await expect(editor(page).getByRole("alert")).toHaveCount(0);
  await title.fill("Edited after reload"); controls.conflictMedia(false);
  await title.press(await primaryKey(page, "Enter"));
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites[2]).toEqual({ title: "Edited after reload", expected: { title: "Latest server title" } });
});

for (const dismissal of ["Escape", "Close"] as const) test(`${dismissal} locks Editor immediately throughout its animated exit without saving`, async ({ page }, info) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const observations = [];
  for (const delay of [8, 56, 109]) {
    await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
    const origin = page.getByRole("button", { name: "Edit A landscape video", exact: true });
    await origin.click();
    const title = editor(page).getByRole("textbox", { name: "Title", exact: true });
    await title.fill("Dismissed draft must not save");
    await page.waitForTimeout(220);
    if (dismissal === "Escape") await title.press("Escape");
    else await editor(page).getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(editor(page).locator(".editor-fields")).toHaveAttribute("disabled", "");
    await page.waitForTimeout(delay);
    observations.push({ delay, stillMounted: await editor(page).count() === 1 });
    await page.keyboard.press(await primaryKey(page, "Enter"));
    await expect(editor(page)).toHaveCount(0); await expect(origin).toBeFocused();
    expect(controls.requests.mediaWrites).toHaveLength(0);
  }
  expect(observations.some(value => value.stillMounted)).toBe(true);
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/dismissal-${dismissal}-${info.project.name}.json`, JSON.stringify(observations, null, 2));
});

test("browser token create, replace and revoke keep Settings mounted through success and failure", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let configured = false, writes = 0, serial = 0, fail = false, release = () => {};
  let gate = Promise.resolve();
  const hold = () => { gate = new Promise<void>(resolve => { release = resolve; }); };
  await page.route("**/api/integration/browser-token", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { configured } });
    writes++; await gate;
    if (fail) return route.fulfill({ status: 503, json: { error: "Synthetic browser-token update unavailable" } });
    configured = route.request().method() !== "DELETE";
    return configured ? route.fulfill({ json: { token: `SYNTHETIC-ONLY-BROWSER-TOKEN-${++serial}` } }) : route.fulfill({ status: 204 });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const origin = page.getByRole("button", { name: "Settings", exact: true });
  await origin.click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByText("Helium / browser capture", { exact: true }).click();
  const blockedExit = async () => {
    await expect(settings.getByRole("button", { name: "Close dialog", exact: true })).toBeDisabled();
    await expect(settings.getByRole("button", { name: "Sign out", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(settings).toBeVisible();
    await page.mouse.click(1, 1); await expect(settings).toBeVisible();
  };
  hold(); await settings.getByRole("button", { name: "Create browser token", exact: true }).click();
  await expect.poll(() => writes).toBe(1); await blockedExit(); release();
  const token = settings.locator("#browser-token");
  await expect(token).toHaveValue("SYNTHETIC-ONLY-BROWSER-TOKEN-1");
  await expect(settings.getByRole("button", { name: "Close dialog", exact: true })).toBeEnabled();
  await settings.getByRole("button", { name: "Replace browser token", exact: true }).click();
  hold(); fail = true;
  await settings.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => writes).toBe(2); await blockedExit(); release();
  await expect(settings.getByRole("alert")).toContainText("Synthetic browser-token update unavailable");
  await expect(token).toHaveValue("SYNTHETIC-ONLY-BROWSER-TOKEN-1");
  await expect(settings.getByRole("button", { name: "Close dialog", exact: true })).toBeEnabled();
  hold(); fail = false;
  await settings.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => writes).toBe(3); await blockedExit(); release();
  await expect(token).toHaveValue("SYNTHETIC-ONLY-BROWSER-TOKEN-2");
  await settings.getByRole("button", { name: "Revoke browser token", exact: true }).click();
  hold(); await settings.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => writes).toBe(4); await blockedExit(); release();
  await expect(token).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Create browser token", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("SYNTHETIC-ONLY-BROWSER-TOKEN");
  await page.keyboard.press("Escape"); await expect(settings).toHaveCount(0); await expect(origin).toBeFocused();
  expect(writes).toBe(4);
});

async function primaryKey(page: Page, key: string) {
  return await page.evaluate(() => (navigator.platform + navigator.userAgent).toLowerCase().includes("mac") ? "Meta" : "Control") + "+" + key;
}
