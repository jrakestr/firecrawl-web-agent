/**
 * Alesig CAF login bootstrap.
 *
 * Reality check (2026-07-27): Firecrawl named profiles do NOT retain Alesig
 * auth across stop/reopen (ASP.NET session cookies). Working pattern:
 *   1) scrape + interact login
 *   2) KEEP the interact session open (do not DELETE)
 *   3) reuse scrapeId for follow-up CAF pulls until TTL expires
 *
 * Session file: agent-core copy/.alesig-session.json
 *
 *   node --env-file=.env --import tsx examples/9b-alesig-caf-login-persist.ts
 *   node --env-file=.env --import tsx examples/9b-alesig-caf-login-persist.ts --check
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.firecrawl.dev/v2";
const PROFILE = "alesig-caf-session";
const URL = process.env.ALESIG_CAF_URL || "https://vmcrms.alesig.com/caf/";
const SESSION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.alesig-session.json",
);

// #region agent log
function dbg(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
): void {
  fetch("http://127.0.0.1:7551/ingest/f7d8351d-2e76-456e-830d-e9dfef390dc4", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "04aa24",
    },
    body: JSON.stringify({
      sessionId: "04aa24",
      runId: process.env.CAF_DEBUG_RUN_ID || "pre-fix",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

const required = [
  "ALESIG_CAF_USERNAME",
  "ALESIG_CAF_PASSWORD",
  "FIRECRAWL_API_KEY",
] as const;
for (const k of required) {
  if (!process.env[k]) {
    console.error(`${k} not set.`);
    process.exit(1);
  }
}

const key = process.env.FIRECRAWL_API_KEY!;
const user = process.env.ALESIG_CAF_USERNAME!;
const pass = process.env.ALESIG_CAF_PASSWORD!;
const checkOnly = process.argv.includes("--check");

type SessionFile = {
  profile: string;
  scrapeId: string;
  url: string;
  liveViewUrl?: string;
  loggedInAt: string;
  note: string;
};

async function api(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      // #region agent log
      dbg("C", "9b-alesig-caf-login-persist.ts:api", "api HTTP error", {
        path,
        method: init.method ?? "GET",
        status: res.status,
      });
      // #endregion
      throw new Error(
        `${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    // #region agent log
    dbg("A", "9b-alesig-caf-login-persist.ts:api", "api ok", {
      path,
      method: init.method ?? "GET",
      status: res.status,
    });
    // #endregion
    return body;
  } catch (err) {
    const cause =
      err instanceof Error && "cause" in err
        ? (err.cause as { code?: string; hostname?: string } | undefined)
        : undefined;
    // #region agent log
    dbg("A", "9b-alesig-caf-login-persist.ts:api", "api fetch/throw", {
      path,
      method: init.method ?? "GET",
      errName: err instanceof Error ? err.name : typeof err,
      errMsg: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      causeCode: cause?.code ?? null,
      causeHostname: cause?.hostname ?? null,
    });
    // #endregion
    throw err;
  }
}

function scrapeIdFrom(body: Record<string, unknown>): string {
  const data = body.data as Record<string, unknown> | undefined;
  const meta = (data?.metadata ?? body.metadata) as
    | Record<string, unknown>
    | undefined;
  const id = (meta?.scrapeId ?? meta?.scrape_id) as string | undefined;
  if (!id) {
    throw new Error(`No scrapeId: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return id;
}

function outputFrom(body: Record<string, unknown>): string {
  const data = body.data as Record<string, unknown> | undefined;
  const out = data?.output ?? body.output ?? "";
  return typeof out === "string" ? out : JSON.stringify(out);
}

async function checkSession(scrapeId: string): Promise<boolean> {
  const body = await api(`/scrape/${scrapeId}/interact`, {
    method: "POST",
    body: JSON.stringify({
      prompt:
        'Do not log in. Return JSON only: {"loggedIn":boolean,"pageHint":string}. true if Personal Inbox or CAF table/nav is visible; false if Username/Password form.',
    }),
  });
  const out = outputFrom(body);
  console.log("check:", out.slice(0, 500));
  return /"loggedIn"\s*:\s*true/i.test(out) || /\bloggedIn"?\s*:\s*true/i.test(out);
}

async function loginFresh(): Promise<SessionFile> {
  console.log("Scraping Alesig CAF with profile writer…");
  const scrape = await api("/scrape", {
    method: "POST",
    body: JSON.stringify({
      url: URL,
      formats: ["markdown"],
      waitFor: 2000,
      profile: { name: PROFILE, saveChanges: true },
    }),
  });
  const scrapeId = scrapeIdFrom(scrape);
  console.log("scrapeId:", scrapeId);

  const loginPrompt = [
    `Fill the Username field with exactly: ${user}`,
    `Fill the Password field with exactly: ${pass}`,
    "If Remember me is present and unchecked, check it.",
    "Click Log In.",
    "Wait until Personal Inbox or a CAF table is visible.",
    'Return JSON: {"loginStatus":"logged_in"|"failed","pageHint":"..."}',
  ].join("\n");

  // The scrape job can take a few seconds to become interactable (404 "Job
  // not found" if we POST too early) — retry with backoff.
  let interact: Record<string, unknown> | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      interact = await api(`/scrape/${scrapeId}/interact`, {
        method: "POST",
        body: JSON.stringify({ prompt: loginPrompt }),
      });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 4 && msg.includes("404")) {
        console.log(`interact not ready (attempt ${attempt}); retrying in 5s…`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
  if (!interact) throw new Error("interact never became ready");
  const out = outputFrom(interact);
  console.log("login:", out.slice(0, 800));
  console.log("liveView:", interact.interactiveLiveViewUrl ?? interact.liveViewUrl);

  const ok =
    /logged_in|Personal Inbox|CAF table|CAF#/i.test(out) &&
    !/"loginStatus"\s*:\s*"failed"/i.test(out);
  if (!ok) {
    throw new Error("Login did not confirm Personal Inbox.");
  }

  // Keep session open — DO NOT DELETE interact. Profile reopen loses Alesig auth.
  const session: SessionFile = {
    profile: PROFILE,
    scrapeId,
    url: URL,
    liveViewUrl: String(
      interact.interactiveLiveViewUrl ?? interact.liveViewUrl ?? "",
    ),
    loggedInAt: new Date().toISOString(),
    note: "Session kept open. Reuse scrapeId for CAF pulls. Do not stop until finished — profile reopen will not stay logged in.",
  };
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
  console.log("Wrote", SESSION_PATH);
  return session;
}

async function main() {
  // #region agent log
  let dnsOk: boolean | null = null;
  let dnsAddrs: string[] = [];
  let dnsErr: string | null = null;
  try {
    const addrs = await lookup("api.firecrawl.dev", { all: true });
    dnsOk = true;
    dnsAddrs = addrs.map((a) => `${a.address}/${a.family}`);
  } catch (e) {
    dnsOk = false;
    dnsErr = e instanceof Error ? `${(e as NodeJS.ErrnoException).code || e.name}: ${e.message}` : String(e);
  }
  dbg("B", "9b-alesig-caf-login-persist.ts:main", "login bootstrap env/dns", {
    checkOnly,
    hasFirecrawlKey: Boolean(process.env.FIRECRAWL_API_KEY),
    hasAlesigUser: Boolean(process.env.ALESIG_CAF_USERNAME),
    xpcService: process.env.XPC_SERVICE_NAME || null,
    pathHead: (process.env.PATH || "").split(":").slice(0, 5),
    dnsOk,
    dnsAddrs,
    dnsErr,
  });
  // #endregion

  if (checkOnly) {
    if (!existsSync(SESSION_PATH)) {
      console.error("No session file. Run without --check first.");
      process.exit(1);
    }
    const session = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as SessionFile;
    console.log("Using scrapeId", session.scrapeId);
    const ok = await checkSession(session.scrapeId);
    console.log(ok ? "STILL_LOGGED_IN" : "SESSION_DEAD");
    process.exit(ok ? 0 : 2);
  }

  // If an existing session still works, keep it.
  if (existsSync(SESSION_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as SessionFile;
      console.log("Found prior session", prev.scrapeId, "— checking…");
      if (await checkSession(prev.scrapeId)) {
        console.log("Existing Alesig session still live. No re-login needed.");
        console.log("liveView:", prev.liveViewUrl);
        // #region agent log
        dbg("D", "9b-alesig-caf-login-persist.ts:main", "reused live session", {
          scrapeId: prev.scrapeId,
        });
        // #endregion
        return;
      }
      console.log("Prior session dead; logging in fresh…");
    } catch (err) {
      console.log("Prior session unusable:", err);
      // #region agent log
      dbg("D", "9b-alesig-caf-login-persist.ts:main", "prior session check threw", {
        errMsg: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
      // #endregion
    }
  }

  const session = await loginFresh();
  const ok = await checkSession(session.scrapeId);
  if (!ok) {
    throw new Error("Post-login check failed.");
  }
  // #region agent log
  dbg("C", "9b-alesig-caf-login-persist.ts:main", "fresh login succeeded", {
    scrapeId: session.scrapeId,
  });
  // #endregion
  console.log("\nAlesig logged in. Session kept open.");
  console.log("scrapeId:", session.scrapeId);
  console.log("liveView:", session.liveViewUrl);
  console.log("Reuse with: node --env-file=.env --import tsx examples/9b-alesig-caf-login-persist.ts --check");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
