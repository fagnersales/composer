#!/usr/bin/env node
// Composer capture helper — Playwright as a library, one headless Chromium
// per invocation, so parallel builders never share browser state (shared
// browser MCPs deadlock under concurrent use; this is the fix).
//
// usage:
//   node capture.mjs shot     <url> <out.png>  [--full] [--timeout ms]
//   node capture.mjs record   <url> <out.webm> <driver.mjs> [--timeout ms]
//   node capture.mjs snapshot <url> <out.json> [--shot out.png] [--timeout ms]
//
// shot      full-page (--full) or viewport screenshot, downscaled to ≤1280px wide.
// record    runs the driver script against the page while Playwright records
//           video; driver default-exports async (page) => { ...clicks/types }.
//           The webm plays directly in a <video> tag on the board.
// snapshot  one omnibus JSON for an agent to "look at its work": url, title,
//           visible text, interactive elements, console + network tails —
//           truncation budgets follow t3code's battle-tested numbers
//           (20k chars text, 200 elements, 200 console, 200 network, 1280px).
//           --shot additionally writes a screenshot (path goes in the JSON).
//
// Exit 0 on success; nonzero with a one-line error on stderr otherwise.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TEXT_CAP = 20_000;
const ELEMENT_CAP = 200;
const LOG_CAP = 200;
const VIEWPORT = { width: 1280, height: 800 };

const [, , verb, url, out, ...rest] = process.argv;
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--full") flags.full = true;
  else if (rest[i] === "--timeout") flags.timeout = Number(rest[++i]);
  else if (rest[i] === "--shot") flags.shot = rest[++i];
  else positional.push(rest[i]);
}
const TIMEOUT = flags.timeout || 30_000;

if (!verb || !url || !out || !["shot", "record", "snapshot"].includes(verb)) {
  console.error(
    "usage: capture.mjs shot <url> <out.png> [--full] | record <url> <out.webm> <driver.mjs> | snapshot <url> <out.json> [--shot out.png]"
  );
  process.exit(2);
}

// Headless video has no OS cursor, so recorded clicks look like telekinesis.
// Injected into every recorded page: an arrow that follows Playwright's mouse
// events (hidden until the first move) plus a click ripple.
const CURSOR_JS = `(() => {
  if (window.__capCursor) return; window.__capCursor = 1;
  const mk = () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;pointer-events:none;z-index:2147483647;opacity:0;transition:transform .05s linear;will-change:transform;';
    c.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M5.5 3.2v16.9l4.5-4.4 2.6 6 2.8-1.2-2.6-6h6.3z" fill="#000" stroke="#fff" stroke-width="1.5"/></svg>';
    document.documentElement.appendChild(c);
    let x = 0, y = 0;
    addEventListener('mousemove', e => { x = e.clientX; y = e.clientY; c.style.opacity = '1'; c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }, true);
    addEventListener('mousedown', () => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;width:28px;height:28px;border-radius:50%;border:2px solid #3b82f6;left:' + (x - 14) + 'px;top:' + (y - 14) + 'px;opacity:.9;transform:scale(.4);transition:transform .35s ease-out,opacity .35s ease-out;';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 400);
    }, true);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', mk) : mk();
})()`;

const browser = await chromium.launch();
let exitCode = 0;
try {
  const ctxOpts = { viewport: VIEWPORT };
  if (verb === "record")
    ctxOpts.recordVideo = { dir: path.dirname(path.resolve(out)), size: VIEWPORT };
  const context = await browser.newContext(ctxOpts);
  if (verb === "record") await context.addInitScript({ content: CURSOR_JS });
  const page = await context.newPage();

  const consoleTail = [];
  const networkTail = [];
  if (verb === "snapshot") {
    page.on("console", (m) => {
      consoleTail.push({ type: m.type(), text: m.text().slice(0, 500) });
      if (consoleTail.length > LOG_CAP) consoleTail.shift();
    });
    page.on("response", (r) => {
      networkTail.push({ url: r.url().slice(0, 300), method: r.request().method(), status: r.status() });
      if (networkTail.length > LOG_CAP) networkTail.shift();
    });
    page.on("requestfailed", (r) => {
      networkTail.push({ url: r.url().slice(0, 300), method: r.method(), failed: r.failure()?.errorText || "failed" });
      if (networkTail.length > LOG_CAP) networkTail.shift();
    });
  }

  await page.goto(url, { waitUntil: "load", timeout: TIMEOUT });
  // settle: give SPAs a beat, but never hang on long-polling pages
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

  if (verb === "shot") {
    await page.screenshot({ path: out, fullPage: !!flags.full });
  } else if (verb === "record") {
    const driverPath = positional[0];
    if (!driverPath) throw new Error("record needs a driver.mjs (default-exports async (page) => {})");
    const driver = (await import(pathToFileURL(path.resolve(driverPath)).href)).default;
    if (typeof driver !== "function") throw new Error("driver has no default-exported function");
    await driver(page);
    await page.waitForTimeout(600); // trailing frames so the last action is visible
    const video = page.video();
    await context.close(); // finalizes the video file
    await video.saveAs(out);
    await video.delete().catch(() => {});
  } else if (verb === "snapshot") {
    const data = await page.evaluate(
      ([textCap, elCap]) => {
        const els = [];
        const nodes = document.querySelectorAll(
          "a,button,input,select,textarea,summary,[role],[onclick],[tabindex]"
        );
        for (const el of nodes) {
          if (els.length >= elCap) break;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const name = (
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("title") ||
            (el.innerText || el.value || "").trim()
          ).slice(0, 80);
          els.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute("role") || undefined,
            name: name || undefined,
            id: el.id || undefined,
            testid: el.getAttribute("data-testid") || undefined,
            box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          });
        }
        return {
          title: document.title,
          visibleText: (document.body?.innerText || "").slice(0, textCap),
          interactiveElements: els,
        };
      },
      [TEXT_CAP, ELEMENT_CAP]
    );
    const payload = { url: page.url(), ...data, console: consoleTail, network: networkTail };
    if (flags.shot) {
      await page.screenshot({ path: flags.shot });
      payload.screenshot = path.resolve(flags.shot);
    }
    fs.writeFileSync(out, JSON.stringify(payload, null, 1));
  }
} catch (e) {
  console.error(`capture ${verb} failed: ${e.message}`);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
