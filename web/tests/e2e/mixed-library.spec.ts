import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Media, Kind } from "../../src/types";
import { fixture } from "./synthetic-fixture";

const make = (index: number, kind: Kind, extra: Partial<Media> = {}): Media => ({
  id: `mixed-${index}`, title: `A useful ${kind} ${index}`, kind, author: "A creator", status: "pending",
  url: `https://example.com/${index}`, cover_url: "", description: "", notes: "", tags: [], visibility: "private",
  created_at: new Date(Date.parse("2026-10-30T00:00:00Z") - index * 1000).toISOString(), updated_at: "2026-10-30T00:00:00Z", ...extra,
});
const content = () => [
  make(0, "video", { title: "A longer video title about choosing useful things to watch next", cover_url: "https://images.test/wide.svg", tags: ["Design"] }),
  make(1, "article", { title: "An updated Model Spec for more capable and beneficial AI", url: "https://openai.com/article", description: "An article should stay compact even when its description is very long. ".repeat(10) }),
  make(2, "book", { title: "Refactoring UI", cover_url: "https://images.test/book.svg", needs_review: true, tags: ["Design"] }),
  make(3, "video", { title: "A short video", cover_url: "https://images.test/missing.jpg", metadata_state: "partial" }),
  make(4, "paper", { title: "Attention Is All You Need", needs_review: true }),
  make(5, "book", { title: "Designing Data-Intensive Applications, Second Edition", author: "Martin Kleppmann, Chris Riccomini" }),
  make(6, "game", { title: "A game with portrait artwork", cover_url: "https://images.test/portrait.svg" }),
];
const row = (page: Page, index: number) => page.locator(`[data-row-id="mixed-${index}"]`);
const view = (page: Page, label: string) => page.getByRole("button", { name: `${label} view`, exact: true });

test("three Library views preserve global filters and preference, and migrate the gallery preference", async ({ page }) => {
  await fixture(page, content()); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard");
  await expect(view(page, "Side by side")).toHaveAttribute("aria-pressed", "true");
  for (const label of ["Shelves", "List", "Side by side"]) {
    await view(page, label).click();
    await page.getByRole("searchbox", { name: "Search library", exact: true }).fill("Refactoring");
    await expect(page.locator(".media-row")).toHaveCount(1); await expect(row(page, 2)).toBeVisible();
    await page.getByRole("searchbox", { name: "Search library", exact: true }).fill("");
  }
  await page.locator(".list-tabs").getByRole("button", { name: "To review (2)", exact: true }).click();
  for (const label of ["Shelves", "List", "Side by side"]) {
    await view(page, label).click(); await expect(page.locator(".media-row")).toHaveCount(2);
  }
  await view(page, "Shelves").click(); await page.reload();
  await expect(view(page, "Shelves")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".media-row")).toHaveCount(7);
  await page.evaluate(() => localStorage.setItem("margin-library-layout", "gallery"));
  await page.reload(); await expect(view(page, "Shelves")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("margin-library-layout"))).toBe("shelves");
  await page.locator(".main-nav > button").nth(1).click();
  await expect(page.getByRole("group", { name: "Library view", exact: true })).toHaveCount(0);
  await expect(page.locator(".article-row")).toHaveCount(40);
});

test("mixed layouts contain full titles, artwork and 44px controls across widths and themes", async ({ page }, info) => {
  test.setTimeout(90000);
  await fixture(page, content()); await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir("../.local/current-refinement/captures", { recursive: true });
  for (const width of [320, 390, 768, 1024, 1440]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem("margin-theme", theme), theme);
    await page.goto("http://margin.test/dashboard"); await expect(row(page, 0)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const label of ["Side by side", "Shelves", "List"]) {
      await view(page, label).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const geometry = await page.locator(".media-row").evaluateAll(rows => rows.map(el => {
        const r = el.getBoundingClientRect(), title = el.querySelector(".row-primary-action")!, t = title.getBoundingClientRect();
        return { id: el.getAttribute("data-row-id"), x:r.x, right:r.right, y:r.y, height:r.height, titleInside:t.x>=r.x && t.right<=r.right, clamp:getComputedStyle(title).webkitLineClamp,
          controls:[...el.querySelectorAll(".row-controls > .u-choice, .row-actions > button, .review-button")].map(c=>{const b=c.getBoundingClientRect();return {width:b.width,height:b.height,inside:b.x>=r.x && b.right<=r.right && b.y>=r.y && b.bottom<=r.bottom};}) };
      }));
      for (const item of geometry) {
        expect(item.x).toBeGreaterThanOrEqual(0); expect(item.right).toBeLessThanOrEqual(width); expect(item.titleInside).toBe(true); expect(item.clamp).toBe("none");
        for (const c of item.controls) { expect(c.width).toBeGreaterThanOrEqual(44); expect(c.height).toBeGreaterThanOrEqual(44); expect(c.inside, JSON.stringify({width,theme,label,item})).toBe(true); }
      }
      if (label !== "List") {
        const cards = geometry.filter(item => item.id === "mixed-0" || item.id === "mixed-3");
        if (Math.abs(cards[0].y-cards[1].y)<1) expect(cards[0].height).toBe(cards[1].height);
        expect(geometry.find(item=>item.id==="mixed-1")!.height).toBeLessThan(250);
        const placement=await page.locator(".library-reading").evaluate(el=>{const r=el.getBoundingClientRect(),v=document.querySelector(".library-visuals")!.getBoundingClientRect();return {right:r.x>=v.right,below:r.y>=v.bottom};});
        if (label==="Side by side" && width>=1000) expect(placement.right).toBe(true); else expect(placement.below).toBe(true);
      }
      if ((width===390 || width===1440) && label!=="List") {
        await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({ path:`../.local/current-refinement/captures/${label.replaceAll(" ","-")}-${theme}-${width}-${info.project.name}.png`,fullPage:true,animations:"disabled" });
      }
    }
  }
});

