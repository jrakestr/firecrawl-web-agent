/**
 * 7. MyGameSim Login — interact() with a named profile so the browser
 *    session (cookies, local storage) persists across runs.
 *
 *   Setup: put SITE_URL, MYGAMESIM.COM_USERNAME, MYGAMESIM.COM_PASSWORD,
 *   FIRECRAWL_API_KEY, OPENAI_API_KEY in .env.
 *
 *   Run:
 *     node --env-file=.env --import tsx examples/7-mygamesim-login.ts
 */
import { createAgent } from "../src";

const required = ["MYGAMESIM.COM_USERNAME", "MYGAMESIM.COM_PASSWORD", "FIRECRAWL_API_KEY", "OPENAI_API_KEY"] as const;
for (const k of required) {
  if (!process.env[k]) {
    console.error(`${k} not set. Add it to .env and re-run.`);
    process.exit(1);
  }
}

const PROFILE_NAME = "mygamesim-session";
const URL = process.env.SITE_URL || "https://www.mygamesim.com/";

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
        console.log("\n  Live browser view (use this to complete CAPTCHA or 2FA if prompted):");
        console.log(`  ${url}\n`);
      }
    },
  },
});

const USERNAME = process.env["MYGAMESIM.COM_USERNAME"]!;
const PASSWORD = process.env["MYGAMESIM.COM_PASSWORD"]!;

const prompt = `You MUST use the interact tool to drive a real browser. Do not return text without calling tools.

Goal: log in to www.mygamesim.com and establish a persistent session.

Step 1 — call interact with EXACTLY these arguments (copy the values verbatim, do not paraphrase):
  url: ${URL}
  prompt: Locate the login or sign-in elements. Fill the username/email field with the value ${USERNAME} (type it exactly). Fill the password field with the value ${PASSWORD} (type it exactly). Click the login/sign-in button. After submitting, report whether login succeeded, failed with an error message, or triggered a CAPTCHA or 2FA challenge.

Step 2 — based on the interact result:
  - If login succeeded and you are logged in, report success and describe the current page state.
  - If a CAPTCHA or 2FA challenge is present, STOP and report that human intervention is required via the live view link. Do NOT attempt to guess codes or bypass CAPTCHA.
  - If login failed with an error message, STOP and report the exact error.

Return your final answer as a JSON object: { "loginStatus": "logged_in" | "needs_intervention" | "failed", "requires": "captcha" | "2fa" | "none", "errorMessage": "...", "pageState": "..." }

CRITICAL: When you put the username or password into interact's prompt, paste the literal string values shown above. Never substitute a placeholder like "the provided password" — that will literally be typed into the password field.`;

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
