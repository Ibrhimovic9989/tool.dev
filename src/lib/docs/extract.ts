// Text extraction for the file types makemcp.dev's Documents node accepts.
//
// Strategy per mime / extension:
//   - text/plain, .md, .csv      → utf-8 decode (CSV gets a thin "row N: …"
//                                  serialization to keep rows discoverable
//                                  in chunked search)
//   - application/pdf            → try pdf-parse first; fall back to Azure
//                                  Document Intelligence (OCR) when extracted
//                                  text is empty (i.e. scanned PDF)
//   - .docx                      → mammoth
//   - .xlsx / .xls               → SheetJS (xlsx)
//   - image/*                    → Azure Document Intelligence OCR
//
// Each extractor returns plain text. Chunking happens in the pipeline.

import "server-only";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

export interface ExtractedDoc {
  text: string;
  /** What strategy actually ran (useful for UI feedback). */
  strategy:
    | "text"
    | "csv"
    | "pdf-native"
    | "pdf-ocr"
    | "docx"
    | "xlsx"
    | "image-ocr";
  /** Page or row count if known (best-effort). */
  unitCount?: number;
}

export async function extractText(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<ExtractedDoc> {
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";

  // Plain text-ish
  if (mime.startsWith("text/") && ext !== ".csv") {
    return { text: buffer.toString("utf8"), strategy: "text" };
  }
  if (ext === ".md" || ext === ".txt") {
    return { text: buffer.toString("utf8"), strategy: "text" };
  }

  // CSV — serialize so each row is a separate searchable line
  if (ext === ".csv" || mime === "text/csv") {
    const raw = buffer.toString("utf8");
    const rows = raw.split(/\r?\n/);
    const lines = rows
      .filter((r) => r.trim().length > 0)
      .map((r, i) => `row ${i + 1}: ${r}`);
    return { text: lines.join("\n"), strategy: "csv", unitCount: lines.length };
  }

  // DOCX
  if (
    ext === ".docx" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, strategy: "docx" };
  }

  // Excel
  if (
    ext === ".xlsx" ||
    ext === ".xls" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheets: string[] = [];
    let totalRows = 0;
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      const rows = csv.split(/\r?\n/).filter((r) => r.trim()).length;
      totalRows += rows;
      sheets.push(`# Sheet: ${name}\n${csv}`);
    }
    return { text: sheets.join("\n\n"), strategy: "xlsx", unitCount: totalRows };
  }

  // PDF — native first, OCR fallback
  if (ext === ".pdf" || mime === "application/pdf") {
    // pdf-parse has a known issue with its index.js running a fixture PDF on
    // import; import the inner module directly to avoid that. Keep this in a
    // try so a parse failure can fall through to OCR.
    try {
      // pdf-parse's package index.js runs a fixture file on import. Reach
      // for the implementation directly to dodge that. The type stub doesn't
      // know about this path, so cast through unknown.
      const mod = (await import(
        // @ts-expect-error untyped deep import
        "pdf-parse/lib/pdf-parse.js"
      )) as { default: (b: Buffer) => Promise<{ text: string; numpages: number }> };
      const pdfParse = mod.default;
      const parsed = await pdfParse(buffer);
      const text = (parsed.text ?? "").trim();
      if (text.length >= 40) {
        return {
          text,
          strategy: "pdf-native",
          unitCount: parsed.numpages,
        };
      }
      // Empty/very-short text → almost certainly a scanned PDF. Fall through.
    } catch {
      // Native parse failed entirely. Fall through to OCR.
    }
    const ocrText = await ocrWithDocumentIntelligence(buffer);
    return { text: ocrText, strategy: "pdf-ocr" };
  }

  // Images → OCR
  if (
    mime.startsWith("image/") ||
    ext === ".jpg" ||
    ext === ".jpeg" ||
    ext === ".png" ||
    ext === ".bmp" ||
    ext === ".tiff" ||
    ext === ".tif"
  ) {
    const ocrText = await ocrWithDocumentIntelligence(buffer);
    return { text: ocrText, strategy: "image-ocr" };
  }

  throw new Error(`Unsupported file type: ${filename} (${mime || "no mime"})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Azure Document Intelligence (prebuilt-read model)
// ─────────────────────────────────────────────────────────────────────────────

async function ocrWithDocumentIntelligence(buffer: Buffer): Promise<string> {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  const apiVersion =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION ?? "2024-11-30";
  if (!endpoint || !key) {
    throw new Error(
      "Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  }
  const base = endpoint.replace(/\/$/, "");
  const url = `${base}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${apiVersion}`;
  // Async API: submit, poll for result via the Operation-Location header.
  const submit = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/octet-stream",
    },
    body: buffer as unknown as BodyInit,
  });
  if (submit.status !== 202) {
    const t = await submit.text().catch(() => "");
    throw new Error(`Document Intelligence submit failed ${submit.status}: ${t}`);
  }
  const opLoc = submit.headers.get("operation-location");
  if (!opLoc) throw new Error("Document Intelligence: no operation-location");

  // Poll with backoff up to ~60s
  const start = Date.now();
  let delay = 800;
  while (Date.now() - start < 90_000) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 3000);
    const poll = await fetch(opLoc, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!poll.ok) {
      const t = await poll.text().catch(() => "");
      throw new Error(`Document Intelligence poll failed ${poll.status}: ${t}`);
    }
    const json = (await poll.json()) as {
      status: string;
      analyzeResult?: { content?: string };
      error?: { message?: string };
    };
    if (json.status === "succeeded") {
      return json.analyzeResult?.content ?? "";
    }
    if (json.status === "failed") {
      throw new Error(
        `Document Intelligence failed: ${json.error?.message ?? "unknown"}`,
      );
    }
  }
  throw new Error("Document Intelligence timed out");
}