test("Vim follows the grid, status keys stay separate, and view shortcuts preserve editor focus and typing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const data=Array.from({length:9},(_,index)=>make(index,"video",{cover_url:"https://images.test/wide.svg"}));
  data.push(make(20,"article"),make(21,"article"),make(22,"video",{status:"done"}));
  await fixture(page,data); await page.emulateMedia({reducedMotion:"reduce"}); await page.goto("http://margin.test/dashboard");
  await expect(row(page,0)).toBeVisible();
  await page.keyboard.press("v"); await page.keyboard.press("s"); await expect(view(page,"Shelves")).toHaveAttribute("aria-pressed","true");
  await page.keyboard.press("j"); await expect(row(page,0)).toBeFocused();
  const columns=await row(page,0).evaluate(el=>{const top=el.getBoundingClientRect().top;return [...el.parentElement!.children].filter(c=>Math.abs(c.getBoundingClientRect().top-top)<1).length;});
  expect(columns).toBeGreaterThan(1);
  await page.keyboard.press("l"); await expect(row(page,1)).toBeFocused();
  await page.keyboard.press("j"); await expect(row(page,1+columns)).toBeFocused();
  await page.keyboard.press("h"); await expect(row(page,columns)).toBeFocused();
  await page.keyboard.press("k"); await expect(row(page,0)).toBeFocused();
  await page.keyboard.press("h"); await expect(row(page,0)).toBeFocused();
  await page.keyboard.press("]"); await expect(row(page,22)).toBeVisible();
  await page.keyboard.press("["); await expect(row(page,0)).toBeVisible();
  await page.keyboard.press("v"); await page.keyboard.press("b"); await expect(view(page,"Side by side")).toHaveAttribute("aria-pressed","true");
  const splitColumns = await row(page,0).evaluate(el => { const top=el.getBoundingClientRect().top; return [...el.parentElement!.children].filter(c=>Math.abs(c.getBoundingClientRect().top-top)<1).length; });
  expect(splitColumns).toBe(3);
  await row(page,0).focus();
  for (let index=1;index<splitColumns;index++) { await page.keyboard.press("l"); await expect(row(page,index)).toBeFocused(); }
  await page.keyboard.press("l"); await expect(page.locator(".library-reading [data-keyboard-active]")).toBeFocused();
  await page.keyboard.press("v"); await page.keyboard.press("l"); await expect(view(page,"List")).toHaveAttribute("aria-pressed","true");
  await row(page,0).focus(); await page.keyboard.press("j"); await expect(row(page,1)).toBeFocused();
  await page.keyboard.press("e"); await expect(page.locator(".editor-modal")).toBeVisible();
  await page.getByRole("button",{name:"Cancel",exact:true}).click(); await expect(row(page,1)).toBeFocused();
  const search=page.getByRole("searchbox",{name:"Search library",exact:true}); await search.fill("hjkl");
  await page.keyboard.press("l"); await expect(search).toHaveValue("hjkll"); await expect(view(page,"List")).toHaveAttribute("aria-pressed","true");
});

