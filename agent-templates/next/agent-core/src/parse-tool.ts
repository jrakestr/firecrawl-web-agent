import { tool } from "ai";
import { z } from "zod";
import { readBashFile, writeBashFile, listBashFiles } from "./tools";

/**
 * Parsed markdown longer than this (chars) is not inlined in the tool result.
 * The deep-agents runtime evicts any tool message over ~80KB to a throwaway
 * file reference, which strips the content the model needs downstream. We stay
 * well under that: return a preview + a durable /data path the model can read
 * and slice with bashExec, and keep the full text on disk.
 */
const INLINE_MARKDOWN_LIMIT = 60000;
const MARKDOWN_PREVIEW_CHARS = 8000;

const PARSE_ENDPOINT = "https://api.firecrawl.dev/v2/parse";

/** Extensions Firecrawl's /parse endpoint can turn into markdown. */
const PARSEABLE_EXT = /\.(html|htm|xhtml|pdf|docx|doc|odt|rtf|xlsx|xls)$/i;

/**
 * When the caller omits `filename`, look in the bash sandbox for uploaded
 * documents. Strips the `.b64` suffix our pipeline adds to binaries so the
 * names line up with what the user uploaded. Returns the sole document when
 * there is exactly one, plus the full candidate list for error messages.
 */
async function discoverUploadedDocument(): Promise<{
  filename: string | null;
  candidates: string[];
}> {
  const files = await listBashFiles();
  const names = new Set<string>();
  for (const f of files) {
    let name = f.path.startsWith("/data/") ? f.path.slice("/data/".length) : f.path;
    if (name.endsWith(".b64")) name = name.slice(0, -".b64".length);
    if (name) names.add(name);
  }
  const docs = [...names].filter((n) => PARSEABLE_EXT.test(n));
  const candidates = docs.length ? docs : [...names];
  return { filename: docs.length === 1 ? docs[0] : null, candidates };
}

/**
 * Strip the leading `/data/` mount prefix and the `.b64` suffix our upload
 * pipeline tacks onto binary files, leaving the original filename (e.g.
 * "report.pdf"). The extension matters — Firecrawl's `/parse` detects the
 * file type from it.
 */
function baseName(input: string): string {
  let name = input.trim();
  if (name.startsWith("/data/")) name = name.slice("/data/".length);
  else if (name.startsWith("data/")) name = name.slice("data/".length);
  if (name.endsWith(".b64")) name = name.slice(0, -".b64".length);
  return name;
}

/**
 * Load the uploaded file's bytes out of the bash sandbox. Binary uploads are
 * stored base64-encoded at `/data/<name>.b64`; text uploads are stored raw at
 * `/data/<name>`. We try the binary form first, then the text form.
 *
 * Returns `null` when neither path holds content (file not uploaded, or the
 * sandbox was never initialized).
 */
async function loadUploadedBytes(
  name: string,
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const filename = baseName(name);

  const b64 = await readBashFile(`/data/${filename}.b64`);
  if (b64 && b64.trim()) {
    return { bytes: Buffer.from(b64.trim(), "base64"), filename };
  }

  const text = await readBashFile(`/data/${filename}`);
  if (text) {
    return { bytes: new TextEncoder().encode(text), filename };
  }

  return null;
}

type ParseFormat = { type: string; schema?: unknown; prompt?: string };

/**
 * Build a Firecrawl `/parse` tool bound to an API key.
 *
 * `firecrawl-aisdk` (the package this repo builds on) does not wrap the
 * `/v2/parse` endpoint, so this tool calls the REST API directly with
 * `multipart/form-data`. It converts an *uploaded* file (PDF, DOCX, DOC, ODT,
 * RTF, XLSX, XLS, HTML) into clean markdown — and, when a `schema` is given,
 * structured JSON in the same call.
 *
 * Files must already be present in the bash sandbox (the agent's upload
 * pipeline writes them to `/data/<name>` or `/data/<name>.b64`). For documents
 * that live at a *public URL*, use `scrape` instead — it auto-detects and
 * parses them.
 */
