import { expect } from "chai";

import {
  CHUNK_SIZE,
  buildFileChunks,
  chunkText,
  extractTextFromUpload,
  isAllowedUploadExtension
} from "../../../src/services/sutra/documentUpload";

describe("documentUpload utilities", () => {
  describe("isAllowedUploadExtension", () => {
    it("allows pdf and txt case-insensitively", () => {
      expect(isAllowedUploadExtension("a.pdf")).to.equal(true);
      expect(isAllowedUploadExtension("b.TXT")).to.equal(true);
      expect(isAllowedUploadExtension("c.Pdf")).to.equal(true);
    });

    it("rejects other extensions", () => {
      expect(isAllowedUploadExtension("a.doc")).to.equal(false);
      expect(isAllowedUploadExtension("a.pdf.exe")).to.equal(false);
      expect(isAllowedUploadExtension("noext")).to.equal(false);
    });
  });

  describe("chunkText", () => {
    it("returns one chunk for short text", () => {
      expect(chunkText("hello")).to.deep.equal(["hello"]);
    });

    it("returns one chunk for exactly CHUNK_SIZE", () => {
      const text = "a".repeat(CHUNK_SIZE);
      expect(chunkText(text)).to.deep.equal([text]);
    });

    it("splits at CHUNK_SIZE", () => {
      const text = "a".repeat(CHUNK_SIZE + 1);
      expect(chunkText(text)).to.deep.equal(["a".repeat(CHUNK_SIZE), "a"]);
    });
  });

  describe("extractTextFromUpload", () => {
    it("decodes txt as utf-8", async () => {
      const text = await extractTextFromUpload({
        originalname: "notes.txt",
        buffer: Buffer.from("hello café", "utf-8")
      });
      expect(text).to.equal("hello café");
    });

    it("uses parsePdf for pdf files", async () => {
      const text = await extractTextFromUpload(
        { originalname: "doc.pdf", buffer: Buffer.from("%PDF") },
        async () => ({ text: "  from pdf  " })
      );
      expect(text).to.equal("  from pdf  ");
    });
  });

  describe("buildFileChunks", () => {
    it("maps chunks with original filename", async () => {
      const result = await buildFileChunks({
        originalname: "hours.txt",
        buffer: Buffer.from("a".repeat(CHUNK_SIZE + 2), "utf-8")
      });
      expect(result.filename).to.equal("hours.txt");
      expect(result.chunks).to.have.length(2);
      expect(result.chunks[0]).to.deep.equal({
        filename: "hours.txt",
        content: "a".repeat(CHUNK_SIZE)
      });
      expect(result.chunks[1]).to.deep.equal({
        filename: "hours.txt",
        content: "aa"
      });
    });
  });
});
