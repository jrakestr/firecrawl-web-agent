/**
 * Resend digest helper for CAF inbox cron.
 *
 * Env (agent-core copy/.env):
 *   RESEND_API_KEY   — required to send
 *   CAF_NOTIFY_TO    — comma-separated recipients
 *   CAF_NOTIFY_FROM  — optional (default onboarding@resend.dev)
 *   CAF_EXPLORER_URL — optional base for report link
 */

export type CafDigestRow = {
  cafNumber: string;
  kind: "new" | "updated";
  customerName?: string;
  dueDate?: string;
  status?: string;
};

export type CafDigestPayload = {
  newCount: number;
  updatedCount: number;
  rows: CafDigestRow[];
  newlySeeded?: string[];
  ranAtIso: string;
};

function phxStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function buildDigestEmail(payload: CafDigestPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const stamp = phxStamp(payload.ranAtIso);
  const subject = `CAF inbox: ${payload.newCount} new, ${payload.updatedCount} updated — ${stamp} PHX`;
  const explorer =
    (process.env.CAF_EXPLORER_URL || "http://localhost:3000").replace(/\/$/, "") +
    "/reports/caf-investigations";

  const lines = payload.rows.map((r) => {
    const bits = [
      r.cafNumber,
      `[${r.kind}]`,
      r.customerName || "—",
      `due ${r.dueDate || "—"}`,
      r.status || "—",
    ];
    return bits.join(" | ");
  });

  const seeded =
    payload.newlySeeded && payload.newlySeeded.length
      ? `\nNewly seeded investigations: ${payload.newlySeeded.join(", ")}\n`
      : "";

  const text = [
    subject,
    "",
    ...lines,
    seeded,
    `Open: ${explorer}`,
  ].join("\n");

  const rowsHtml = payload.rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:4px 8px;font-family:ui-monospace,monospace">${escapeHtml(r.cafNumber)}</td>
          <td style="padding:4px 8px">${escapeHtml(r.kind)}</td>
          <td style="padding:4px 8px">${escapeHtml(r.customerName || "—")}</td>
          <td style="padding:4px 8px">${escapeHtml(r.dueDate || "—")}</td>
          <td style="padding:4px 8px">${escapeHtml(r.status || "—")}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.4">
  <h2 style="margin:0 0 8px">${escapeHtml(subject)}</h2>
  <p><a href="${escapeHtml(explorer)}">CAF investigations report</a></p>
  <table style="border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="text-align:left;border-bottom:1px solid #ccc">
        <th style="padding:4px 8px">CAF#</th>
        <th style="padding:4px 8px">Kind</th>
        <th style="padding:4px 8px">Customer</th>
        <th style="padding:4px 8px">Due</th>
        <th style="padding:4px 8px">Status</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${
    payload.newlySeeded?.length
      ? `<p>Newly seeded investigations: <code>${escapeHtml(payload.newlySeeded.join(", "))}</code></p>`
      : ""
  }
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendCafDigest(
  payload: CafDigestPayload,
): Promise<{ sent: boolean; id?: string; skippedReason?: string }> {
  if (payload.newCount === 0 && payload.updatedCount === 0) {
    return { sent: false, skippedReason: "NO_CHANGES" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const toRaw = process.env.CAF_NOTIFY_TO;
  const from = process.env.CAF_NOTIFY_FROM || "onboarding@resend.dev";

  if (!apiKey) {
    return { sent: false, skippedReason: "RESEND_API_KEY not set" };
  }
  if (!toRaw?.trim()) {
    return { sent: false, skippedReason: "CAF_NOTIFY_TO not set" };
  }

  const to = toRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const { subject, text, html } = buildDigestEmail(payload);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      `Resend → ${res.status}: ${body.message || JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return { sent: true, id: body.id };
}
