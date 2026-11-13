import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import type { DocumentFormat, DocumentSpec } from './document-spec';
import { extractOfficeContent, isOfficeFormat } from '../office/office-content';
import { renderDocument } from './renderers';
import { renderFromTemplate } from './template-renderers';

export interface UserDocument {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  title: string;
  format: DocumentFormat;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  version: number;
  created_at: string;
  updated_at: string | null;
}

export interface DocumentPreview {
  id: string;
  title: string;
  format: DocumentFormat;
  text: string | null;
  sheets?: Array<{ name: string; rows: string[][] }>;
  slides?: Array<{ title: string; bullets: string[]; notes?: string }>;
}

const COLUMNS = `id, conversation_id, message_id::text AS message_id, title, format, file_name,
                 mime_type, size_bytes, version, created_at, updated_at`;

function fileNameFor(title: string, extension: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'dokumen'}.${extension}`;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  private root(): string {
    return this.config.get<string>('app.aiUploadDir') ?? join(process.cwd(), 'var', 'ai-uploads');
  }

  /** Render spec menjadi berkas, simpan ke disk, dan catat di tabel. */
  async create(
    userId: string,
    conversationId: string | null,
    spec: DocumentSpec,
  ): Promise<UserDocument> {
    const rendered = spec.templateId
      ? await renderFromTemplate(spec, await this.templateBuffer(userId, spec.templateId, spec.format))
      : await renderDocument(spec);
    const storagePath = join('documents', userId, `${randomUUID()}.${rendered.extension}`);
    const absolute = join(this.root(), storagePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, rendered.buffer);
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO user_documents
           (user_id, conversation_id, title, format, file_name, mime_type, size_bytes,
            storage_path, content_text, preview_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${COLUMNS}`,
        [
          userId,
          conversationId,
          spec.title,
          spec.format,
          fileNameFor(spec.title, rendered.extension),
          rendered.mimeType,
          rendered.buffer.length,
          storagePath,
          rendered.contentText,
          rendered.previewJson ? JSON.stringify(rendered.previewJson) : null,
        ],
      )) as UserDocument[];
      return rows[0]!;
    } catch (error) {
      await rm(absolute, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Berkas templat milik pengguna: templat gaya tersimpan, atau lampiran Office di percakapan miliknya.
   * Format harus sama dengan dokumen yang dibuat.
   */
  private async templateBuffer(userId: string, templateId: string, format: DocumentFormat): Promise<Buffer> {
    const rows = (await this.dataSource.query(
      `SELECT storage_path, format FROM document_templates WHERE id = $1 AND user_id = $2
       UNION ALL
       SELECT a.storage_path, ltrim(a.extension, '.') AS format
         FROM conversation_attachments a
         JOIN conversations c ON c.id = a.conversation_id
        WHERE a.id = $1 AND c.user_id = $2 AND a.kind = 'document' AND a.storage_path IS NOT NULL
       LIMIT 1`,
      [templateId, userId],
    )) as Array<{ storage_path: string; format: string }>;
    const row = rows[0];
    if (!row) throw new AppError(ERROR_CODES.validation, 'Templat gaya tidak ditemukan.', 400);
    if (row.format !== format) {
      throw new AppError(
        ERROR_CODES.validation,
        `Templat berformat ${row.format}, tidak bisa dipakai untuk dokumen ${format}.`,
        400,
      );
    }
    return readFile(join(this.root(), row.storage_path));
  }

  /** Kaitkan dokumen yang dibuat pada giliran ini ke pesan asisten yang tersimpan. */
  async attachToMessage(userId: string, documentIds: string[], messageId: string): Promise<void> {
    if (documentIds.length === 0) return;
    await this.dataSource.query(
      `UPDATE user_documents SET message_id = $3
        WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, documentIds, messageId],
    );
  }

  async forConversation(userId: string, conversationId: string): Promise<UserDocument[]> {
    return (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM user_documents
        WHERE user_id = $1 AND conversation_id = $2
        ORDER BY created_at`,
      [userId, conversationId],
    )) as UserDocument[];
  }

  async list(
    userId: string,
    query: { search?: string; skip: number; take: number },
  ): Promise<{ items: UserDocument[]; total: number }> {
    const params: unknown[] = [userId];
    let where = 'user_id = $1';
    if (query.search?.trim()) {
      params.push(`%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`);
      where += ` AND title ILIKE $${params.length}`;
    }
    const total = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM user_documents WHERE ${where}`,
      params,
    )) as { n: number }[];
    const items = (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM user_documents WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.take, query.skip],
    )) as UserDocument[];
    return { items, total: total[0]?.n ?? 0 };
  }

  private async find(userId: string, id: string) {
    const rows = (await this.dataSource.query(
      `SELECT ${COLUMNS}, storage_path, content_text, preview_json
         FROM user_documents WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )) as Array<
      UserDocument & {
        storage_path: string;
        content_text: string | null;
        preview_json: { sheets?: DocumentPreview['sheets']; slides?: DocumentPreview['slides'] } | null;
      }
    >;
    const row = rows[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Dokumen tidak ditemukan.', 404);
    return row;
  }

  async get(userId: string, id: string): Promise<UserDocument> {
    const rows = (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM user_documents WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )) as UserDocument[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Dokumen tidak ditemukan.', 404);
    return rows[0];
  }

  async preview(userId: string, id: string): Promise<DocumentPreview> {
    const row = await this.find(userId, id);
    return {
      id: row.id,
      title: row.title,
      format: row.format,
      text: row.content_text,
      ...(row.preview_json?.sheets ? { sheets: row.preview_json.sheets } : {}),
      ...(row.preview_json?.slides ? { slides: row.preview_json.slides } : {}),
    };
  }

  async download(
    userId: string,
    id: string,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const row = await this.find(userId, id);
    try {
      const buffer = await readFile(join(this.root(), row.storage_path));
      return { buffer, fileName: row.file_name, mimeType: row.mime_type };
    } catch (error) {
      this.logger.warn(`Berkas dokumen ${id} tidak terbaca: ${(error as Error).message}`);
      throw new AppError(ERROR_CODES.notFound, 'Berkas dokumen tidak ditemukan di penyimpanan.', 404);
    }
  }

  /** Berkas + metadata untuk OnlyOffice (hanya pemilik). */
  async officeSource(
    userId: string,
    id: string,
  ): Promise<UserDocument & { absolutePath: string }> {
    const row = await this.find(userId, id);
    return { ...row, absolutePath: join(this.root(), row.storage_path) };
  }

  /**
   * Simpan hasil suntingan OnlyOffice sebagai versi baru. Berkas lama tetap di disk dan
   * dicatat di user_document_versions agar dapat dipulihkan.
   */
  async saveEditedVersion(userId: string, id: string, buffer: Buffer): Promise<UserDocument> {
    const row = await this.find(userId, id);
    if (!isOfficeFormat(row.format)) {
      throw new AppError(ERROR_CODES.validation, 'Format ini tidak dapat disunting.', 400);
    }
    let extracted: Awaited<ReturnType<typeof extractOfficeContent>> = {
      contentText: row.content_text,
      previewJson: row.preview_json,
    };
    try {
      extracted = await extractOfficeContent(row.format, buffer);
    } catch (error) {
      this.logger.warn(`Ekstraksi ulang dokumen ${id} gagal: ${(error as Error).message}`);
    }
    const storagePath = join('documents', userId, `${randomUUID()}.${row.format}`);
    const absolute = join(this.root(), storagePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO user_document_versions (document_id, version, storage_path, size_bytes)
           VALUES ($1, $2, $3, $4) ON CONFLICT (document_id, version) DO NOTHING`,
          [id, row.version, row.storage_path, row.size_bytes],
        );
        const updated = updatedRows<UserDocument>(
          await manager.query(
            `UPDATE user_documents
                SET storage_path = $3, size_bytes = $4, version = version + 1, updated_at = now(),
                    content_text = $5, preview_json = $6
              WHERE id = $1 AND user_id = $2
              RETURNING ${COLUMNS}`,
            [
              id,
              userId,
              storagePath,
              buffer.length,
              extracted.contentText,
              extracted.previewJson ? JSON.stringify(extracted.previewJson) : null,
            ],
          ),
        );
        if (updated.length === 0) throw new AppError(ERROR_CODES.notFound, 'Dokumen tidak ditemukan.', 404);
        return updated[0]!;
      });
    } catch (error) {
      await rm(absolute, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const versions = (await this.dataSource.query(
      `SELECT v.storage_path FROM user_document_versions v
         JOIN user_documents d ON d.id = v.document_id
        WHERE d.id = $1 AND d.user_id = $2`,
      [id, userId],
    )) as { storage_path: string }[];
    const rows = updatedRows<{ storage_path: string }>(
      await this.dataSource.query(
        `DELETE FROM user_documents WHERE id = $1 AND user_id = $2 RETURNING storage_path`,
        [id, userId],
      ),
    );
    if (rows.length === 0) throw new AppError(ERROR_CODES.notFound, 'Dokumen tidak ditemukan.', 404);
    for (const path of [rows[0]!.storage_path, ...versions.map((v) => v.storage_path)]) {
      await rm(join(this.root(), path), { force: true }).catch(() => undefined);
    }
  }
}
