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

async function openPage(browser, theme, { pushContext = true } = {}) {
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
  await page.addInitScript({ content: stubJs });
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
    // a. The note field takes focus and typing.
    await page.click("input[aria-label='Note for the agent']");
    await page.keyboard.type("hello there");
    const note = await page.inputValue("input[aria-label='Note for the agent']");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("a. note field: click focuses it and typing writes into it", note === "hello there" && focused === "Note for the agent", `value="${note}", focus="${focused}"`);

    // b. Keys.
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

    // c. Box, arrow, label, undo.
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

    // b. Select, duplicate, nudge, delete.
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

    // Undo the nudge and the deletion, then clear by Delete on the marquee selection.
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Meta+z");
    await waitCount(page, 4);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Delete");
    await waitCount(page, 0);
    check("b. Cmd+A then Delete empties the canvas", (await boxCount(page)) === 0);

    // Copy image: the page sends PNG pieces through the plugin.
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

    // Send: the note and the command go to the chosen thread.
    await page.locator("select[aria-label='Send to']").selectOption("thr_other");
    await page.fill("input[aria-label='Note for the agent']", "Tidy the labels");
    await page.locator("button", { hasText: /^Send$/ }).click();
    await page.waitForFunction(() => window.kaganStub.sent().length === 1);
    const sent = await page.evaluate(() => window.kaganStub.sent()[0]);
    check("f. Send passes the note and thread to the plugin", sent.threadId === "thr_other" && sent.note === "Tidy the labels", JSON.stringify(sent));
    const sendCaption = await page.locator(".cv-caption").innerText();
    check("f. Send panel says it pastes without pressing Enter", /Pastes your note/.test(sendCaption), sendCaption);

    // Delete asks once; Keep canvas leaves it alone.
    await page.locator("[aria-label='Main menu']").click();
    await page.getByRole("menuitem", { name: "Delete this canvas" }).click();
    const askedOnce = await page.getByRole("alertdialog").count();
    await page.getByRole("button", { name: "Keep canvas" }).click();
    const kept = await page.evaluate(() => Object.keys(window.kaganStub.docs()).includes("Main"));
    check("f. Delete asks, and Keep canvas leaves it", askedOnce === 1 && kept);

    // Fonts load from the page itself.
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

// Panel behaviour that needs no drawing: the picker on reopen, the reveal after an agent edit, and the empty-state copy.
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
  await screenshots(browser, "light");
  await screenshots(browser, "dark");
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
