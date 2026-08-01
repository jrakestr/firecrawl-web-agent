/**
 * 9. Alesig CAF (CAS) Login — agent-core interact helper.
 *
 * Prefer the durable bootstrap (keeps scrape session open — profile reopen
 * does NOT retain Alesig auth):
 *   node --env-file=.env --import tsx examples/9b-alesig-caf-login-persist.ts
 *   node --env-file=.env --import tsx examples/9b-alesig-caf-login-persist.ts --check
 *
 *   Site: https://vmcrms.alesig.com/ (Customer Assistance System)
 *
 *   Setup: put ALESIG_CAF_URL, ALESIG_CAF_USERNAME, ALESIG_CAF_PASSWORD,
 *   FIRECRAWL_API_KEY, OPENAI_API_KEY in .env.
 *
 *   Run:
 *     node --env-file=.env --import tsx examples/9-alesig-caf-login.ts
 */
import { createAgent } from "../src";

const required = [
  "ALESIG_CAF_USERNAME",
  "ALESIG_CAF_PASSWORD",
  "FIRECRAWL_API_KEY",
  "OPENAI_API_KEY",
] as const;
for (const k of required) {
  if (!process.env[k]) {
    console.error(`${k} not set. Add it to .env and re-run.`);
    process.exit(1);
  }
}

const PROFILE_NAME = "alesig-caf-session";
const URL = process.env.ALESIG_CAF_URL || "https://vmcrms.alesig.com/caf/";

const agent = createAgent({
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY!,
  model: { provider: "openai", model: "gpt-4o" },
  firecrawlOptions: {
    interact: {
      profile: { name: PROFILE_NAME, saveChanges: true },
    },
    interactAutoStart: true,
    interactTimeoutMs: 5 * 60_000,
    onInteractSessionStart: (info) => {
      const url = info.interactiveLiveViewUrl ?? info.liveViewUrl;
      if (url) {
        console.log(
          "\n  Live browser view (use this to complete CAPTCHA or 2FA if prompted):",
        );
        console.log(`  ${url}\n`);
      }
    },
  },
});

const USERNAME = process.env.ALESIG_CAF_USERNAME!;
const PASSWORD = process.env.ALESIG_CAF_PASSWORD!;

const prompt = `You MUST use the interact tool to drive a real browser. Do not return text without calling tools.

Goal: log in to Valley Metro Customer Assistance System (vmcrms.alesig.com) and establish a persistent session for CAF pulls.

Step 1 — call interact with EXACTLY these arguments (copy the values verbatim, do not paraphrase):
  url: ${URL}
  prompt: Locate the Username and Password fields on the Customer Assistance System login page. Fill the Username field with the value ${USERNAME} (type it exactly). Fill the Password field with the value ${PASSWORD} (type it exactly). If a "Remember me" checkbox is present and unchecked, check it. Click the Log In button. After submitting, report whether login succeeded, failed with an error message, or triggered a CAPTCHA or 2FA challenge. If logged in, briefly describe the landing page (nav items, dashboard title, menus related to CAFs/complaints, or first visible section).

Step 2 — based on the interact result:
  - If login succeeded and you are logged in, report success and describe the current page state, especially any CAF search/list/export navigation.
  - If a CAPTCHA or 2FA challenge is present, STOP and report that human intervention is required via the live view link. Do NOT attempt to guess codes or bypass CAPTCHA.
  - If login failed with an error message, STOP and report the exact error.

Return your final answer as a JSON object: { "loginStatus": "logged_in" | "needs_intervention" | "failed", "requires": "captcha" | "2fa" | "none", "errorMessage": "...", "pageState": "...", "cafNavHints": "..." }

CRITICAL: When you put the username or password into interact's prompt, paste the literal string values shown above. Never substitute a placeholder like "the provided password" — that will literally be typed into the password field.`;

let stepCount = 0;
let finalText = "";
for await (const event of agent.stream({ prompt, maxSteps: 25 })) {
  if (event.type === "text") {
    process.stdout.write(event.content ?? "");
  } else if (event.type === "tool-call") {
    console.log(
      `\n  [tool-call: ${event.toolName}] input: ${JSON.stringify(event.input).slice(0, 300)}`,
    );
  } else if (event.type === "tool-result") {
    const preview = JSON.stringify(event.output).slice(0, 400);
    console.log(`  [tool-result: ${event.toolName}] ${preview}`);
  } else if (event.type === "done") {
    stepCount = event.steps?.length ?? 0;
    finalText = event.text ?? "";
  } else if (event.type === "error") {
    console.error(`\n  [error] ${event.error}`);
  }
}

console.log(`\n\n--- Steps taken: ${stepCount} ---`);
console.log("\n--- Final answer ---\n");
console.log(finalText);
