/**
 * Alesig CAF scrape — Phase A intake (no file download).
 *
 * Reuses the live interact session from .alesig-session.json (bootstrap with
 * 9b-alesig-caf-login-persist.ts). Scrapes Personal Inbox rows and, for the
 * requested CAFs, the full Edit A CAF detail page. Writes one JSON file that
 * rideco-data-explorer/scripts/import_caf_scrape.py upserts into Supabase.
 *
 * Read-only on the CRM: never clicks Save or Submit.
 *
 *   node --env-file=.env --import tsx examples/10-alesig-caf-scrape.ts \
 *     --out /path/to/alesig-caf-scrape.json [--details 5] [--caf 578251 --caf 578252]
 *
 *   --details N   scrape detail pages for the first N inbox CAFs (default 5, 0 = inbox only)
 *   --caf NUM     scrape detail for a specific CAF number (repeatable; overrides --details)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.firecrawl.dev/v2";
const SESSION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.alesig-session.json",
);

const key = process.env.FIRECRAWL_API_KEY;
if (!key) {
  console.error("FIRECRAWL_API_KEY not set.");
  process.exit(1);
}

type Args = { out: string; details: number; cafs: string[] };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out =
    argv[argv.indexOf("--out") + 1 || -1] && argv.includes("--out")
      ? argv[argv.indexOf("--out") + 1]
      : resolve(dirname(fileURLToPath(import.meta.url)), "../alesig-caf-scrape.json");
  let details = 5;
  const di = argv.indexOf("--details");
  if (di >= 0) details = Number(argv[di + 1] ?? "5");
  const cafs: string[] = [];
  argv.forEach((a, i) => {
    if (a === "--caf" && argv[i + 1]) cafs.push(argv[i + 1]);
  });
  return { out, details, cafs };
}

async function interact(scrapeId: string, prompt: string): Promise<string> {
  const res = await fetch(`${API}/scrape/${scrapeId}/interact`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
    // A healthy interact answers in 1-3 min; a dead session hangs forever.
    signal: AbortSignal.timeout(240_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`interact → ${res.status}: ${text.slice(0, 400)}`);
  }
  const body = JSON.parse(text) as Record<string, unknown>;
  const data = body.data as Record<string, unknown> | undefined;
  const out = data?.output ?? body.output ?? "";
  return typeof out === "string" ? out : JSON.stringify(out);
}

/** Interact output wraps JSON in ```json fences and sometimes adds prose. */
function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON in output: ${raw.slice(0, 300)}`);
  return JSON.parse(candidate.slice(start).trim()) as T;
}

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

type CafDetail = {
  cafNumber: string;
  readOnlyFields: { label: string; value: string }[];
  editableFields: {
    label: string;
    type: string;
    currentValue: string;
    options: string[];
  }[];
};

const INBOX_PROMPT = [
  "You are logged into the Alesig CAF CRM.",
  "Navigate to the Inbox → Personal Inbox page (click Inbox in the left nav if not already there).",
  "Read the inbox table. If it paginates, read up to the first 3 pages.",
  "Return JSON only — an array of rows:",
  '[{"cafNumber": string, "loggedDate": string, "dueDate": string, "customerName": string, "detail": string, "category": string, "route": string, "heldBy": string, "status": string}]',
  "Use empty string for cells the table does not show. Do not modify anything.",
].join("\n");

function detailPrompt(caf: string): string {
  return [
    `Open CAF ${caf}: type ${caf} into the CAF# search box in the top nav and press Enter (or click the matching inbox row).`,
    "Wait for the Edit A CAF page to load.",
    "List every form field on the page. Return JSON only:",
    '{"cafNumber": string, "readOnlyFields": [{"label": string, "value": string}], "editableFields": [{"label": string, "type": "text|textarea|select|checkbox|radio|date", "currentValue": string, "options": [string]}]}',
    "Include: CSR, Logged Date, Logged Time, Contact Type, Intaker Comments, Detail, Priority, Selected Categories, Sub-Category, Incident Date, Scheduled Time, Route#, Service Type, Vehicle #, Vehicle Type, Location, City, Operator Description, Customer Comments, Customer Details (name/address/phones), Referred To, Department, Carrier, Due Date, Preferred Method of Response, Investigator Comments, Validity, Action Taken Response, Date (Action Taken).",
    "DO NOT click Save or Submit. Do not change any field.",
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  if (!existsSync(SESSION_PATH)) {
    console.error("No .alesig-session.json — run 9b-alesig-caf-login-persist.ts first.");
    process.exit(1);
  }
  const session = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as {
    scrapeId: string;
  };
  console.log("Using scrapeId", session.scrapeId);

  // Session TTL is short (~5 min); with explicit --caf targets, skip the
  // inbox pass and spend the whole session on detail pages.
  let inbox: InboxRow[] = [];
  if (!args.cafs.length) {
    console.log("Scraping Personal Inbox…");
    const inboxRaw = await interact(session.scrapeId, INBOX_PROMPT);
    inbox = extractJson<InboxRow[]>(inboxRaw).filter((r) => r.cafNumber);
    console.log(`Inbox: ${inbox.length} rows`);
  }

  const targets = args.cafs.length
    ? args.cafs
    : inbox.slice(0, Math.max(0, args.details)).map((r) => r.cafNumber);

  const details: CafDetail[] = [];
  let sessionDead = false;
  for (const caf of targets) {
    if (sessionDead) break;
    console.log(`Scraping CAF ${caf} detail…`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await interact(session.scrapeId, detailPrompt(caf));
        const d = extractJson<CafDetail>(raw);
        d.cafNumber = d.cafNumber || caf;
        details.push(d);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`CAF ${caf} attempt ${attempt} failed:`, msg);
        if (msg.includes("410") || msg.includes("destroyed")) {
          // Session TTL (~5 min) hit — nothing further will succeed.
          console.error("Session destroyed. Re-run 9b login, then re-run with --caf for the remainder.");
          sessionDead = true;
          break;
        }
      }
    }
  }

  const payload = {
    scrapedAt: new Date().toISOString(),
    source: "alesig-personal-inbox",
    inbox,
    details,
  };
  writeFileSync(args.out, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${args.out} (${inbox.length} inbox rows, ${details.length} details)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
