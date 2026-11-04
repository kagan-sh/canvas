// Drives the canvas page in headless Chromium, outside kagan, against test/ui/stub.ts.
// Usage: node test/ui/canvas-page.mjs
// Needs Playwright. Set CANVAS_UI_PLAYWRIGHT to its index.mjs path (default: a scratch install).
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const uiDir = path.join(root, "ui");
const shotDir = process.env.CANVAS_UI_SHOTS ?? "/Users/aorumbayev/projects/kagan-sh/kagan/.plans/web-port";
const playwrightPath = process.env.CANVAS_UI_PLAYWRIGHT ?? "/tmp/canvas-ui-harness/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const THEMES = {
  light: `:root { color-scheme: light; --bg:#eef1f5; --surface:#e4e8ee; --raised:#d8dee7; --hover:#dde3eb; --ink:#262b36; --muted:#535c6c; --line:#d3d9e2; --accent:#9a4116; --needs:#80570a; --failed:#a62f3c; --added:#3c6a2c; --working:#285f73; }`,
  dark: `:root { color-scheme: dark; --bg:#22262f; --surface:#1c1f27; --raised:#2f3440; --hover:#272c36; --ink:#e5e9f0; --muted:#a7afbf; --line:#353b48; --accent:#f0905f; --needs:#ebc874; --failed:#ec959c; --added:#a8c98e; --working:#8fc7d6; }`,
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

function serve(theme) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("Content-Security-Policy", CSP);
    if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();
    if (url.pathname === "/__kagan/theme.css") {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      return void res.end(THEMES[theme]);
    }
    const file = path.join(uiDir, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(uiDir + path.sep) || !fs.existsSync(file)) return void res.writeHead(404).end();
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
}

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-ui-stub-"));
await esbuild.build({ entryPoints: [path.join(root, "test/ui/stub.ts")], bundle: true, format: "iife", target: "es2022", outfile: path.join(stubDir, "stub.js") });
const stubJs = fs.readFileSync(path.join(stubDir, "stub.js"), "utf8");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function openPage(browser, theme, { pushContext = true, coarse = false, seed } = {}) {
  const server = serve(theme);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, colorScheme: theme });
  const page = await context.newPage();
  const problems = [];
  const fonts = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || /Content Security Policy|Refused/.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (res) => {
    if (res.url().endsWith(".woff2")) fonts.push(res.status());
  });
  if (seed) await page.addInitScript(`window.__seed = ${JSON.stringify(seed)};`);
  await page.addInitScript({ content: stubJs });
  // A touch screen: the page reads "(pointer: coarse)" as matching. Set before the page loads.
  if (coarse) {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === "(pointer: coarse)" ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : real(query);
    });
  }
  const headers = { value: "" };
  page.on("response", (res) => {
    if (res.url() === `http://127.0.0.1:${port}/`) headers.value = res.headers()["content-security-policy"] ?? "";
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  // A reopened panel gets no push: the page must ask for the thread on screen itself.
  if (pushContext) await page.evaluate(() => window.dispatchEvent(new CustomEvent("kagan", { detail: { push: "context", threadId: "thr_here", projectId: "p1" } })));
  await page.waitForSelector("svg.cv-svg");
  await page.waitForTimeout(150);
  return { server, context, page, problems, fonts, headers };
}

const boxCount = (page) => page.locator("svg.cv-svg [data-id]").count();
const pressed = (page) => page.evaluate(() => [...document.querySelectorAll(".cv-toolbar [aria-pressed='true']")].map((b) => b.getAttribute("aria-label")));
const zoomLabel = (page) => page.locator(".cv-zoom").innerText();
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
// A draw ends by returning to Select once the plugin confirms it. Wait for that, so a key pressed
// next is not undone by the late confirmation.
async function waitCount(page, n) {
  await page.waitForFunction((count) => document.querySelectorAll("svg.cv-svg [data-id]").length === count, n, { timeout: 4000 });
  await page.waitForTimeout(250);
}
const BOX_A = { from: { x: 300, y: 250 }, to: { x: 420, y: 330 } };
const BOX_B = { from: { x: 600, y: 250 }, to: { x: 720, y: 330 } };

async function drawDiagram(page) {
  await page.mouse.click(200, 620); // empty canvas: focus the page, clear selection
  await page.keyboard.press("r");
  await drag(page, BOX_A.from, BOX_A.to);
  await waitCount(page, 1).catch(async (error) => {
    const state = await page.evaluate(() => ({ active: document.activeElement?.tagName + "." + document.activeElement?.className, count: document.querySelectorAll("svg.cv-svg [data-id]").length, pressed: [...document.querySelectorAll(".cv-toolbar [aria-pressed='true']")].map((b) => b.getAttribute("aria-label")) }));
    throw new Error(`box not drawn: ${JSON.stringify(state)} ${error.message.slice(0, 80)}`);
  });
  await page.keyboard.press("r");
  await drag(page, BOX_B.from, BOX_B.to);
  await waitCount(page, 2).catch(async (error) => {
    const state = await page.evaluate(() => ({ active: document.activeElement?.tagName + "." + document.activeElement?.className, count: document.querySelectorAll("svg.cv-svg [data-id]").length, pressed: [...document.querySelectorAll(".cv-toolbar [aria-pressed='true']")].map((b) => b.getAttribute("aria-label")), at: document.elementFromPoint(600, 250)?.tagName }));
    throw new Error(`second box not drawn: ${JSON.stringify(state)} ${error.message.slice(0, 80)}`);
  });
  await page.keyboard.press("a");
  await drag(page, { x: 360, y: 290 }, { x: 660, y: 290 });
  await waitCount(page, 3);
  await page.keyboard.press("Enter");
  await page.waitForSelector("textarea.cv-editor");
  await page.keyboard.type("yes");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => [...document.querySelectorAll("svg.cv-svg text")].some((t) => t.textContent === "yes"));
  await page.mouse.click(200, 620);
}

