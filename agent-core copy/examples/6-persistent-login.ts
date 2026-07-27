/**
 * 6. Persistent login — interact() with a named profile so the browser
 *    session (cookies, local storage) persists across runs.
 *
 *   Setup: put SITE_URL, SITE_USERNAME, SITE_PASSWORD, FIRECRAWL_API_KEY,
 *   OPENAI_API_KEY in .env (already done).
 *
 *   Run:
 *     node --env-file=.env --import tsx examples/6-persistent-login.ts
 *
 *   First run: the agent logs in. If Rocket Money triggers 2FA, the script
 *   prints a live-browser URL — open it, complete 2FA there, then re-run.
 *   Subsequent runs: the profile is restored, no re-login.
 */
import { createAgent } from "../src";

const required = ["SITE_URL", "SITE_USERNAME", "SITE_PASSWORD", "FIRECRAWL_API_KEY", "OPENAI_API_KEY"] as const;
for (const k of required) {
  if (!process.env[k]) {
    console.error(`${k} not set. Add it to .env and re-run.`);
    process.exit(1);
  }
}

const PROFILE_NAME = "rocketmoney-session";

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
        console.log("\n  Live browser view (use this to complete 2FA if prompted):");
        console.log(`  ${url}\n`);
      }
    },
  },
});

const EMAIL = process.env.SITE_USERNAME!;
const PASSWORD = process.env.SITE_PASSWORD!;
const URL = process.env.SITE_URL!;

const prompt = `You MUST use the interact tool to drive a real browser. Do not return text without calling tools.

Goal: log in to Rocket Money and extract my 25 most recent transactions.

Step 1 — call interact with EXACTLY these arguments (copy the values verbatim, do not paraphrase):
  url: ${URL}
  prompt: Fill the email/username field with the value ${EMAIL} (type it exactly). Fill the password field with the value ${PASSWORD} (type it exactly). Click the Sign In or Log In button. After submitting, report whether login succeeded, failed with an error message, or triggered a 2FA challenge (SMS code, email code, authenticator app, or device verification).

Step 2 — based on the interact result:
  - If login succeeded and you are on the transactions page, call interact again with a prompt to extract the 25 most recent transactions as JSON with fields: date, merchant, amount (negative for spending), category.
  - If 2FA was triggered, STOP and report which 2FA method is required. Do NOT guess codes.
  - If login failed, STOP and report the exact error message.

Return your final answer as a JSON object: { "loginStatus": "logged_in" | "needs_2fa" | "failed", "twoFactorMethod": "...", "errorMessage": "...", "transactions": [...] }

CRITICAL: When you put the email or password into interact's prompt, paste the literal string values shown above. Never substitute a placeholder like "the provided password" — that will literally be typed into the password field.`;

let stepCount = 0;
let finalText = "";
for await (const event of agent.stream({ prompt, maxSteps: 25 })) {
  if (event.type === "text") {
    process.stdout.write(event.content ?? "");
  } else if (event.type === "tool-call") {
    console.log(`\n  [tool-call: ${event.toolName}] input: ${JSON.stringify(event.input).slice(0, 300)}`);
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
