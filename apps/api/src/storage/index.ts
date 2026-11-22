import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.md', '.txt']);

export interface ValidatedUpload {
  originalName: string;
  extension: '.pdf' | '.md' | '.txt';
  mimeType: string;
  buffer: Buffer;
}

export function validateKnowledgeUpload(fileName: string, buffer: Buffer): ValidatedUpload {
  if (buffer.byteLength === 0) {
    throw new Error('Uploaded file is empty');
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds maximum size of ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
  }

  const safeBase = path.basename(fileName);
  const ext = path.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported file type. Allowed: .pdf, .md, .txt');
  }

  if (ext === '.pdf') {
    // Inspect magic bytes (%PDF-)
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new Error('Invalid PDF file signature');
    }
    // TODO(security): Integrate antivirus scanning & PDF CDR (active content stripping) for untrusted enterprise uploads.
    return { originalName: safeBase, extension: '.pdf', mimeType: 'application/pdf', buffer };
  }

  // Validate text/markdown does not contain NUL bytes (binary masquerading as text)
  if (buffer.includes(0)) {
    throw new Error('Binary content detected in text/markdown file');
  }
  return {
    originalName: safeBase,
    extension: ext as '.md' | '.txt',
    mimeType: ext === '.md' ? 'text/markdown' : 'text/plain',
    buffer,
  };
}

export interface StorageAdapter {
  save(buffer: Buffer, extension: string): Promise<string>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

export class LocalDiskStorageAdapter implements StorageAdapter {
  private readonly baseDir: string;

  constructor(uploadDir: string) {
    this.baseDir = path.resolve(uploadDir);
  }

  private resolveSafePath(storageKey: string): string {
    const safeName = path.basename(storageKey);
    const resolved = path.resolve(this.baseDir, safeName);
    if (!resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error('Path traversal attempt blocked');
    }
    return resolved;
  }

  async save(buffer: Buffer, extension: string): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true, mode: 0o750 });
    const safeExt = ALLOWED_EXTENSIONS.has(extension) ? extension : '.bin';
    const key = `${crypto.randomUUID()}${safeExt}`;
    const target = this.resolveSafePath(key);
    await fs.writeFile(target, buffer, { mode: 0o640 });
    return key;
  }

  async read(storageKey: string): Promise<Buffer> {
    const target = this.resolveSafePath(storageKey);
    return fs.readFile(target);
  }

  async delete(storageKey: string): Promise<void> {
    const target = this.resolveSafePath(storageKey);
    await fs.rm(target, { force: true });
  }
}

export function createStorageAdapter(driver: 'local' | 's3', uploadDir: string): StorageAdapter {
  if (driver === 's3') {
    // Cloud S3-compatible adapter hook (activated when APP_MODE=cloud + STORAGE_DRIVER=s3)
    throw new Error('S3 storage adapter requires cloud S3 credentials and @aws-sdk/client-s3 configuration');
  }
  return new LocalDiskStorageAdapter(uploadDir);
}