async function functional(browser) {
  const { server, context, page, problems, fonts, headers } = await openPage(browser, "light");
  try {
    await page.click("input[aria-label='Note for the agent']");
    await page.keyboard.type("hello there");
    const note = await page.inputValue("input[aria-label='Note for the agent']");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("a. note field: click focuses it and typing writes into it", note === "hello there" && focused === "Note for the agent", `value="${note}", focus="${focused}"`);

    await page.mouse.click(200, 620);
    const keyTools = [
      ["r", "Rectangle"],
      ["a", "Arrow"],
      ["l", "Line"],
      ["p", "Draw"],
      ["t", "Text"],
      ["e", "Eraser"],
      ["h", "Hand (panning tool)"],
      ["v", "Selection"],
    ];
    for (const [key, label] of keyTools) {
      await page.keyboard.press(key);
      const now = await pressed(page);
      check(`b. key ${key.toUpperCase()} picks ${label}`, now.includes(label), now.join(","));
    }
    const lockLabel = "Keep selected tool active after drawing";
    const lockOn = () => page.locator(`[aria-label='${lockLabel}']`).getAttribute("aria-pressed");
    const before = await lockOn();
    await page.keyboard.press("q");
    const mid = await lockOn();
    await page.keyboard.press("q");
    const after = await lockOn();
    check("b. key Q toggles keep-tool", before === "false" && mid === "true" && after === "false", `${before}→${mid}→${after}`);
    await page.keyboard.press("Meta+=");
    const zoomed = await zoomLabel(page);
    await page.keyboard.press("Shift+Digit1");
    const fitted = await zoomLabel(page);
    check("b. Shift+1 zooms to fit (zoom label goes back to 100% on an empty canvas)", zoomed === "110%" && fitted === "100%", `${zoomed} then ${fitted}`);

    await page.keyboard.press("v");
    await page.keyboard.press("r");
    await drag(page, BOX_A.from, BOX_A.to);
    await waitCount(page, 1);
    check("c. drawing a box adds one element", (await boxCount(page)) === 1);
    await page.keyboard.press("Meta+z");
    await waitCount(page, 0);
    check("c. Cmd+Z removes the box", (await boxCount(page)) === 0);
    await drawDiagram(page);
    check("c. box, box, arrow and label are drawn", await page.evaluate(() => document.querySelectorAll("svg.cv-svg [data-id]").length === 3));
    await page.keyboard.press("Meta+z");
    await page.waitForFunction(() => ![...document.querySelectorAll("svg.cv-svg text")].some((t) => t.textContent === "yes"));
    check("c. Cmd+Z removes only the arrow label", (await boxCount(page)) === 3);

    await page.keyboard.press("v");
    await page.mouse.click(360, 290);
    await page.keyboard.press("Meta+d");
    await waitCount(page, 4);
    check("b. Cmd+D duplicates the selection", (await boxCount(page)) === 4);
    // The copy is the last box in the drawing, and it is the one selected.
    const lastX = () => page.evaluate(() => {
      const boxes = [...document.querySelectorAll("svg.cv-svg g[data-id][transform]")];
      const match = /translate\(([-\d.]+)/.exec(boxes.at(-1).getAttribute("transform"));
      return Number(match[1]);
    });
    const xBefore = await lastX();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    const xAfter = await lastX();
    check("b. arrow keys nudge the selection by 1", xAfter - xBefore === 1, `${xBefore}→${xAfter}`);
    await page.keyboard.press("Delete");
    await waitCount(page, 3);
    check("b. Delete removes the selection", (await boxCount(page)) === 3);

    // Undo the nudge and the deletion. Then Cmd+A and Delete empty the canvas.
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Meta+z");
    await waitCount(page, 4);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Delete");
    await waitCount(page, 0);
    check("b. Cmd+A then Delete empties the canvas", (await boxCount(page)) === 0);

    await drawDiagram(page);
    await page.locator("[aria-label='Main menu']").click();
    await page.getByRole("menuitem", { name: "Copy as image" }).click();
    await page.waitForFunction(() => window.kaganStub.pngParts().some((part) => part.last), null, { timeout: 8000 });
    const parts = await page.evaluate(() => window.kaganStub.pngParts());
    const joined = parts.map((p) => p.data).join("");
    const bytes = Buffer.from(joined, "base64");
    const isPng = bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const ordered = parts.every((p, i) => p.index === i) && parts.at(-1).last && parts.slice(0, -1).every((p) => !p.last);
    check("f. Copy as image sends a PNG in ordered pieces", isPng && ordered, `${parts.length} piece(s), ${bytes.length} bytes`);

    await page.locator("select[aria-label='Send to']").selectOption("thr_other");
    await page.fill("input[aria-label='Note for the agent']", "Tidy the labels");
    await page.locator("button", { hasText: /^Send$/ }).click();
    await page.waitForFunction(() => window.kaganStub.sent().length === 1);
    const sent = await page.evaluate(() => window.kaganStub.sent()[0]);
    check("f. Send passes the note and thread to the plugin", sent.threadId === "thr_other" && sent.note === "Tidy the labels", JSON.stringify(sent));
    const sendCaption = await page.locator(".cv-caption").innerText();
    check("f. Send panel says it pastes without pressing Enter", /Pastes your note/.test(sendCaption), sendCaption);

    await page.locator("[aria-label='Main menu']").click();
    await page.getByRole("menuitem", { name: "Delete this canvas" }).click();
    const askedOnce = await page.getByRole("alertdialog").count();
    await page.getByRole("button", { name: "Keep canvas" }).click();
    const kept = await page.evaluate(() => Object.keys(window.kaganStub.docs()).includes("Main"));
    check("f. Delete asks, and Keep canvas leaves it", askedOnce === 1 && kept);

    await page.evaluate(() => document.fonts.load("500 16px Nunito"));
    const fontOk = await page.evaluate(() => [...document.fonts].some((f) => f.family.includes("Nunito") && f.status === "loaded"));
    check("d. Nunito loads from the page", fontOk && fonts.includes(200), `font responses=${fonts.join(",") || "none"}`);
    check("d. the page sends the CSP the brief asks for", headers.value === CSP, headers.value === CSP ? "" : headers.value);
    check("d. zero CSP violations or console errors", problems.length === 0, problems.join(" | ").slice(0, 400));
  } finally {
    await context.close();
    server.close();
  }
}

async function bridge(browser) {
  const { server, context, page, problems } = await openPage(browser, "light");
  try {
    await page.evaluate(() => window.kaganStub.corruptNext("list"));
    await page.evaluate(() => window.kaganStub.push({ push: "changed", name: "Other", rev: 1 }));
    const refused = await page.waitForFunction(() => document.body.innerText.includes("does not understand"), null, { timeout: 4000 }).then(() => true, () => false);
    check("j. a reply that does not fit the protocol fails its call with a message", refused);
    await page.evaluate(() => window.kaganStub.clearCalls());
    await page.evaluate(() => window.kaganStub.push({ push: "changed", name: 5, rev: "x" }));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.kaganStub.calls());
    check("j. a push that does not fit causes no call", after.length === 0, JSON.stringify(after));
    check("j. malformed replies and pushes cause no page errors", problems.length === 0, problems.join(" | ").slice(0, 300));
  } finally {
    await context.close();
    server.close();
  }
}