test("paging reveals a complete spatial row while keeping articles available, and Show more restores keyboard focus", async ({ page }) => {
  await page.setViewportSize({width:1440,height:1000});
  const data=Array.from({length:55},(_,index)=>make(index,"video",{cover_url:"https://images.test/wide.svg"}));
  data.push(make(60,"article"),make(61,"article"));
  await fixture(page,data); await page.emulateMedia({reducedMotion:"reduce"}); await page.goto("http://margin.test/dashboard");
  await expect(page.locator(".media-row")).toHaveCount(42); await expect(row(page,60)).toBeVisible();
  const columns = await row(page,0).evaluate(el => { const top=el.getBoundingClientRect().top; return [...el.parentElement!.children].filter(c=>Math.abs(c.getBoundingClientRect().top-top)<1).length; });
  await row(page,37).focus(); await page.keyboard.press("j");
  await expect(page.locator(".media-row")).toHaveCount(57); await expect(row(page,37+columns)).toBeFocused();
  await page.keyboard.press("j"); await expect(row(page,37+2*columns)).toBeFocused();
  await page.keyboard.press("End"); await expect(row(page,61)).toBeFocused();
  await page.reload(); await expect(page.locator(".media-row")).toHaveCount(42);
  await page.getByRole("button",{name:"Show more",exact:true}).focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".media-row")).toHaveCount(57); await expect(row(page,40)).toBeFocused();
});

test("directions remeasure after resizing and completing the last item retains the nearest visible item", async ({ page }) => {
  await page.setViewportSize({width:1440,height:1000});
  await fixture(page, Array.from({length:9},(_,index)=>make(index,"video",{cover_url:"https://images.test/wide.svg"})));
  await page.emulateMedia({reducedMotion:"reduce"}); await page.goto("http://margin.test/dashboard");
  await expect(row(page,0)).toBeVisible();
  const columns = await row(page,0).evaluate(el => { const top=el.getBoundingClientRect().top; return [...el.parentElement!.children].filter(c=>Math.abs(c.getBoundingClientRect().top-top)<1).length; });
  await row(page,0).focus(); await page.keyboard.press("ArrowRight"); await expect(row(page,1)).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(row(page,1+columns)).toBeFocused();
  await page.keyboard.press("End"); await expect(row(page,8)).toBeFocused();
  const lastBounds=await row(page,8).boundingBox();
  // Browsers round scroll positions while grid geometry can be fractional.
  expect(lastBounds!.y+lastBounds!.height).toBeLessThanOrEqual(1000-32+1);
  await page.keyboard.press("Space"); await expect(row(page,8)).toHaveCount(0); await expect(row(page,7)).toBeFocused();
  await page.setViewportSize({width:390,height:900});
  await row(page,0).focus(); await page.keyboard.press("j"); await expect(row(page,1)).toBeFocused();
  await page.setViewportSize({width:1440,height:1000});
  await row(page,0).focus(); await page.keyboard.press("j"); await expect(row(page,columns)).toBeFocused();
});

test("Discover keyboard paging still focuses the first item returned by the server", async ({ page }) => {
  await fixture(page); await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".article-row")).toHaveCount(40);
  await page.getByRole("button", {name:"Show more",exact:true}).focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".article-row")).toHaveCount(42);
  await expect(page.locator('[data-row-id="inbox-40"]')).toBeFocused();
});

test("top shortcuts and upward item navigation reveal the heading and filters without taking editing keys", async ({ page }) => {
  await fixture(page, Array.from({length:24},(_,index)=>make(index,"video",{cover_url:"https://images.test/wide.svg"})));
  await page.emulateMedia({reducedMotion:"reduce"}); await page.setViewportSize({width:1440,height:800});
  await page.goto("http://margin.test/dashboard"); await expect(row(page,0)).toBeVisible();
  for (const label of ["Side by side","Shelves","List"]) {
    await view(page,label).click();
    for (const shortcut of ["Home","Control+Home","gg"]) {
      await row(page,23).focus(); await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
      expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(200);
      if (shortcut==="gg") {await page.keyboard.press("g");await page.keyboard.press("g");}
      else await page.keyboard.press(shortcut);
      await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0); await expect(row(page,0)).toBeFocused();
      const heading=await page.locator(".page-heading").boundingBox();
      const header=await page.locator(".app-header").boundingBox();
      expect(heading!.y).toBeGreaterThanOrEqual(header!.y+header!.height);
    }
    const columns=await row(page,0).evaluate(el=>{const top=el.getBoundingClientRect().top;return [...el.parentElement!.children].filter(c=>Math.abs(c.getBoundingClientRect().top-top)<1).length;});
    await row(page,columns).focus(); await page.evaluate(()=>scrollTo(0,200));
    await page.keyboard.press("k"); await expect(row(page,0)).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  }
  const search=page.getByRole("searchbox",{name:"Search library",exact:true});
  await search.fill("video"); await search.press("Control+Home");
  await expect(search).toBeFocused(); expect(await search.evaluate((el:HTMLInputElement)=>el.selectionStart)).toBe(0);
  await search.fill(""); await row(page,0).focus(); await page.keyboard.press("e");
  const title=page.locator(".editor-modal").getByRole("textbox",{name:"Title",exact:true});
  await title.fill("Keep editing here"); await title.press("Control+Home");
  await expect(title).toBeFocused(); await expect(title).toHaveValue("Keep editing here");
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  await page.setViewportSize({width:390,height:430}); await search.fill("No matching entry");
  await expect(page.locator(".media-row")).toHaveCount(0);
  await page.locator("main").focus(); await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
  await page.keyboard.press("Control+Home"); await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await expect(page.locator("main")).toBeFocused();
});

