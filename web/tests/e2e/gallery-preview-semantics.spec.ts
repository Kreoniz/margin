import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media, Kind } from "../../src/types";
import { fixture } from "./synthetic-fixture";

const make = (index: number, kind: Kind, values: Partial<Media> = {}): Media => ({
  id: `semantic-${index}`, kind, title: `Semantic ${kind} ${index}`, author: "Example creator", status: "pending",
  url: `https://example.com/${index}`, cover_url: "", description: "", notes: "", tags: [], visibility: "private", metadata_state: "ready",
  created_at: new Date(Date.parse("2026-10-30T00:00:00Z") - index * 1000).toISOString(), updated_at: "2026-10-30T00:00:00Z", ...values,
});
const output = fileURLToPath(new URL("../../../.local/current-refinement/compatibility/post-review-semantics/", import.meta.url));

test("only displayed settled Shelves preview captions enter the accessibility tree as non-live text", async ({ page }, info) => {
  const controls = await fixture(page, [
    make(0, "book", { author: "", url: "" }),
    make(1, "video", { cover_url: "https://images.test/missing.jpg" }),
    make(2, "video", { cover_url: "https://images.test/wide.svg" }),
    make(3, "article", { url: "https://openai.com/example" }),
    make(4, "video", { metadata_state: "pending" }),
  ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdImage();
  await page.goto("http://margin.test/dashboard");
  await expect(page.locator(".media-row")).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  const row = (index: number) => page.locator(`[data-row-id="semantic-${index}"]`);
  await expect(row(1).locator(".mini-cover")).toHaveAttribute("data-empty", "true");
  await expect(row(2).locator(".mini-cover")).toHaveAttribute("data-loading", "true");
  await expect(row(3).locator("img")).toHaveAttribute("src", "/brands/openai.svg");
  await expect.poll(() => row(3).locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const cdp = await page.context().newCDPSession(page);
  const states = [];
  const snapshot = async (label: string) => {
    const rows = await Promise.all([0, 1, 2, 3, 4].map(index => row(index).ariaSnapshot()));
    const tree = await cdp.send("Accessibility.getFullAXTree");
    const exposed = tree.nodes.filter(node => !node.ignored);
    const text = exposed.filter(node => node.role?.value === "StaticText").map(node => node.name?.value || "");
    states.push({ label, rows, axNodes: exposed, text });
    return { rows, exposed, text };
  };
  const loading = await snapshot("gallery-loading-valid-source");
  expect(loading.rows[0]).toContain("No preview");
  expect(loading.rows[1]).toContain("Preview unavailable");
  for (const index of [2, 3, 4]) expect(loading.rows[index]).not.toMatch(/No preview|Preview unavailable|Finding preview/);
  expect(loading.text.filter(text => text === "No preview")).toHaveLength(1);
  expect(loading.text.filter(text => text === "Preview unavailable")).toHaveLength(1);
  expect(loading.text).not.toContain("Finding preview…");
  expect(loading.rows[4]).toContain("status: Finding details…");
  for (const node of loading.exposed.filter(node => ["No preview", "Preview unavailable"].includes(node.name?.value || ""))) {
    const live = node.properties?.find(property => property.name === "live")?.value.value;
    expect(live === undefined || live === "off").toBe(true);
  }
  for (const item of loading.rows) expect(item).not.toMatch(/- img\b/);
  controls.releaseImage();
  await expect(row(2).locator(".mini-cover")).not.toHaveAttribute("data-loading");
  await expect.poll(() => row(2).locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const success = await snapshot("gallery-successful-valid-source");
  expect(success.rows[2]).not.toMatch(/No preview|Preview unavailable/);
  expect(success.rows[3]).not.toMatch(/No preview|Preview unavailable/);
  expect(success.text.filter(text => text === "Preview unavailable")).toHaveLength(1);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  const list = await snapshot("retained-list");
  for (const item of list.rows) expect(item).not.toMatch(/No preview|Preview unavailable|Finding preview/);
  expect(list.text).not.toContain("No preview"); expect(list.text).not.toContain("Preview unavailable");
  expect(list.rows[4]).toContain("status: Finding details…");
  await page.getByRole("button", { name: "Shelves view", exact: true }).click();
  const returned = await snapshot("gallery-returned");
  expect(returned.rows[0]).toContain("No preview"); expect(returned.rows[1]).toContain("Preview unavailable");
  expect(returned.rows[4]).not.toContain("Finding preview");
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/accessibility-${info.project.name}.json`, JSON.stringify(states, null, 2));
  await cdp.detach();
});