async function panel(browser) {
  {
    const { server, context, page, problems } = await openPage(browser, "light", { pushContext: false });
    try {
      const picked = await page
        .waitForFunction(() => document.querySelector("select[aria-label='Send to']")?.value === "thr_here", null, { timeout: 4000 })
        .then(() => true, () => false);
      const label = await page.evaluate(() => document.querySelector("select[aria-label='Send to']")?.selectedOptions[0]?.textContent ?? "");
      check("h. a reopened page with no context push shows the thread on screen in the picker", picked && /This thread/.test(label), label || "no picker value");
      check("h. reopened page has no console errors", problems.length === 0, problems.join(" | ").slice(0, 300));
    } finally {
      await context.close();
      server.close();
    }
  }
  {
    const { server, context, page, problems } = await openPage(browser, "light");
    try {
      // Wait for the empty canvas to load first, so the first fit has happened before the agent edits.
      await page.waitForSelector(".cv-empty-line");
      await page.waitForTimeout(200);
      // The person pans away first. Then the agent's work lands far outside the view, and the page must bring it back.
      await page.mouse.move(600, 400);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(200);
      await page.evaluate(() => window.kaganStub.agentEdit("Main", [{ op: "add", element: { type: "box", x: 4000, y: 3000, w: 160, h: 80, label: "agent" } }]));
      await page.waitForFunction(() => document.querySelectorAll("svg.cv-svg [data-id]").length === 1, null, { timeout: 4000 });
      await page.waitForTimeout(250);
      const inside = await page.evaluate(() => {
        const frame = document.querySelector("svg.cv-svg").getBoundingClientRect();
        const box = document.querySelector("svg.cv-svg [data-id]").getBoundingClientRect();
        return { ok: box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom, box: [box.left, box.top, box.right, box.bottom].map(Math.round), frame: [frame.left, frame.top, frame.right, frame.bottom].map(Math.round) };
      });
      check("h. an agent edit far off screen is brought into view", inside.ok, JSON.stringify({ box: inside.box, frame: inside.frame }));
      check("h. the agent-edit reveal has no console errors", problems.length === 0, problems.join(" | ").slice(0, 300));
    } finally {
      await context.close();
      server.close();
    }
  }
  {
    const { server, context, page, problems } = await openPage(browser, "light");
    try {
      await page.setViewportSize({ width: 360, height: 760 });
      await page.waitForTimeout(300);
      const line = await page.locator(".cv-empty-line").first().innerText();
      check("i. the empty canvas names ⌘ and no longer says pinch", line.includes("⌘") && !/pinch/i.test(line), line);
      check("i. the empty-state copy has no console errors", problems.length === 0, problems.join(" | ").slice(0, 300));
    } finally {
      await context.close();
      server.close();
    }
  }
}

