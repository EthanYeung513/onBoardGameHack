import { uploadExtension } from "@convex/lib/connectors";

// Uploaded / Drive file → plain text. Parsers (D-29): `unpdf` (maintained serverless PDF.js build,
// no native deps) for PDF, `mammoth` (raw-text mode) for DOCX; Markdown and text are UTF-8.

export async function parseFile(name: string, bytes: ArrayBuffer, mimeType?: string): Promise<string> {
  const ext = mimeType === "application/pdf" ? "pdf" : uploadExtension(name);
  switch (ext) {
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      return text.replace(/[ \t]+\n/g, "\n").trim();
    }
    case "docx": {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return value.trim();
    }
    case "md":
    case "markdown":
    case "txt":
      return new TextDecoder("utf-8").decode(bytes).trim();
    default:
      throw new Error(`${name}: unsupported file type (PDF, Markdown, DOCX or text only)`);
  }
}
