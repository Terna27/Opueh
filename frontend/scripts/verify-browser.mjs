#!/usr/bin/env node
/**
 * Real-browser verification for the Opueh frontend.
 *
 * WHY THIS EXISTS
 *
 * A green unit suite is not evidence that the auth flow works. The claims this
 * milestone rests on are about a real browser talking to a real API: that a
 * cookie is unreadable from JavaScript, that a session survives an expired
 * access token without the user noticing, and — the one that justifies the
 * whole single-flight design — that two concurrent requests cannot between
 * them replay a refresh token and revoke the session.
 *
 * None of that is reachable from jsdom. M3 drove a real Chrome over the
 * DevTools Protocol and threw the scripts away, so the work had to be redone
 * from nothing. This file is that work, committed.
 *
 * It uses only what Node already ships: `fetch` and the built-in `WebSocket`.
 * No puppeteer, no playwright, no new dependency.
 *
 * USAGE
 *
 *   node scripts/verify-browser.mjs
 *
 * Requires the Go API (default http://localhost:8080) and this app's dev
 * server (default http://localhost:3000) to be running. Override with APP_URL,
 * CDP_PORT, CHROME, VERIFY_TIMEOUT_MS.
 *
 * Exit code is 0 only when every check passes.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
const CHROME_BIN = process.env.CHROME ?? "google-chrome";
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 20_000);

const APP_HOST = new URL(APP_URL).hostname;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * A minimal DevTools Protocol client.
 * ------------------------------------------------------------------ */

class CdpSession {
  #ws;
  #nextId = 1;
  #pending = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const entry = message.id ? this.#pending.get(message.id) : undefined;
      if (!entry) return;

      this.#pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`${message.error.message} (code ${message.error.code})`));
      } else {
        entry.resolve(message.result);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`CDP connection failed: ${wsUrl}`)), {
        once: true,
      });
    });
    return new CdpSession(ws);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.#ws.close();
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------------------ *
 * Browser lifecycle.
 * ------------------------------------------------------------------ */