const chrome = (page) =>
  page.evaluate(() => {
    const height = (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().height ?? -1);
    return { tool: height(".cv-toolbar .cv-btn"), field: height(".cv-send input"), select: height(".cv-send select") };
  });
const view = (page) =>
  page.evaluate(() => {
    const svg = document.querySelector("svg.cv-svg");
    const [x, y, w] = (svg.getAttribute("viewBox") ?? "0 0 0 0").split(" ").map(Number);
    const frame = svg.getBoundingClientRect();
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, scale: Math.round((frame.width / w) * 1000) / 1000, zoom: document.querySelector(".cv-zoom")?.innerText ?? "", frameH: Math.round(frame.height), topH: Math.round(document.querySelector(".cv-top")?.getBoundingClientRect().height ?? 0), dockH: Math.round(document.querySelector(".cv-dock")?.getBoundingClientRect().height ?? 0) };
  });

async function sizing(browser) {
  {
    const { server, context, page, problems } = await openPage(browser, "light");
    try {
      await page.waitForSelector(".cv-send select");
      const wide = await chrome(page);
      await page.setViewportSize({ width: 600, height: 760 });
      await page.waitForTimeout(300);
      const narrow = await chrome(page);
      check("a. a 600 px panel with a mouse keeps the desktop control sizes", JSON.stringify(narrow) === JSON.stringify(wide), `wide ${JSON.stringify(wide)} · 600 px ${JSON.stringify(narrow)}`);
      check("a. the 600 px mouse panel has no console errors", problems.length === 0, problems.join(" | ").slice(0, 300));
    } finally {
      await context.close();
      server.close();
    }
  }
  {
    const { server, context, page, problems } = await openPage(browser, "light", { coarse: true });
    try {
      const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
      check("b. the touch test really reports a coarse pointer", coarse);
      await page.setViewportSize({ width: 600, height: 760 });
      await page.waitForTimeout(300);
      const touch = await chrome(page);
      check("b. a touch screen in a 600 px panel gets the big targets", touch.tool === 44 && touch.field === 40 && touch.select === 40, JSON.stringify(touch));
      check("b. the touch panel has no console errors", problems.length === 0, problems.join(" | ").slice(0, 300));
    } finally {
      await context.close();
      server.close();
    }
  }
}