test("reading rows share tags and actions, retain full touch targets and use straight separators", async ({ page }, info) => {
  test.setTimeout(60000);
  const data=[make(0,"video",{cover_url:"https://images.test/wide.svg"}),
    make(20,"paper",{title:"Small models, big questions",author:"Studio",tags:["demo","paper"],visibility:"public",needs_review:true}),
    make(21,"article",{title:"A field guide to curiosity",author:"Studio",tags:["demo","other"],visibility:"public"}),
    make(22,"other",{title:"A short reading note",author:"Studio",tags:[]})];
  const controls=await fixture(page,data); await page.emulateMedia({reducedMotion:"reduce"});
  await mkdir("../.local/reading-navigation-2026-10-31",{recursive:true});
  for (const width of [320,390,1440]) for (const theme of ["dark","light"]) {
    await page.setViewportSize({width,height:1000});
    await page.addInitScript(theme=>localStorage.setItem("margin-theme",theme),theme);
    await page.goto("http://margin.test/dashboard"); await expect(row(page,20)).toBeVisible();
    for (const label of ["Side by side","Shelves"]) {
      await view(page,label).click();
      const readings=await page.locator(".library-reading-list .media-row").evaluateAll(rows=>rows.map(row=>{
        const r=row.getBoundingClientRect(),actions=row.querySelector(".row-controls")!.getBoundingClientRect();
        const css=getComputedStyle(row),line=getComputedStyle(row,"::before");
        return {height:r.height,review:!!row.querySelector(".review-button"),border:css.borderBottomWidth,line:line.borderBottomWidth,lineRadius:line.borderRadius,artInset:row.querySelector(".library-art")!.getBoundingClientRect().left-r.left,
          tags:[...row.querySelectorAll(".inline-tag")].map(el=>{const t=el.getBoundingClientRect();return {contained:t.x>=r.x&&t.right<=r.right&&t.y>=r.y&&t.bottom<=r.bottom,separate:t.right<=actions.x||t.bottom<=actions.y||t.y>=actions.bottom};}),
          targets:[...row.querySelectorAll(".row-controls .u-choice,.row-actions button")].map(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height,contained:b.x>=r.x&&b.right<=r.right&&b.y>=r.y&&b.bottom<=r.bottom};})};
      }));
      for (const r of readings) {
        expect(r.height).toBeLessThanOrEqual(r.review?150:124);
        expect(r.border).toBe("0px");expect(r.line).toBe("1px");expect(r.lineRadius).toBe("0px");
        expect(r.artInset).toBeGreaterThanOrEqual(8);
        for (const t of r.targets) {expect(t.width).toBeGreaterThanOrEqual(44);expect(t.height).toBeGreaterThanOrEqual(44);expect(t.contained).toBe(true);}
        for (const t of r.tags) {expect(t.contained).toBe(true);expect(t.separate).toBe(true);}
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      await row(page,21).focus(); await page.keyboard.press("Tab");
      const title=row(page,21).locator(".row-primary-action"); await expect(title).toBeFocused();
      expect(await title.evaluate(el=>({title:getComputedStyle(el).outlineStyle,row:getComputedStyle(el.closest(".media-row")!).outlineStyle,frame:getComputedStyle(el,"::after").outlineStyle}))).toEqual({title:"none",row:"none",frame:"solid"});
      if (width===1440) await page.locator(".library-reading").screenshot({path:`../.local/reading-navigation-2026-10-31/${label.replaceAll(" ","-")}-${theme}-${info.project.name}.png`});
    }
  }
  await row(page,20).getByRole("button",{name:"Mark reviewed: Small models, big questions",exact:true}).focus();
  await page.keyboard.press("Enter");await expect(row(page,20).locator(".review-button")).toHaveCount(0);
  await expect(row(page,20)).toBeFocused();await expect(row(page,20).getByRole("checkbox")).not.toBeChecked();
  expect(controls.requests.mediaPatches).toBe(1);
});