async function launchChrome(userDataDir) {
  const args = [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-features=Translate,BackForwardCache",
    "about:blank",
  ];

  const child = spawn(CHROME_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited early (code ${child.exitCode}):\n${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (response.ok) return child;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Chrome did not expose CDP on ${CDP_PORT} within ${TIMEOUT_MS}ms:\n${stderr}`);
    }
    await sleep(150);
  }
}

/** A fresh tab, connected and with the domains this harness needs enabled. */
async function openPage() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`could not open a tab: HTTP ${response.status}`);
  }

  const target = await response.json();
  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Network.enable");
  return session;
}

/* ------------------------------------------------------------------ *
 * Page helpers.
 * ------------------------------------------------------------------ */

async function evaluate(session, expression) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    const description = exceptionDetails.exception?.description ?? exceptionDetails.text;
    throw new Error(`page threw: ${description}`);
  }
  return result.value;
}

/** Poll an expression until it is truthy, or fail with what was being waited for. */
async function waitFor(session, expression, description, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await evaluate(session, expression);
    } catch {
      value = false; // mid-navigation, or the module has not hydrated yet
    }
    if (value) return value;

    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await sleep(150);
  }
}

/**
 * Navigate and wait until the page is genuinely interactive.
 *
 * The hydration wait is not optional polish — see SESSION_RESOLVED. Every call
 * site that later types into a form or clicks a button depends on it.
 */
async function goto(session, url) {
  await session.send("Page.navigate", { url });
  await waitFor(session, "document.readyState === 'complete'", `load of ${url}`);
  await waitFor(session, SESSION_RESOLVED, `${url} to hydrate`);
}

/**
 * Fill a field by the text of its label.
 *
 * The value goes in through the prototype's native setter and an `input`
 * event, because React tracks the value on the DOM node: assigning
 * `field.value` directly is seen by React as no change at all, and the
 * component state never updates.
 *
 * Matching on the label rather than a CSS selector keeps this honest — it
 * fails if a label is renamed, which is exactly when a check should stop
 * passing.
 */
function fillByLabel(labelText, value) {
  return `(() => {
    const wanted = ${JSON.stringify(labelText)};
    const label = [...document.querySelectorAll("label")].find(
      (element) => element.textContent.trim().startsWith(wanted),
    );
    if (!label) throw new Error("no label starting with " + wanted);
    const field = label.htmlFor
      ? document.getElementById(label.htmlFor)
      : label.querySelector("input,textarea");
    if (!field) throw new Error("no field for label " + wanted);
    const proto = field.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return field.value;
  })()`;
}

const SUBMIT_FORM = `(() => {
  const button = document.querySelector('form button[type="submit"]');
  if (!button) throw new Error("no submit button on this page");
  button.click();
  return true;
})()`;

/** The current value of the field belonging to a label. */
function readByLabel(labelText) {
  return `(() => {
    const wanted = ${JSON.stringify(labelText)};
    const label = [...document.querySelectorAll("label")].find(
      (element) => element.textContent.trim().startsWith(wanted),
    );
    if (!label) throw new Error("no label starting with " + wanted);
    const field = label.htmlFor
      ? document.getElementById(label.htmlFor)
      : label.querySelector("input,textarea");
    if (!field) throw new Error("no field for label " + wanted);
    return field.value;
  })()`;
}

/**
 * Fill a field and do not return until the value survives a render.
 *
 * A single fill is not enough. `waitFor('form input')` is satisfied by the
 * server-rendered HTML, which arrives before React hydrates; a value written
 * into the DOM at that moment is discarded when React renders the controlled
 * input from its own (still empty) state. The symptom is specific and
 * misleading — the FIRST field on a form submits empty while the rest are
 * fine, which reads as a validation bug rather than a timing one.
 *
 * So the fill is retried until the DOM agrees it stuck. If the value can never
 * be set, that is reported with what it kept reverting to, rather than being
 * left to surface later as a bogus validation error.
 */
async function fillField(session, labelText, value, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;

  for (;;) {
    await evaluate(session, fillByLabel(labelText, value));
    await sleep(100);
    lastValue = await evaluate(session, readByLabel(labelText));
    if (lastValue === value) return;

    if (Date.now() > deadline) {
      throw new Error(
        `could not set "${labelText}" — it kept reverting to ${JSON.stringify(lastValue)}`,
      );
    }
  }
}

/**
 * The header's session controls.
 *
 * Scoped to the header on purpose. The obvious selector — `a[href="/login"]`
 * anywhere on the page — also matches the "Already have an account? Log in"
 * link the register page server-renders in its body, so it is true before a
 * single byte of JavaScript has run. Anything built on it passes pre-hydration
 * and then interacts with a dead page.
 */
const AUTH_NAV = `document.querySelector('header nav[aria-label="Primary"]')`;

/**
 * The signed-in marker is the Log out control — it exists in no other state.
 */
const IS_SIGNED_IN = `!!${AUTH_NAV} && [...${AUTH_NAV}.querySelectorAll("button")].some(
  (button) => button.textContent.trim() === "Log out",
)`;

const IS_SIGNED_OUT = `!!${AUTH_NAV} && !!${AUTH_NAV}.querySelector('a[href="/login"]')`;

/**
 * The harness's hydration signal, and it is worth explaining why it is this
 * rather than something React-specific.
 *
 * `AuthNav` is a Client Component whose signed-in/signed-out states are only
 * reachable by running an effect; the server cannot know the session, so it
 * always ships a loading placeholder. The moment a Log in link or a Log out
 * button appears in the header, the page has executed JavaScript, hydrated and
 * completed its first fetch.
 *
 * That matters because `document.readyState === "complete"` — and even the
 * presence of a rendered form — says nothing about hydration. Interacting
 * before it finishes silently does nothing: React has no listener yet, so the
 * fill is ignored while the DOM keeps the value, and the form then submits
 * empty and reports a validation error that looks like an application bug.
 */
const SESSION_RESOLVED = `(${IS_SIGNED_IN}) || (${IS_SIGNED_OUT})`;

/**
 * The distinct paths the tab passes through over a window.
 *
 * Used to tell "navigation never happened" apart from "navigation happened
 * and something moved it back" — the same final URL, two different bugs.
 */
async function samplePaths(session, windowMs) {
  const seen = [];
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const path = await evaluate(session, "location.pathname");
    if (seen[seen.length - 1] !== path) seen.push(path);
    await sleep(200);
  }
  return seen;
}

async function register(session, { email, username, password }) {
  await goto(session, `${APP_URL}/register`);
  await waitFor(session, "!!document.querySelector('form input')", "the register form");
  await fillField(session, "Email", email);
  await fillField(session, "Username", username);
  await fillField(session, "Password", password);
  await evaluate(session, SUBMIT_FORM);
  await waitFor(session, IS_SIGNED_IN, "the header to show a signed-in session");
}

/** The session cookies currently held for the app's host. */
async function sessionCookies(session) {
  const { cookies } = await session.send("Network.getCookies", { urls: [APP_URL] });
  return cookies.filter((cookie) => cookie.name.includes("opueh_"));
}

/** Overwrite a cookie, including httpOnly ones, which page script cannot. */
async function setCookie(session, name, value) {
  const { success } = await session.send("Network.setCookie", {
    name,
    value,
    domain: APP_HOST,
    path: "/",
    httpOnly: true,
  });
  if (!success) throw new Error(`could not set cookie ${name}`);
}

async function reload(session) {
  await session.send("Page.reload", { ignoreCache: true });
  await waitFor(session, "document.readyState === 'complete'", "reload");
  await waitFor(session, SESSION_RESOLVED, "the reloaded page to hydrate");
}

/**
 * The interest picker's rendered state.
 *
 * `ceiling` is parsed out of the picker's own count line rather than being
 * hardcoded here. That keeps the number in one place — the component's — and
 * turns "the UI promises 10" and "the backend accepts 10" into two statements
 * this harness can compare, rather than one number copied twice.
 */
const READ_PICKER = `(() => {
  const boxes = [...document.querySelectorAll('fieldset input[type="checkbox"]')];
  const paragraphs = [...document.querySelectorAll("fieldset p[id]")];
  const count = (paragraphs.find((p) => !p.hasAttribute("role"))?.textContent ?? "").trim();
  const ceiling = Number(/of (\\d+) selected/.exec(count)?.[1]);
  const label = (box) => box.closest("label").querySelector("span span").textContent.trim();
  return {
    offered: boxes.length,
    checked: boxes.filter((box) => box.checked).length,
    checkedLabels: boxes.filter((box) => box.checked).map(label),
    count,
    ceiling,
    refusal: (paragraphs.find((p) => p.getAttribute("role") === "status")?.textContent ?? "").trim(),
  };
})()`;

function readPicker(session) {
  return evaluate(session, READ_PICKER);
}

/**
 * Ensure the categories at the given indexes are selected, one at a time.
 *
 * Idempotent, and that is not a convenience — clicking a checkbox that is
 * already on turns it OFF, so a helper that clicked unconditionally would
 * deselect whatever a previous check had chosen and quietly verify a smaller
 * selection than it asked for.
 *
 * Sequential, and it waits for the DOM to agree after each click, because the
 * picker derives its `chosen` set from the `selected` prop the parent owns. A
 * second click issued before React has re-rendered is computed against the
 * stale set and REPLACES the selection instead of extending it — so a loop of
 * ten clicks in one task leaves exactly one category chosen, and the check
 * would report a bug in the harness as a bug in the app.
 *
 * The wait accepts either outcome, because a click that the picker refuses
 * changes the refusal message rather than the selection.
 */
async function selectInterests(session, indexes, timeoutMs = TIMEOUT_MS) {
  for (const index of indexes) {
    const before = await readPicker(session);

    const wasChecked = await evaluate(
      session,
      `(() => {
        const box = [...document.querySelectorAll('fieldset input[type="checkbox"]')][${index}];
        if (!box) throw new Error("no category at index ${index}");
        if (box.checked) return true;
        box.click();
        return false;
      })()`,
    );
    if (wasChecked) continue;

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const now = await readPicker(session);
      if (now.checked !== before.checked || now.refusal !== before.refusal) break;
      if (Date.now() > deadline) {
        throw new Error(`clicking category ${index} changed nothing at all`);
      }
      await sleep(50);
    }
  }
}

/**
 * Click a button by its exact visible text.
 *
 * The onboarding Continue button is not a submit inside a form — it is a
 * `type="button"` with an onClick — so SUBMIT_FORM cannot reach it, and
 * matching on the text keeps this honest the way the label matching does.
 */
async function clickButton(session, text) {
  await evaluate(
    session,
    `(() => {
      const wanted = ${JSON.stringify(text)};
      const button = [...document.querySelectorAll("button")].find(
        (node) => node.textContent.trim() === wanted,
      );
      if (!button) throw new Error("no button reading " + wanted);
      button.click();
      return true;
    })()`,
  );
}

/** The text a page is actually showing, as a reader would see it. */
function readBody(session) {
  return evaluate(session, "document.body.innerText");
}

/** The public profile's heading and bio, read from the rendered article. */
const READ_PUBLIC_PROFILE = `(() => {
  const article = document.querySelector("article");
  if (!article) return null;
  const bio = [...article.querySelectorAll("p")].find(
    (p) => p.className.includes("whitespace-pre-line"),
  );
  return {
    heading: article.querySelector("h1")?.textContent ?? null,
    bio: bio?.textContent ?? null,
  };
})()`;

/* ------------------------------------------------------------------ *
 * Checks.
 * ------------------------------------------------------------------ */

const results = [];

/** The tab a failure should be described from. Set once the browser is up. */
let activePage = null;

/**
 * Every label on the page and the field it points at.
 *
 * A form-driven failure usually comes down to the harness and the page
 * disagreeing about which element a label names. Printing the resolved
 * pairing — and the value each control actually holds — turns that from a
 * guess into a fact.
 */
const DESCRIBE_FIELDS = `(() => {
  const rows = [...document.querySelectorAll("label")].map((label) => {
    const field = label.htmlFor
      ? document.getElementById(label.htmlFor)
      : label.querySelector("input,textarea,select");
    if (!field) return \`  \${JSON.stringify(label.textContent.trim())} -> (nothing)\`;
    return \`  \${JSON.stringify(label.textContent.trim())} -> <\${field.tagName.toLowerCase()} id=\${JSON.stringify(field.id)} name=\${JSON.stringify(field.name)} type=\${JSON.stringify(field.type)}> value=\${JSON.stringify(field.value)}\`;
  });
  return rows.join("\\n") || "  (no labels on this page)";
})()`;

/**
 * What the failing tab was actually showing.
 *
 * Without this a failure reads "timed out waiting for the header" and gives no
 * way to tell a rejected registration from a page that never hydrated — the
 * two have completely different causes and the same symptom.
 */
async function describePage() {
  if (!activePage) return "(no page open)";

  try {
    const [url, text, fields] = await Promise.all([
      evaluate(activePage, "location.href"),
      evaluate(activePage, "document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 800)"),
      evaluate(activePage, DESCRIBE_FIELDS),
    ]);
    return [
      `at ${url}`,
      "          --- form fields ---",
      fields
        .split("\n")
        .map((line) => `        ${line}`)
        .join("\n"),
      "          --- page text ---",
      text
        .split("\n")
        .map((line) => `          ${line}`)
        .join("\n"),
    ].join("\n");
  } catch (error) {
    return `(could not read the page: ${error.message})`;
  }
}

/** Record a check's outcome. A thrown error is a failure, with its reason. */
async function check(name, body) {
  process.stdout.write(`\n▸ ${name}\n`);
  try {
    const detail = await body();
    results.push({ name, pass: true });
    process.stdout.write(`  PASS${detail ? ` — ${detail}` : ""}\n`);
  } catch (error) {
    const page = await describePage();
    results.push({ name, pass: false, reason: error.message });
    process.stdout.write(`  FAIL — ${error.message}\n        ${page}\n`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const userDataDir = await mkdtemp(join(tmpdir(), "opueh-verify-"));
  const chrome = await launchChrome(userDataDir);
  process.stdout.write(`Chrome up on port ${CDP_PORT} (profile ${userDataDir})\n`);

  const stamp = Date.now();
  const username = `verify${stamp}`;
  const password = "correct horse battery staple";

  const page = await openPage();
  activePage = page;

  try {
    /* -------------------------------------------------- check 1 */
    await check("registering signs the user in, and no token is readable from JavaScript", async () => {
      await register(page, { email: `${username}@example.com`, username, password });

      // Where registration leaves the user, and it is deliberately a specific
      // place rather than the home page. Registering is the one moment the app
      // knows for certain that this person has never chosen any interests, so
      // it is the only point at which the question can be asked without
      // nagging anyone who cleared their selection on purpose.
      await waitFor(
        page,
        `location.pathname === "/onboarding"`,
        "registration to land on /onboarding",
      );

      // Sampled rather than read once, and the LAST sample is what counts.
      // "Never navigated" and "navigated and was pulled back" both end on the
      // same URL and are entirely different bugs — `includes` would call the
      // second one a pass.
      const paths = await samplePaths(page, 2000);
      assert(
        paths[paths.length - 1] === "/onboarding",
        `registration did not settle on /onboarding; paths seen: ${JSON.stringify(paths)}`,
      );

      const cookies = await sessionCookies(page);
      assert(cookies.length === 2, `expected 2 session cookies, got ${cookies.length}`);
      assert(
        cookies.every((cookie) => cookie.httpOnly),
        "a session cookie is not HttpOnly",
      );
      assert(
        cookies.every((cookie) => cookie.sameSite === "Lax"),
        "a session cookie is not SameSite=Lax",
      );

      // The claim the whole proxy design exists to make: JavaScript cannot
      // see the token, so an XSS bug cannot exfiltrate one that outlives
      // the page.
      const readable = await evaluate(page, "document.cookie");
      assert(
        !/opueh_(access|refresh)/.test(readable),
        `document.cookie exposed a session cookie: ${readable}`,
      );

      // And nowhere else in the browser, either.
      const storage = await evaluate(
        page,
        `JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)])`,
      );
      assert(
        !/opueh|token/i.test(storage),
        `token-shaped value found in web storage: ${storage}`,
      );

      const names = cookies.map((cookie) => cookie.name).sort().join(", ");
      return `cookies ${names}; httpOnly, SameSite=Lax, invisible to script`;
    });

    /* --------------------------------------------- M5: onboarding round trip */
    await check("onboarding saves a selection, and a reload shows it still selected", async () => {
      // Continues from check 1, which left a brand-new account on /onboarding
      // with nothing chosen.
      await waitFor(
        page,
        `location.pathname === "/onboarding"`,
        "the onboarding page",
      );
      await waitFor(
        page,
        `document.querySelectorAll('fieldset input[type="checkbox"]').length > 0`,
        "the category picker to load",
      );

      const offered = await readPicker(page);
      assert(
        offered.checked === 0,
        `a brand-new account arrived with something already selected: ${offered.count}`,
      );

      const chosen = Math.min(3, offered.offered);
      await selectInterests(page, [0, 1, 2].slice(0, chosen));

      const picked = await readPicker(page);
      assert(picked.checked === chosen, `expected ${chosen} selected, got ${picked.count}`);
      assert(
        picked.count.startsWith(`${chosen} of `),
        `the picker's own count line disagrees with the boxes: ${picked.count}`,
      );

      await clickButton(page, "Continue");
      await waitFor(page, `location.pathname === "/"`, "onboarding to finish");

      // The claim is that the selection was STORED, not merely held in the
      // form, and a reload is the only thing that tells those apart: the
      // component would happily still show its own state without any of it
      // having reached the database.
      await goto(page, `${APP_URL}/onboarding`);
      await waitFor(
        page,
        `document.querySelectorAll('fieldset input[type="checkbox"]').length > 0`,
        "the category picker to load",
      );

      const after = await readPicker(page);
      assert(
        after.checkedLabels.join(", ") === picked.checkedLabels.join(", "),
        `expected ${JSON.stringify(picked.checkedLabels)} still selected, got ${JSON.stringify(after.checkedLabels)}`,
      );

      return `saved ${picked.checked} of ${after.offered} (${picked.checkedLabels.join(", ")}); a reload preselected the same ones`;
    });

    /* -------------------------------------------------- check 2 */
    await check("an expired access token is refreshed silently, with no visible sign-out", async () => {
      // Where the user is standing before the token is killed. Captured rather
      // than hardcoded: this check is about the page NOT moving, and writing a
      // destination into it would make it a second, weaker copy of check 1.
      const before = await evaluate(page, "location.pathname");

      // Simulate the access token expiring: the refresh token stays valid,
      // which is exactly the state 15 minutes after a login.
      await setCookie(page, "opueh_access", "expired-or-tampered-access-token");
      await reload(page);

      await waitFor(
        page,
        IS_SIGNED_IN,
        "the session to be restored after a reload with a dead access token",
      );

      const cookie = (await sessionCookies(page)).find((c) => c.name === "opueh_access");
      assert(cookie, "the access cookie is missing after the refresh");
      assert(
        cookie.value !== "expired-or-tampered-access-token",
        "the access cookie was not replaced by the refresh",
      );

      // "Silently" is the claim, so the URL is part of the assertion: a
      // refresh that bounced the user through the login page and back would
      // have restored the session while still being visible.
      const path = await evaluate(page, "location.pathname");
      assert(path === before, `expected to remain on ${before}, but ended up on ${path}`);

      return `reloaded ${before} with a dead access cookie; session restored and the cookie rotated`;
    });

    /* -------------------------------------------------- check 3 */
    await check("two concurrent refreshes do not replay a refresh token", async () => {
      // The highest-value check in the suite.
      //
      // The backend rotates refresh tokens and treats a replayed one as
      // theft evidence that revokes the entire session. Both requests below
      // therefore present the SAME refresh cookie at almost the same moment.
      // If single-flight failed, the second would present a token the first
      // had already consumed, and the session would be revoked — both
      // requests would fail and the user would be signed out.
      await setCookie(page, "opueh_access", "expired-again");

      const statuses = await evaluate(
        page,
        `Promise.all([fetch("/api/auth/me"), fetch("/api/auth/me")]).then(
           (responses) => responses.map((response) => response.status),
         )`,
      );

      assert(
        JSON.stringify(statuses) === JSON.stringify([200, 200]),
        `expected both concurrent requests to succeed, got ${JSON.stringify(statuses)}`,
      );

      // And the session is genuinely still alive, not merely un-revoked.
      await reload(page);
      await waitFor(page, IS_SIGNED_IN, "the session to survive two concurrent refreshes");
      return "two simultaneous 401s produced one rotation; both retries returned 200";
    });

    /* -------------------------------------------------- check 4 */
    await check("two browser tabs refreshing at once keep the session", async () => {
      await setCookie(page, "opueh_access", "expired-in-both-tabs");

      const second = await openPage();
      try {
        await Promise.all([reload(page), goto(second, APP_URL)]);
        await waitFor(page, IS_SIGNED_IN, "the first tab to stay signed in");
        await waitFor(second, IS_SIGNED_IN, "the second tab to stay signed in");
        return "both tabs loaded with a dead access cookie and both stayed signed in";
      } finally {
        second.close();
      }
    });

    /* -------------------------------------------------- check 5 */
    await check("a rejected refresh token ends the session and clears the cookies", async () => {
      // A refresh token the backend will not accept. This is the one case
      // where the session genuinely is over, so it is the one case that is
      // allowed to clear it.
      await setCookie(page, "opueh_refresh", "not-a-real-refresh-token");
      await setCookie(page, "opueh_access", "not-a-real-access-token");
      await reload(page);

      await waitFor(page, IS_SIGNED_OUT, "the session to end and the Log in link to appear");

      const remaining = await sessionCookies(page);
      assert(
        remaining.length === 0,
        `the session cookies were not cleared: ${remaining.map((c) => c.name).join(", ")}`,
      );

      // And the user is not left standing on a protected page they can no
      // longer use. This went untested through Milestone 4 — there was no
      // protected route to be sent away from — so it is the guard's redirect,
      // and the `next` it carries, that are being asserted here.
      await waitFor(page, `location.pathname === "/login"`, "the guard to redirect to /login");
      const next = await evaluate(
        page,
        `new URLSearchParams(location.search).get("next")`,
      );
      assert(
        next === "/onboarding",
        `expected the guard to carry next=/onboarding, got ${JSON.stringify(next)}`,
      );

      return "session cleared, cookies gone, and the guard redirected /onboarding -> /login?next=/onboarding";
    });

    /* -------------------------------------- M5: a protected page remembers you */
    await check("a signed-out visit to a protected page returns there after logging in", async () => {
      // Check 5 left a real, signed-out account behind — the cookies were
      // cleared, so this is a genuine signed-out visit rather than a simulated
      // one. That matters: the whole point is what the app does for someone
      // with no session at all.
      await goto(page, `${APP_URL}/settings/profile`);

      // Before any JavaScript runs, the proxy has already redirected. It is the
      // only layer that can, and it does it knowing where the visitor was
      // headed rather than dropping them on a bare login page.
      await waitFor(page, `location.pathname === "/login"`, "the redirect to /login");
      const next = await evaluate(
        page,
        `new URLSearchParams(location.search).get("next")`,
      );
      assert(
        next === "/settings/profile",
        `expected next=/settings/profile, got ${JSON.stringify(next)}`,
      );
      assert(
        await evaluate(page, IS_SIGNED_OUT),
        "expected to be signed out for this visit, but the header shows a session",
      );

      await fillField(page, "Email or username", username);
      await fillField(page, "Password", password);
      await evaluate(page, SUBMIT_FORM);

      // And the round trip lands back where they were going. Without the `next`
      // plumbing this check would still pass on the sign-in and then be sitting
      // on the home page, which is the failure being ruled out.
      await waitFor(
        page,
        `location.pathname === "/settings/profile"`,
        "the return to /settings/profile after logging in",
      );
      await waitFor(page, IS_SIGNED_IN, "the header to show a signed-in session");

      return "signed out at /settings/profile -> /login?next= -> logged in -> back at /settings/profile";
    });

    /* --------------------------- M5: the account area writes and reads back */
    await check("an edited display name and bio appear on the public profile", async () => {
      const displayName = `Ada Verify ${stamp}`;
      const bio = "First line.\nSecond line.";

      await goto(page, `${APP_URL}/settings/profile`);
      await waitFor(page, "!!document.querySelector('form input')", "the profile form");

      await fillField(page, "Display name", displayName);
      await fillField(page, "Bio", bio);

      // The form only submits the fields the user actually changed, so this
      // also proves the bio is treated as changed and not silently dropped.
      const nothingToSave = `[...document.querySelectorAll("span")].some(
        (node) => node.textContent.trim() === "Nothing to save yet.",
      )`;
      await waitFor(page, `!(${nothingToSave})`, "the form to notice the edits");

      await evaluate(page, SUBMIT_FORM);
      // The hint returns only once the server has echoed the saved profile back
      // and the form no longer differs from it — so this waits on the save
      // having landed, not on a timer.
      await waitFor(page, nothingToSave, "the save to be accepted");

      await goto(page, `${APP_URL}/u/${username}`);
      await waitFor(page, "!!document.querySelector('article')", "the public profile");

      const shown = await evaluate(page, READ_PUBLIC_PROFILE);
      assert(shown, "the public profile rendered no article");
      assert(
        shown.heading === displayName,
        `expected the heading to read ${JSON.stringify(displayName)}, got ${JSON.stringify(shown.heading)}`,
      );
      assert(
        shown.bio === bio,
        `expected the bio to survive intact, got ${JSON.stringify(shown.bio)}`,
      );

      return `display name and a two-line bio both saved and rendered at /u/${username}`;
    });

    /* ------------------------------------- M5: a miss is not a failure */
    await check("an unknown username is the 404 page, not an error state", async () => {
      await goto(page, `${APP_URL}/u/nobody-${stamp}`);

      const text = await readBody(page);
      assert(
        text.includes("This page does not exist"),
        `expected the 404 page, got: ${text.slice(0, 200)}`,
      );
      // The distinction the error-code work exists for. An unreachable API and
      // a username that does not exist are not the same sentence to a reader,
      // and rendering "this person is gone" for a network blip would be a lie
      // about a real account.
      assert(
        !text.includes("Could not load this profile"),
        "an unknown username rendered the error state instead of the 404 page",
      );

      return "an unknown username rendered the 404 page rather than an error";
    });

    /* --------------------------------- M5: the interest ceiling is inclusive */
    await check("the picker's ceiling matches the backend's, and the maximum saves", async () => {
      await goto(page, `${APP_URL}/onboarding`);
      await waitFor(
        page,
        `document.querySelectorAll('fieldset input[type="checkbox"]').length > 0`,
        "the category picker to load",
      );

      const state = await readPicker(page);
      assert(
        Number.isFinite(state.ceiling),
        `could not read a ceiling from the picker's count line: ${JSON.stringify(state.count)}`,
      );

      // Select everything the catalogue offers. The backend takes at most 10,
      // so with a catalogue of exactly 10 this is the reachable form of the
      // boundary — and it is the half that a too-strict check would break.
      const wanted = Math.min(state.offered, state.ceiling);
      await selectInterests(page, [...Array(wanted).keys()]);

      const picked = await readPicker(page);
      assert(
        picked.checked === wanted,
        `expected ${wanted} selected, got ${picked.count}`,
      );

      // The refusal half. It needs an unselected category beyond the ceiling to
      // click, so it is only reachable if the seed grows past 10 — reported
      // either way rather than left to look like a gap in the run below.
      let refused = "not reachable: the catalogue offers exactly the ceiling";
      if (state.offered > state.ceiling) {
        await selectInterests(page, [state.ceiling]);
        const atCeiling = await readPicker(page);
        assert(
          atCeiling.checked === state.ceiling,
          `an ${state.ceiling + 1}th selection was accepted: ${atCeiling.count}`,
        );
        assert(
          atCeiling.refusal.includes(`${state.ceiling}`),
          `expected the backend's wording about the limit, got ${JSON.stringify(atCeiling.refusal)}`,
        );
        refused = `the ${state.ceiling + 1}th was refused with ${JSON.stringify(atCeiling.refusal)}`;
      }

      await clickButton(page, "Continue");
      await waitFor(page, `location.pathname === "/"`, "the maximum selection to save");

      await goto(page, `${APP_URL}/onboarding`);
      await waitFor(
        page,
        `document.querySelectorAll('fieldset input[type="checkbox"]').length > 0`,
        "the category picker to load",
      );
      const after = await readPicker(page);
      assert(
        after.checked === wanted,
        `expected the maximum to persist, but a reload shows ${after.count}`,
      );

      return `${wanted} of ${state.offered} selected and saved; a reload kept all ${after.checked}; ${refused}`;
    });

    /* -------------------------------------------------- check 6 */
    await check("a cross-origin write is refused by the proxy", async () => {
      // Origin spoofing is not something page script can do — the browser
      // sets that header — so this is asserted at the HTTP boundary, where
      // the check actually runs. The unit suite covers the same handler.
      const response = await fetch(`${APP_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
        body: JSON.stringify({ identifier: "ada", password: "whatever" }),
      });

      assert(response.status === 403, `expected 403, got ${response.status}`);
      const body = await response.json();
      assert(
        body?.error?.code === "FORBIDDEN_ORIGIN",
        `expected FORBIDDEN_ORIGIN, got ${JSON.stringify(body)}`,
      );
      return "a forged Origin was refused with FORBIDDEN_ORIGIN before reaching the API";
    });
  } finally {
    page.close();
    chrome.kill("SIGTERM");
    await sleep(400);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  /* -------------------------------------------------- summary */
  const failed = results.filter((result) => !result.pass);
  process.stdout.write(`\n${"─".repeat(64)}\n`);
  process.stdout.write(`${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) {
    for (const result of failed) {
      process.stdout.write(`  FAILED: ${result.name}\n          ${result.reason}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`\nharness error: ${error.stack ?? error.message}\n`);
  process.exitCode = 2;
});