const sameView = (a, b) => a.x === b.x && a.y === b.y && a.scale === b.scale && a.zoom === b.zoom;

async function narrowDraw(browser, { coarse = false } = {}) {
  const where = coarse ? "600 px touch panel" : "600 px panel";
  const { server, context, page, problems } = await openPage(browser, "light", { coarse });
  try {
    await page.setViewportSize({ width: 600, height: 760 });
    await page.waitForSelector(".cv-empty-line");
    await page.waitForTimeout(300);
    await page.mouse.click(300, 300); // empty canvas: focus the page, clear selection
    await page.keyboard.press("r");
    await page.waitForTimeout(300);
    const before = await view(page);
    await page.screenshot({ path: path.join(shotDir, `narrow-600-before-draw${coarse ? "-touch" : ""}.png`) });
    await page.evaluate(() => {
      window.kaganStub.clearCalls();
      window.__viewLog = [];
      const svg = document.querySelector("svg.cv-svg");
      new MutationObserver(() => window.__viewLog.push(svg.getAttribute("viewBox"))).observe(svg, { attributes: true });
    });
    await drag(page, { x: 150, y: 220 }, { x: 260, y: 300 });
    await waitCount(page, 1);
    const after = await view(page);
    const calls = await page.evaluate(() => window.kaganStub.calls());
    const moves = await page.evaluate(() => window.__viewLog);
    await page.screenshot({ path: path.join(shotDir, `narrow-600-after-draw${coarse ? "-touch" : ""}.png`) });
    const detail = `before ${JSON.stringify(before)} · after ${JSON.stringify(after)} · view changes ${moves.length} · calls ${calls.join(",")}`;
    check(`k. drawing a box in a ${where} does not move or re-center the view`, sameView(before, after), detail);
    check("k. the page does not refetch its own box", !calls.includes("open") && !calls.includes("list"), calls.join(","));
    // An arrow selects a row of options a box does not have, so the dock grows once the arrow is drawn.
    await page.keyboard.press("a");
    await page.waitForTimeout(200);
    const beforeArrow = await view(page);
    await page.evaluate(() => {
      window.kaganStub.clearCalls();
      window.__viewLog = [];
    });
    await drag(page, { x: 330, y: 250 }, { x: 450, y: 250 });
    await waitCount(page, 2);
    const afterArrow = await view(page);
    const arrowCalls = await page.evaluate(() => window.kaganStub.calls());
    check(`k. drawing an arrow in a ${where} does not move or re-center the view`, sameView(beforeArrow, afterArrow), `before ${JSON.stringify(beforeArrow)} · after ${JSON.stringify(afterArrow)} · calls ${arrowCalls.join(",")}`);
    check(`k. drawing in a ${where} has no console errors`, problems.length === 0, problems.join(" | ").slice(0, 300));
  } finally {
    await context.close();
    server.close();
  }
}

