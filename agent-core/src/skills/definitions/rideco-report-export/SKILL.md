---
name: rideco-report-export
description: |
  Log in to the RideCo Operations Center and export a report (e.g. "RideChoice Trips")
  for a given date range and filter set. Use this skill whenever the user asks to
  "export a RideCo report", "pull RideChoice Trips", "export trips for <date range>",
  references `ops.valleymetroconnect.rideco.com`, or asks for a RideCo data extract with
  the current report layout. This is a login-gated, multi-step browser form flow — it
  uses `interact` (browser session), not `scrape`.
category: Operations
---

# RideCo Report Export

Drive the RideCo Operations Center SPA through a browser session to export a report.
The target is the report viewer (PowerBI-style embedded reports) behind login, so this
is an `interact` flow end to end — `scrape` cannot reach it.

## When to use

- "Export the RideChoice Trips report for last week"
- "Pull RideCo trips for {FROM_DATE} to {TO_DATE}, provider {PROVIDER}"
- User references `https://ops.valleymetroconnect.rideco.com` and wants a data export
- Any RideCo report that ends in the hidden `...` → **Export data** → **Data with current layout** flow

Do NOT use this for the RideCo Statistics page scrape (KPI / Vehicle / Driver tabs) —
that is a different, read-only flow.

## Parameters

| Param | Example | Notes |
|-------|---------|-------|
| `{REPORT_NAME}` | `RideChoice Trips` | The entry to pick from the Reports dropdown |
| `{REPORT_URL}` | `https://ops.valleymetroconnect.rideco.com/reports/6b31e503-b7d6-464b-9fa8-98a9006c575c` | Direct deep-link to the report viewer (skips the dropdown when valid) |
| `{FROM_DATE}` / `{TO_DATE}` | `2026-06-01` / `2026-06-07` | Report date range |
| `{PROVIDER}` | e.g. a specific transportation provider | Report filter |
| `{BROKERED_RIDE_STATUS}` | e.g. `Completed` | Report filter |

All dates are **Phoenix local** (`America/Phoenix`, no DST). Compute relative ranges
("today", "last week") against Phoenix time — RideCo's operating date aligns with Valley
Metro's, not the runner's UTC clock.

## Strategy

### 1. Open the browser session
Open a session with the saved RideCo profile so the login is already established.

- Use the persisted profile (e.g. `rideco-mjm`) so cookies carry the auth.
- **`saveChanges: false`** — read-only profile use; never write back to the profile, it
  causes write-lock collisions with concurrent runs.

### 2. Reach the report viewer (mind the redirect)
Go to `https://ops.valleymetroconnect.rideco.com`.

- The direct path `/operation-center/reports` frequently **redirects** to the PowerBI
  reports landing page. If that happens, do NOT fight the redirect — the Operations
  Center SPA sidebar has a plain `/reports` link. Click that sidebar link; it lands on
  the same destination with no redirect.
- If you have a valid `{REPORT_URL}` deep-link (e.g. `/reports/<guid>`), navigate
  straight to it; that bypasses the dropdown.

### 3. Auth check — STOP, never self-authenticate
If you land on a login page, SSO prompt, or a 2FA / OTP page:
- The session's saved cookies have expired.
- Do **NOT** enter credentials, request, or type a 2FA code.
- Delete the browser session (Step 7) and stop, reporting `AUTH-NEEDED: session cookies expired`.

### 4. Select the report
- Open the **Reports** dropdown and select `{REPORT_NAME}` (e.g. `RideChoice Trips`).
  Match the entry text exactly. (Skip this if you deep-linked via `{REPORT_URL}`.)
- Wait for the report frame to finish loading before touching filters.

### 5. Set the filters
Set each filter, then let the report re-render between changes:
- **From date** = `{FROM_DATE}`, **To date** = `{TO_DATE}`. Open each date textbox and pick
  the day; the picker's default is usually not the date you want, so set it explicitly.
- **Provider** = `{PROVIDER}`
- **Brokered Ride Status** = `{BROKERED_RIDE_STATUS}`
- Any other filters the user specifies (`etc.`) — apply them the same way.

Confirm the report grid reflects the filters before exporting (e.g. the date header /
row count updated). Exporting before the re-render captures stale data.

### 6. Export — the hidden `...` menu
This is the fiddly part; the export entry is not visible until you hover:
1. Locate the report visual's **`...`** (more options) button. It is hidden until the
   visual is **hovered** — move the pointer over the visual / its header to reveal it.
2. Click the `...` button to open its menu.
3. Choose **Export data**.
4. In the export dialog, select **Data with current layout** (so the filtered/laid-out
   view is exported, not the raw underlying model).
5. Click **Export**.
6. Wait for the download to complete and capture the resulting file path / confirmation.

If the `...` menu does not appear on hover, the visual may not have focus — click once
inside the visual (not on a data point that drills down), then re-hover.

### 7. Always tear down the session
Delete the browser session when finished — on success **and** on any failure path
(redirect loop, auth wall, export dialog never appears). Leaving sessions open holds the
profile lock.

## interact notes

- Prefer natural-language `interact` steps for the click/hover flow ("hover the report
  visual to reveal the `...` button, click it, choose Export data, select Data with
  current layout, click Export").
- Drop to `interact:code` when a step is brittle in natural language — e.g. hover is
  unreliable, so dispatch a real `mouseover` on the visual before reading the menu, or
  click the calendar cell for an exact date rather than typing.
- The hover-to-reveal `...` and the date picker are the two steps most likely to need
  `interact:code`. Everything else is usually fine in natural language.

## Failure patterns

- **Redirect to PowerBI landing** — expected; use the sidebar `/reports` link (Step 2).
- **`...` button missing** — it is hover-gated; hover the visual first, then click.
- **Export grabs stale data** — you exported before the re-render; re-apply filters and
  wait for the grid to update.
- **Login / 2FA wall** — stop and report `AUTH-NEEDED`; never authenticate (Step 3).
- **Profile write-lock** — you used `saveChanges: true`; it must be `false`.

## Critical rules

- All timestamps and relative date math use `America/Phoenix`. Never a bare local clock.
- NEVER set `saveChanges: true` on the profile.
- NEVER enter credentials or a 2FA code — stop instead.
- ALWAYS delete the browser session before stopping, success or failure.
