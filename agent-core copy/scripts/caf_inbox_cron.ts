/**
 * CAF twice-daily inbox pull orchestrator.
 *
 * Flow: 9b login → inbox scrape → diff vs caf_records → detail scrape for
 * new/updated → import_caf_scrape.py → Resend digest when changes exist.
 *
 * Env:
 *   agent-core copy/.env — FIRECRAWL_API_KEY, ALESIG_CAF_*, RESEND_*, CAF_NOTIFY_*
 *   rideco-data-explorer/.env.local — SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Flags:
 *   --dry-run     login + inbox + diff + print email body; no import / no send
 *   --no-email    run import but skip Resend
 *   --no-login    reuse existing .alesig-session.json (skip 9b)
 *
 *   node --env-file=.env --import tsx scripts/caf_inbox_cron.ts [--dry-run]
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildDigestEmail,
  sendCafDigest,
  type CafDigestRow,
} from "./caf_notify_email.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RIDECO = resolve(ROOT, "../../rideco-data-explorer");
const OUT_DIR = resolve(ROOT, "scraped_data/caf");
const LOG_PATH = resolve(OUT_DIR, "caf_inbox_cron.log");
const DETAIL_BATCH = 3;

const isMain =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const NO_EMAIL = argv.includes("--no-email");
const NO_LOGIN = argv.includes("--no-login");

type InboxRow = {
  cafNumber: string;
  loggedDate?: string;
  dueDate?: string;
  customerName?: string;
  detail?: string;
  category?: string;
  route?: string;
  heldBy?: string;
  status?: string;
};

type DbRow = {
  caf_number: string;
  closure: string | null;
  due_date: string | null;
  customer_name: string | null;
};

type ScrapePayload = {
  scrapedAt: string;
  source: string;
  inbox: InboxRow[];
  details: unknown[];
};

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    appendFileSync(LOG_PATH, line + "\n");
  } catch {
    /* ignore log write failures */
  }
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

function runNode(scriptRel: string, args: string[]): void {
  const script = resolve(ROOT, scriptRel);
  const result = spawnSync(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", script, ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(
      `${scriptRel} failed (exit ${result.status}): ${(result.stderr || result.stdout || "").slice(-400)}`,
    );
  }
}