// A drawing saved before the page opens. Its first open fits it to the screen.
async function savedDrag(browser, width) {
  const seed = { Main: [{ op: "add", element: { type: "box", x: 400, y: 200, w: 160, h: 100, label: "saved" } }] };
  const { server, context, page, problems } = await openPage(browser, "light", { seed });
  try {
    await page.setViewportSize({ width, height: 760 });
    await page.waitForFunction(() => document.querySelectorAll("svg.cv-svg [data-id]").length >= 1, null, { timeout: 4000 }).catch(async (error) => {
      const state = await page.evaluate(() => ({ count: document.querySelectorAll("svg.cv-svg [data-id]").length, svg: document.querySelector("svg.cv-svg")?.innerHTML.slice(0, 300) ?? null, calls: window.kaganStub?.calls() ?? null }));
      throw new Error(`seeded box not shown: ${JSON.stringify(state).slice(0, 600)} ${problems.join(" | ").slice(0, 300)} ${error.message.slice(0, 80)}`);
    });
    await page.waitForTimeout(400);
    const before = await view(page);
    const onScreen = await page.evaluate(() => {
      const frame = document.querySelector("svg.cv-svg").getBoundingClientRect();
      const box = document.querySelector("svg.cv-svg [data-id]").getBoundingClientRect();
      return box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom;
    });
    check(`k. a saved drawing is fitted on screen after the panel is ${width} px`, onScreen, JSON.stringify(before));
    const grab = await page.evaluate(() => {
      const r = document.querySelector("svg.cv-svg [data-id]").getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      return { x, y, onBox: document.elementFromPoint(x, y)?.closest("[data-id]") !== null };
    });
    await page.evaluate(() => window.kaganStub.clearCalls());
    await drag(page, { x: grab.x, y: grab.y }, { x: grab.x + 60, y: grab.y });
    await page.waitForTimeout(400);
    const after = await view(page);
    const calls = await page.evaluate(() => window.kaganStub.calls());
    check(`k. dragging a saved box in a ${width} px panel does not move the view`, grab.onBox && sameView(before, after), `pressed on box ${grab.onBox} · before ${JSON.stringify(before)} · after ${JSON.stringify(after)} · calls ${calls.join(",")}`);
    check(`k. the saved-box drag in a ${width} px panel has no console errors`, problems.length === 0, problems.join(" | ").slice(0, 300));
  } finally {
    await context.close();
    server.close();
  }
}

async function undoDraw(browser) {
  const { server, context, page, problems } = await openPage(browser, "light");
  try {
    await page.setViewportSize({ width: 600, height: 760 });
    await page.waitForSelector(".cv-empty-line");
    await page.waitForTimeout(300);
    await page.mouse.click(300, 300);
    await page.keyboard.press("r");
    await page.waitForTimeout(300);
    await drag(page, { x: 150, y: 220 }, { x: 260, y: 300 });
    await waitCount(page, 1);
    const before = await view(page);
    await page.evaluate(() => window.kaganStub.clearCalls());
    await page.locator("[aria-label='Undo']").click();
    await page.waitForFunction(() => document.querySelectorAll("svg.cv-svg [data-id]").length === 0, null, { timeout: 4000 });
    await page.waitForTimeout(300);
    const after = await view(page);
    const calls = await page.evaluate(() => window.kaganStub.calls());
    check("k. undoing a box in a 600 px panel does not move the view", sameView(before, after), `before ${JSON.stringify(before)} · after ${JSON.stringify(after)} · calls ${calls.join(",")}`);
    check("k. undo asks the plugin once and does not refetch", calls.join(",") === "undo", calls.join(","));
    check("k. undo in a 600 px panel has no console errors", problems.length === 0, problems.join(" | ").slice(0, 300));
  } finally {
    await context.close();
    server.close();
  }
}

async function screenshots(browser, theme) {
  fs.mkdirSync(shotDir, { recursive: true });
  const { server, context, page, problems } = await openPage(browser, theme);
  try {
    await page.screenshot({ path: path.join(shotDir, `empty-${theme}.png`) });
    await drawDiagram(page);
    await page.screenshot({ path: path.join(shotDir, `diagram-${theme}.png`) });
    await page.locator(".cv-send").screenshot({ path: path.join(shotDir, `send-${theme}.png`) });
    await page.locator("[aria-label='Main menu']").click();
    await page.screenshot({ path: path.join(shotDir, `menu-${theme}.png`) });
    check(`e. screenshots saved (${theme})`, true, shotDir);
    check(`e. no console errors while drawing (${theme})`, problems.length === 0, problems.join(" | ").slice(0, 300));
  } finally {
    await context.close();
    server.close();
  }
}

const browser = await chromium.launch();
try {
  await functional(browser);
  await panel(browser);
  await sizing(browser);
  await narrowDraw(browser);
  await narrowDraw(browser, { coarse: true });
  await savedDrag(browser, 600);
  await savedDrag(browser, 1100);
  await undoDraw(browser);
  await bridge(browser);
  await screenshots(browser, "light");
  await screenshots(browser, "dark");
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
