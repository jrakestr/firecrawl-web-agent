import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createParseTool } from "./parse-tool";
import { initBashWithFiles, readBashFile } from "./tools";

// The tool reads uploaded bytes out of the bash sandbox, so seed the sandbox
// the same way the agent's upload pipeline does before each test.
const PDF_BYTES = Buffer.from("%PDF-1.7 fake pdf bytes", "utf-8");

async function seedBinary(name: string, bytes: Buffer) {
  await initBashWithFiles({ [`/data/${name}.b64`]: bytes.toString("base64") });
}

async function seedText(name: string, content: string) {
  await initBashWithFiles({ [`/data/${name}`]: content });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Pull the captured request's `options` JSON and `file` part out of FormData. */
async function inspectRequest(call: [string, RequestInit]) {
  const [url, init] = call;
  const form = init.body as FormData;
  // `options` is sent as a plain text field (not a Blob/file part).
  const optionsPart = form.get("options") as string;
  const filePart = form.get("file") as File;
  return {
    url,
    auth: (init.headers as Record<string, string>).Authorization,
    options: JSON.parse(optionsPart),
    filename: filePart.name,
    fileBytes: Buffer.from(await filePart.arrayBuffer()),
  };
}

// Calling the AI SDK tool's execute directly; second arg (ToolCallOptions) is
// unused by our implementation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runParse(input: Record<string, unknown>) {
  const t = createParseTool("fc-test-key") as any;
  return t.execute(input, {});
}

describe("createParseTool", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { markdown: "# Hi" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /v2/parse with bearer auth and default markdown format", async () => {
    await seedBinary("report.pdf", PDF_BYTES);
    const out = await runParse({ filename: "report.pdf" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = await inspectRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(req.url).toBe("https://api.firecrawl.dev/v2/parse");
    expect(req.auth).toBe("Bearer fc-test-key");
    expect(req.options).toEqual({ formats: [{ type: "markdown" }] });
    expect(req.filename).toBe("report.pdf");
    expect(req.fileBytes.equals(PDF_BYTES)).toBe(true);
    expect(out).toEqual({ markdown: "# Hi", savedTo: "/data/report.md" });
    expect(await readBashFile("/data/report.md")).toBe("# Hi");
  });

  it("resolves a /data path and the .b64 suffix back to the original filename", async () => {
    await seedBinary("report.pdf", PDF_BYTES);
    await runParse({ filename: "/data/report.pdf" });
    const req = await inspectRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(req.filename).toBe("report.pdf");
    expect(req.fileBytes.equals(PDF_BYTES)).toBe(true);
  });

  it("sends parsers with mode 'ocr' for scanned documents", async () => {
    await seedBinary("scan.pdf", PDF_BYTES);
    await runParse({ filename: "scan.pdf", mode: "ocr", maxPages: 50 });
    const req = await inspectRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(req.options.parsers).toEqual([{ type: "pdf", mode: "ocr", maxPages: 50 }]);
  });

  it("appends a json format when a schema is provided and returns json", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { markdown: "# Invoice", json: { total: 42 } } }),
    );
    await seedBinary("invoice.pdf", PDF_BYTES);
    const schema = { type: "object", properties: { total: { type: "number" } } };
    const out = await runParse({ filename: "invoice.pdf", schema });

    const req = await inspectRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(req.options.formats).toEqual([{ type: "markdown" }, { type: "json", schema }]);
    expect(out).toEqual({ markdown: "# Invoice", json: { total: 42 }, savedTo: "/data/invoice.md" });
  });

  it("reads plain text uploads (no .b64 suffix) as utf-8 bytes", async () => {
    await seedText("page.html", "<h1>Hello</h1>");
    await runParse({ filename: "page.html" });
    const req = await inspectRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(req.filename).toBe("page.html");
    // writeFile stores exact bytes — no trailing-newline artifact.
    expect(req.fileBytes.toString("utf-8")).toBe("<h1>Hello</h1>");
  });

  it("returns an error envelope when the file is not in the sandbox", async () => {
    await seedBinary("report.pdf", PDF_BYTES);
    const out = await runParse({ filename: "missing.pdf" });
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toMatch(/no uploaded file found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an error envelope on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: "bad file" }, 400));
    await seedBinary("report.pdf", PDF_BYTES);
    const out = await runParse({ filename: "report.pdf" });
    expect(out).toEqual({ error: "bad file" });
  });

  it("returns an error envelope when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await seedBinary("report.pdf", PDF_BYTES);
    const out = await runParse({ filename: "report.pdf" });
    expect((out as { error: string }).error).toMatch(/network down/i);
  });

  it("auto-discovers the single uploaded document when filename is omitted", async () => {
    await seedBinary("report.pdf", PDF_BYTES);
    const out = await runParse({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = await inspectRequest(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(req.filename).toBe("report.pdf");
    expect(out).toEqual({ markdown: "# Hi", savedTo: "/data/report.md" });
  });

  it("returns a preview + saved path (not the full text) for large documents", async () => {
    const big = "# Big Doc\n" + "lorem ipsum ".repeat(8000); // ~96k chars
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { markdown: big } }));
    await seedBinary("rfp.pdf", PDF_BYTES);
    const out = (await runParse({ filename: "rfp.pdf" })) as Record<string, unknown>;

    expect(out.truncated).toBe(true);
    expect(out.totalChars).toBe(big.length);
    expect(out.fullContentSavedTo).toBe("/data/rfp.md");
    expect((out.markdown as string).length).toBe(8000);
    expect(out.note).toMatch(/full markdown is saved at \/data\/rfp\.md/i);
    // The full text is durable on disk even though only a preview was returned.
    expect(await readBashFile("/data/rfp.md")).toBe(big);
  });

  it("errors with the candidate list when filename omitted and multiple docs uploaded", async () => {
    await initBashWithFiles({
      "/data/a.pdf.b64": PDF_BYTES.toString("base64"),
      "/data/b.docx.b64": PDF_BYTES.toString("base64"),
    });
    const out = await runParse({});
    expect((out as { error: string }).error).toMatch(/multiple uploaded files/i);
    expect((out as { error: string }).error).toMatch(/a\.pdf/);
    expect((out as { error: string }).error).toMatch(/b\.docx/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