function parseMdy(s: string | undefined | null): string | null {
  const raw = (s || "").trim();
  if (!raw) return null;
  // Hand-parse a few common inbox shapes instead of pulling a date lib.
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const year = mdy[3].length === 2 ? 2000 + Number(mdy[3]) : Number(mdy[3]);
    return isoDate(year, Number(mdy[1]), Number(mdy[2]));
  }
  const mon = raw.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{2,4})/i,
  );
  if (mon) {
    const months: Record<string, number> = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    const mi = months[mon[1].slice(0, 3).toLowerCase()];
    const year = mon[3].length === 2 ? 2000 + Number(mon[3]) : Number(mon[3]);
    return isoDate(year, mi, Number(mon[2]));
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function isoDate(y: number, m: number, d: number): string | null {
  if (!y || !m || !d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normStatus(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

async function fetchDbRows(cafNumbers: string[]): Promise<Map<string, DbRow>> {
  const map = new Map<string, DbRow>();
  if (!cafNumbers.length) return map;

  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || "";
  if (!base || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY missing (rideco .env.local)");
  }

  const step = 80;
  for (let i = 0; i < cafNumbers.length; i += step) {
    const chunk = cafNumbers.slice(i, i + step);
    const listed = chunk.map((c) => `"${c}"`).join(",");
    const url = `${base}/rest/v1/caf_records?select=caf_number,closure,due_date,customer_name&caf_number=in.(${listed})`;
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!res.ok) {
      throw new Error(`caf_records fetch → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const rows = (await res.json()) as DbRow[];
    for (const r of rows) map.set(r.caf_number, r);
  }
  return map;
}

function diffInbox(
  inbox: InboxRow[],
  db: Map<string, DbRow>,
): { neu: InboxRow[]; updated: InboxRow[]; unchanged: InboxRow[] } {
  const neu: InboxRow[] = [];
  const updated: InboxRow[] = [];
  const unchanged: InboxRow[] = [];
  for (const row of inbox) {
    const existing = db.get(row.cafNumber);
    if (!existing) {
      neu.push(row);
      continue;
    }
    const dueInbox = parseMdy(row.dueDate);
    const dueDb = existing.due_date ? existing.due_date.slice(0, 10) : null;
    const statusChanged =
      normStatus(row.status) !== normStatus(existing.closure) &&
      Boolean(row.status?.trim());
    const dueChanged =
      dueInbox !== null && dueDb !== null && dueInbox !== dueDb;
    const dueAppeared = dueInbox !== null && dueDb === null;
    if (statusChanged || dueChanged || dueAppeared) {
      updated.push(row);
    } else {
      unchanged.push(row);
    }
  }
  return { neu, updated, unchanged };
}

function readScrape(path: string): ScrapePayload {
  return JSON.parse(readFileSync(path, "utf8")) as ScrapePayload;
}

function ensureLogin(): void {
  if (NO_LOGIN) {
    log("Skipping login (--no-login)");
    return;
  }
  log("Bootstrapping Alesig session (9b)…");
  // #region agent log
  fetch("http://127.0.0.1:7551/ingest/f7d8351d-2e76-456e-830d-e9dfef390dc4", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "04aa24",
    },
    body: JSON.stringify({
      sessionId: "04aa24",
      runId: process.env.CAF_DEBUG_RUN_ID || "pre-fix",
      hypothesisId: "B",
      location: "caf_inbox_cron.ts:ensureLogin",
      message: "ensureLogin start",
      data: {
        xpcService: process.env.XPC_SERVICE_NAME || null,
        hasFirecrawlKey: Boolean(process.env.FIRECRAWL_API_KEY),
        underLaunchd: Boolean(process.env.XPC_SERVICE_NAME),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  try {
    runNode("examples/9b-alesig-caf-login-persist.ts", []);
    // #region agent log
    fetch("http://127.0.0.1:7551/ingest/f7d8351d-2e76-456e-830d-e9dfef390dc4", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "04aa24",
      },
      body: JSON.stringify({
        sessionId: "04aa24",
        runId: process.env.CAF_DEBUG_RUN_ID || "pre-fix",
        hypothesisId: "C",
        location: "caf_inbox_cron.ts:ensureLogin",
        message: "ensureLogin ok",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (err) {
    // #region agent log
    fetch("http://127.0.0.1:7551/ingest/f7d8351d-2e76-456e-830d-e9dfef390dc4", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "04aa24",
      },
      body: JSON.stringify({
        sessionId: "04aa24",
        runId: process.env.CAF_DEBUG_RUN_ID || "pre-fix",
        hypothesisId: "A",
        location: "caf_inbox_cron.ts:ensureLogin",
        message: "ensureLogin failed",
        data: {
          errMsg:
            err instanceof Error
              ? err.message.slice(0, 300)
              : String(err).slice(0, 300),
          isDns: /ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(
            err instanceof Error ? err.message : String(err),
          ),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw err;
  }
}

function scrapeInbox(outPath: string): InboxRow[] {
  log(`Scraping Personal Inbox → ${outPath}`);
  runNode("examples/10-alesig-caf-scrape.ts", [
    "--out",
    outPath,
    "--details",
    "0",
  ]);
  const payload = readScrape(outPath);
  return (payload.inbox || []).filter((r) => r.cafNumber);
}

function scrapeDetails(cafs: string[], outPath: string): unknown[] {
  if (!cafs.length) {
    writeFileSync(
      outPath,
      JSON.stringify(
        { scrapedAt: new Date().toISOString(), source: "alesig-personal-inbox", inbox: [], details: [] },
        null,
        2,
      ),
    );
    return [];
  }
  const allDetails: unknown[] = [];
  const got = new Set<string>();
  const remaining = [...cafs];
  let relogged = false;

  while (remaining.length) {
    const batch = remaining.splice(0, DETAIL_BATCH);
    const batchPath = outPath.replace(/\.json$/, `.batch-${batch[0]}.json`);
    const cafArgs = batch.flatMap((c) => ["--caf", c]);
    log(`Scraping details for ${batch.join(", ")}…`);
    try {
      runNode("examples/10-alesig-caf-scrape.ts", ["--out", batchPath, ...cafArgs]);
      const payload = readScrape(batchPath);
      for (const d of payload.details || []) {
        const num =
          typeof d === "object" && d && "cafNumber" in d
            ? String((d as { cafNumber: string }).cafNumber)
            : "";
        if (num) got.add(num);
        allDetails.push(d);
      }
      const missing = batch.filter((c) => !got.has(c));
      if (missing.length) {
        log(`Partial detail batch; missing ${missing.join(", ")}`);
        if (!relogged) {
          log("Re-login once and retry missing details…");
          // Drop --no-login for recovery even if caller passed it.
          runNode("examples/9b-alesig-caf-login-persist.ts", []);
          relogged = true;
          remaining.unshift(...missing);
          continue;
        }
        log(`Giving up on details for ${missing.join(", ")} (inbox upsert still applies)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const sessionDead = /410|destroyed|SESSION/i.test(msg);
      if (sessionDead && !relogged) {
        log("Session died mid-details; re-login once and retry batch…");
        runNode("examples/9b-alesig-caf-login-persist.ts", []);
        relogged = true;
        remaining.unshift(...batch);
        continue;
      }
      throw err;
    }
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        scrapedAt: new Date().toISOString(),
        source: "alesig-personal-inbox",
        inbox: [],
        details: allDetails,
      },
      null,
      2,
    ),
  );
  return allDetails;
}

function runImport(filePath: string): {
  upserted: number;
  newly_seeded: string[];
  caf_numbers: string[];
} {
  const script = resolve(RIDECO, "scripts/import_caf_scrape.py");
  const result = spawnSync(
    "python3",
    [script, "--file", filePath, "--json-summary"],
    {
      cwd: RIDECO,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(
      `import_caf_scrape.py failed (exit ${result.status}): ${(result.stderr || result.stdout || "").slice(-400)}`,
    );
  }
  const match = (result.stdout || "").match(/CAF_IMPORT_SUMMARY=(\{.*\})/m);
  if (!match) {
    return { upserted: 0, newly_seeded: [], caf_numbers: [] };
  }
  return JSON.parse(match[1]) as {
    upserted: number;
    newly_seeded: string[];
    caf_numbers: string[];
  };
}

async function main(): Promise<void> {
  loadEnvFile(resolve(ROOT, ".env"));
  loadEnvFile(resolve(RIDECO, ".env.local"));
  mkdirSync(OUT_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const inboxPath = resolve(OUT_DIR, `inbox-${stamp}.json`);
  const detailsPath = resolve(OUT_DIR, `details-${stamp}.json`);
  const mergePath = resolve(OUT_DIR, `merge-${stamp}.json`);

  log(
    `START caf_inbox_cron dryRun=${DRY_RUN} noEmail=${NO_EMAIL} noLogin=${NO_LOGIN}`,
  );

  ensureLogin();
  const inbox = scrapeInbox(inboxPath);
  log(`Inbox rows: ${inbox.length}`);

  const db = await fetchDbRows(inbox.map((r) => r.cafNumber));
  const { neu, updated, unchanged } = diffInbox(inbox, db);
  log(
    `Diff: new=${neu.length} updated=${updated.length} unchanged=${unchanged.length}`,
  );

  const needDetails = neu.map((r) => r.cafNumber);
  // Updated rows get inbox-field upsert only (status/due). Full Edit-A-CAF
  // detail pages are reserved for brand-new CAFs so the ~5 min session TTL
  // is not burned on dozens of status syncs.
  let details: unknown[] = [];
  if (needDetails.length && !DRY_RUN) {
    details = scrapeDetails(needDetails, detailsPath);
    log(`Details scraped: ${details.length}`);
  } else if (needDetails.length && DRY_RUN) {
    log(`Dry-run: would scrape details for ${needDetails.join(", ")}`);
  }
  if (updated.length) {
    log(
      `Updated ${updated.length} CAFs will upsert from inbox fields only (no detail scrape)`,
    );
  }

  const merge: ScrapePayload = {
    scrapedAt: new Date().toISOString(),
    source: "alesig-personal-inbox",
    inbox,
    details,
  };
  writeFileSync(mergePath, JSON.stringify(merge, null, 2));
  log(`Wrote merge ${mergePath}`);

  let newlySeeded: string[] = [];
  if (!DRY_RUN && (inbox.length > 0 || details.length > 0)) {
    const summary = runImport(mergePath);
    newlySeeded = summary.newly_seeded || [];
    log(
      `Import: upserted=${summary.upserted} newly_seeded=${newlySeeded.length}`,
    );
  } else if (DRY_RUN) {
    log("Dry-run: skipped import");
  }

  const digestRows: CafDigestRow[] = [
    ...neu.map((r) => ({
      cafNumber: r.cafNumber,
      kind: "new" as const,
      customerName: r.customerName,
      dueDate: parseMdy(r.dueDate) || r.dueDate,
      status: r.status,
    })),
    ...updated.map((r) => ({
      cafNumber: r.cafNumber,
      kind: "updated" as const,
      customerName: r.customerName,
      dueDate: parseMdy(r.dueDate) || r.dueDate,
      status: r.status,
    })),
  ];

  const payload = {
    newCount: neu.length,
    updatedCount: updated.length,
    rows: digestRows,
    newlySeeded,
    ranAtIso: new Date().toISOString(),
  };

  if (payload.newCount === 0 && payload.updatedCount === 0) {
    log("NO_CHANGES");
  } else {
    const preview = buildDigestEmail(payload);
    log(`Digest subject: ${preview.subject}`);
    if (DRY_RUN || NO_EMAIL) {
      console.log("--- email body (not sent) ---");
      console.log(preview.text);
      log(
        DRY_RUN
          ? "Dry-run: email not sent"
          : "Email skipped (--no-email)",
      );
    } else {
      const result = await sendCafDigest(payload);
      if (result.sent) {
        log(`Email sent id=${result.id}`);
      } else {
        log(`Email skipped: ${result.skippedReason}`);
      }
    }
  }

  log("DONE");
}

if (isMain) {
  main().catch((err) => {
    log(`FATAL ${err instanceof Error ? err.stack || err.message : String(err)}`);
    process.exit(1);
  });
}