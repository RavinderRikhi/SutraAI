import path from "node:path";

import multer from "multer";
import pdfParse from "pdf-parse";

export const CHUNK_SIZE = 500;
export const MAX_UPLOAD_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXT = new Set([".pdf", ".txt"]);

export type UploadFile = {
  originalname: string;
  buffer: Buffer;
};

export type PdfParseFn = (buf: Buffer) => Promise<{ text: string }>;

export const uploadDocuments = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_UPLOAD_FILES,
    fileSize: MAX_FILE_BYTES
  }
}).array("files", MAX_UPLOAD_FILES);

export function isAllowedUploadExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

export async function extractTextFromUpload(
  file: UploadFile,
  parsePdf: PdfParseFn = pdfParse
): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".txt") {
    return file.buffer.toString("utf-8");
  }
  if (ext === ".pdf") {
    const result = await parsePdf(file.buffer);
    return result.text ?? "";
  }
  throw new Error(`Unsupported extension: ${ext}`);
}

export function chunkText(text: string, size: number = CHUNK_SIZE): string[] {
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export async function buildFileChunks(
  file: UploadFile,
  parsePdf?: PdfParseFn
): Promise<{
  filename: string;
  chunks: Array<{ filename: string; content: string }>;
}> {
  const text = await extractTextFromUpload(file, parsePdf);
  const parts = chunkText(text);
  return {
    filename: file.originalname,
    chunks: parts.map((content) => ({
      filename: file.originalname,
      content
    }))
  };
}

export function multerLimitMessage(err: unknown): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    const code = (err as { code: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      return "File too large";
    }
    if (code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
      return "Too many files";
    }
  }
  return null;
}