export function createParseTool(apiKey: string) {
  return tool({
    description:
      "Parse an UPLOADED document into clean, LLM-ready markdown (and optional structured JSON). " +
      "Use this for files the user uploaded — PDF, DOCX, DOC, ODT, RTF, XLSX, XLS, HTML — referenced by their " +
      "filename or /data path (e.g. 'report.pdf' or '/data/report.pdf'). " +
      "For PDFs: mode 'auto' (default) does fast text extraction with OCR fallback, 'fast' is text-only, " +
      "'ocr' forces OCR on every page (use for scanned documents). " +
      "Pass a 'schema' to extract structured fields (e.g. from invoices or contracts) in the same call. " +
      "For documents at a public URL, use scrape instead — it auto-detects and parses them.",
    inputSchema: z.object({
      filename: z
        .string()
        .optional()
        .describe(
          "The uploaded file's name or /data path, e.g. 'report.pdf' or '/data/report.pdf'. " +
            "Optional: if omitted and exactly one document was uploaded, that file is parsed automatically.",
        ),
      mode: z
        .enum(["auto", "fast", "ocr"])
        .optional()
        .describe(
          "PDF parsing mode. 'auto' (default): text-first with OCR fallback. 'fast': text-only. 'ocr': OCR every page (scanned docs).",
        ),
      formats: z
        .array(z.string())
        .optional()
        .describe(
          "Output formats. Defaults to ['markdown']. Supported: markdown, html, rawHtml, links, images, summary.",
        ),
      schema: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "JSON schema for structured extraction. When provided, the parsed document is also returned as JSON matching this schema.",
        ),
      maxPages: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Cap the number of PDF pages parsed — useful to bound OCR work."),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Request timeout in milliseconds. Defaults to 30000, max 300000."),
    }),
    execute: async ({ filename, mode, formats, schema, maxPages, timeout }) => {
      let target = filename?.trim();
      if (!target) {
        const { filename: discovered, candidates } = await discoverUploadedDocument();
        if (discovered) {
          target = discovered;
        } else if (candidates.length > 1) {
          return {
            error:
              `No filename given and multiple uploaded files were found. ` +
              `Specify which to parse: ${candidates.join(", ")}.`,
          };
        } else {
          return {
            error:
              `No filename given and no uploaded document was found in /data. ` +
              `Upload a file first, or list uploads with bashExec: 'ls -l /data'.`,
          };
        }
      }

      const loaded = await loadUploadedBytes(target);
      if (!loaded) {
        return {
          error:
            `No uploaded file found for "${target}". Expected it in the bash sandbox at ` +
            `/data/${baseName(target)} or /data/${baseName(target)}.b64. ` +
            `List uploads with bashExec: 'ls -l /data'.`,
        };
      }

      // The cloud /v2/parse API expects each format as an object with a `type`
      // field (e.g. { type: "markdown" }), not a bare string.
      const formatNames = formats?.length ? formats : ["markdown"];
      const outputFormats: ParseFormat[] = formatNames
        .filter((name) => !(schema && name === "json"))
        .map((name) => ({ type: name }));
      if (schema) outputFormats.push({ type: "json", schema });

      const options: Record<string, unknown> = { formats: outputFormats };
      if (mode || maxPages !== undefined) {
        options.parsers = [
          { type: "pdf", ...(mode ? { mode } : {}), ...(maxPages !== undefined ? { maxPages } : {}) },
        ];
      }
      if (timeout !== undefined) options.timeout = timeout;

      const form = new FormData();
      form.append(
        "file",
        new Blob([loaded.bytes as unknown as BlobPart]),
        loaded.filename,
      );
      // `options` MUST be a plain text field. Appending a Blob makes FormData
      // send it as a file part, which Firecrawl's upload backend rejects with
      // "Unexpected field" (only `file` is a permitted file field).
      form.append("options", JSON.stringify(options));

      let res: Response;
      try {
        res = await fetch(PARSE_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } catch (err) {
        return { error: `Failed to reach Firecrawl /parse: ${err instanceof Error ? err.message : String(err)}` };
      }

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        return { error: `Firecrawl /parse returned a non-JSON response (status ${res.status}).` };
      }

      const body = (payload ?? {}) as {
        success?: boolean;
        error?: string;
        data?: { markdown?: string; metadata?: unknown; json?: unknown; html?: string; summary?: string };
      };

      if (!res.ok || body.success === false) {
        return { error: body.error ?? `Firecrawl /parse failed with status ${res.status}.` };
      }

      const data = body.data ?? {};
      const out: Record<string, unknown> = {};

      const md = typeof data.markdown === "string" ? data.markdown : undefined;
      if (md !== undefined) {
        // Persist the full parsed text into the sandbox so it survives context
        // eviction and can be processed with bashExec (cat/grep/sed) or read by
        // export skills — regardless of how large the document is.
        const savedTo = `/data/${baseName(target).replace(/\.[^.]+$/, "")}.md`;
        const saved = await writeBashFile(savedTo, md);
        if (md.length > INLINE_MARKDOWN_LIMIT) {
          out.markdown = md.slice(0, MARKDOWN_PREVIEW_CHARS);
          out.truncated = true;
          out.totalChars = md.length;
          if (saved) {
            out.fullContentSavedTo = savedTo;
            out.note =
              `Parsed text is ${md.length} chars — only the first ${MARKDOWN_PREVIEW_CHARS} are shown. ` +
              `The FULL markdown is saved at ${savedTo}. Read or slice it with bashExec ` +
              `(e.g. 'sed -n "1,200p" ${savedTo}', 'grep -in budget ${savedTo}', 'wc -l ${savedTo}'). ` +
              `To pull specific fields as JSON, call parse again with a 'schema'.`;
          } else {
            out.note =
              `Parsed text is ${md.length} chars — only the first ${MARKDOWN_PREVIEW_CHARS} are shown. ` +
              `To pull specific fields as JSON, call parse again with a 'schema'.`;
          }
        } else {
          out.markdown = md;
          if (saved) out.savedTo = savedTo;
        }
      }

      if (data.html !== undefined) out.html = data.html;
      if (data.summary !== undefined) out.summary = data.summary;
      if (data.json !== undefined) out.json = data.json;
      if (data.metadata !== undefined) out.metadata = data.metadata;
      return out;
    },
  });
}
