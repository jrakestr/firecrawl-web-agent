/**
 * Alesig CAF write-back + close (Phase D of the CAF Co-Pilot).
 *
 * HUMAN-IN-THE-LOOP CONTRACT: this script runs only as the result of an
 * explicit per-CAF human approval (the "Push & close in Alesig" action or a
 * deliberate manual invocation). It must never run in a batch/loop.
 *
 * Fills the confirmed workpaper fields on the Edit A CAF page and clicks
 * Save. With "close": true it then clicks Submit and accepts the
 * confirmation dialog, which advances/closes the CAF workflow.
 *
 * Field map: rideco-data-explorer/docs/procedures/alesig-caf-field-map.md
 *
 * Usage:
 *   node --env-file=.env --import tsx examples/11-alesig-caf-writeback.ts --payload payload.json
 *
 * Payload JSON:
 *   {
 *     "cafNumber": "578251",
 *     "validity": "Valid" | "Invalid" | "Undetermined",
 *     "investigatorComments": "…prose narrative…",
 *     "actionTakenResponse": "…corrective action…",
 *     "actionTakenDate": "07/27/2026",
 *     "responseMethod": "Phone",
 *     "close": false
 *   }
 *
 * Emits a final line: RESULT {"status":"saved"|"submitted","cafNumber":"…"}
 */
import { readFileSync, existsSync } from "node:fs";
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

type Payload = {
  cafNumber: string;
  validity: "Valid" | "Invalid" | "Undetermined";
  investigatorComments: string;
  actionTakenResponse: string;
  actionTakenDate: string;
  responseMethod: string;
  close: boolean;
};

function loadPayload(): Payload {
  const i = process.argv.indexOf("--payload");
  if (i === -1 || !process.argv[i + 1]) {
    console.error("--payload <file.json> is required.");
    process.exit(1);
  }
  const p = JSON.parse(readFileSync(process.argv[i + 1], "utf8")) as Payload;
  const missing = (["cafNumber", "validity", "investigatorComments"] as const).filter(
    (k) => !p[k],
  );
  if (missing.length) {
    console.error(`Payload missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!["Valid", "Invalid", "Undetermined"].includes(p.validity)) {
    console.error(`Bad validity: ${p.validity}`);
    process.exit(1);
  }
  return p;
}

async function interact(scrapeId: string, prompt: string): Promise<string> {
  const res = await fetch(`${API}/scrape/${scrapeId}/interact`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    // A healthy interact answers in 1-3 min; a dead session hangs forever.
    signal: AbortSignal.timeout(240_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`interact → ${res.status}: ${text.slice(0, 400)}`);
  const body = JSON.parse(text) as Record<string, unknown>;
  const data = body.data as Record<string, unknown> | undefined;
  const out = data?.output ?? body.output ?? "";
  return typeof out === "string" ? out : JSON.stringify(out);
}

async function main() {
  const p = loadPayload();
  if (!existsSync(SESSION_PATH)) {
    console.error("No .alesig-session.json — run 9b-alesig-caf-login-persist.ts first.");
    process.exit(1);
  }
  const session = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as { scrapeId: string };
  console.log(`Write-back CAF ${p.cafNumber} (close=${p.close}) via ${session.scrapeId}`);

  const fillPrompt = [
    `Open CAF ${p.cafNumber}: type ${p.cafNumber} into the CAF# search box in the top nav and press Enter (or click the matching inbox row). Wait for the Edit A CAF page.`,
    `Verify the page header shows CAF# ${p.cafNumber}. If it shows a different CAF number, STOP and return {"status":"wrong_caf"}.`,
    "Then fill the Investigator Response / Action Taken sections exactly as follows:",
    `1. In the Investigator Comments textarea, clear it and type exactly:\n${p.investigatorComments}`,
    `2. Set the Validity radio to: ${p.validity}`,
    p.actionTakenResponse
      ? `3. In the Action Taken Response textarea, clear it and type exactly:\n${p.actionTakenResponse}`
      : "3. Leave Action Taken Response unchanged.",
    p.actionTakenDate
      ? `4. Set the Date field in the Action Taken section to: ${p.actionTakenDate}`
      : "4. Leave the Action Taken date unchanged.",
    p.responseMethod
      ? `5. In the Response To Customer section, set the Add New Response select to ${p.responseMethod} and click the Add button next to it.`
      : "5. Leave Response To Customer unchanged.",
    "6. Click the Save button (NOT Submit). If a validation error appears, return it.",
    'Return JSON only: {"status":"saved"|"error","cafNumber":"' + p.cafNumber + '","message":string}',
  ].join("\n");

  const fillOut = await interact(session.scrapeId, fillPrompt);
  console.log("fill:", fillOut.slice(0, 600));
  if (!/"status"\s*:\s*"saved"/i.test(fillOut)) {
    console.error("Save did not confirm. Aborting before Submit.");
    console.log(`RESULT {"status":"error","cafNumber":"${p.cafNumber}"}`);
    process.exit(2);
  }

  if (!p.close) {
    console.log(`RESULT {"status":"saved","cafNumber":"${p.cafNumber}"}`);
    return;
  }

  const submitPrompt = [
    `You are on the Edit A CAF page for CAF ${p.cafNumber} (just saved).`,
    "Click the Submit button. A confirmation dialog will appear — accept/confirm it.",
    "Wait for the page to settle and report where you landed.",
    'Return JSON only: {"status":"submitted"|"error","message":string}',
  ].join("\n");
  const submitOut = await interact(session.scrapeId, submitPrompt);
  console.log("submit:", submitOut.slice(0, 600));
  if (!/"status"\s*:\s*"submitted"/i.test(submitOut)) {
    console.log(`RESULT {"status":"saved","cafNumber":"${p.cafNumber}"}`);
    process.exit(3);
  }
  console.log(`RESULT {"status":"submitted","cafNumber":"${p.cafNumber}"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
