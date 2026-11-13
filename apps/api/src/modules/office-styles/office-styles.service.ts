import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AttachmentsService } from '../ai/attachments.service';
import { DocumentsService } from '../documents/documents.service';
import { isOfficeFormat, type OfficeFormat } from '../office/office-content';
import type { OfficeSourceKind } from '../office/office-token';
import { extractStyleProfile, type OfficeStyleProfile } from './ooxml-extractor';

export interface DocumentTemplate {
  id: string;
  name: string;
  format: OfficeFormat;
  source_kind: 'upload' | 'document';
  source_id: string | null;
  size_bytes: number;
  summary: string;
  created_at: string;
}

const COLUMNS = `id, name, format, source_kind, source_id, size_bytes,
                 profile_json->>'summary' AS summary, created_at`;

@Injectable()
export class OfficeStylesService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
    private readonly attachments: AttachmentsService,
  ) {}

  private root(): string {
    return this.config.get<string>('app.aiUploadDir') ?? join(process.cwd(), 'var', 'ai-uploads');
  }

  private async source(
    userId: string,
    kind: OfficeSourceKind,
    id: string,
  ): Promise<{
    format: OfficeFormat;
    path: string;
    name: string;
    cached: OfficeStyleProfile | null;
  }> {
    if (kind === 'doc') {
      const doc = await this.documents.officeSource(userId, id);
      if (!isOfficeFormat(doc.format)) throw unsupported();
      return { format: doc.format, path: doc.absolutePath, name: doc.title, cached: null };
    }
    const att = await this.attachments.officeSource(userId, id);
    if (!isOfficeFormat(att.extension)) throw unsupported();
    return {
      format: att.extension,
      path: att.absolutePath,
      name: att.fileName.replace(/\.[^.]+$/, ''),
      cached: (att.styleProfile as OfficeStyleProfile | null) ?? null,
    };
  }

  /** Profil gaya untuk inspektur (lampiran memakai hasil cache saat unggah). */
  async profile(
    auth: AuthContext,
    kind: OfficeSourceKind,
    id: string,
  ): Promise<OfficeStyleProfile> {
    const src = await this.source(auth.user.id, kind, id);
    if (src.cached) return src.cached;
    return extractStyleProfile(src.format, await readFile(src.path));
  }

  /** Salin berkas sumber menjadi templat gaya; berkas tetap ada walau lampiran/dokumen dihapus. */
  async create(
    auth: AuthContext,
    kind: OfficeSourceKind,
    id: string,
    name?: string,
  ): Promise<DocumentTemplate> {
    const src = await this.source(auth.user.id, kind, id);
    const buffer = await readFile(src.path);
    const profile = await extractStyleProfile(src.format, buffer);
    const storagePath = join('templates', auth.user.id, `${randomUUID()}.${src.format}`);
    const absolute = join(this.root(), storagePath);
    await mkdir(dirname(absolute), { recursive: true });
    await copyFile(src.path, absolute);
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO document_templates
           (user_id, source_kind, source_id, format, name, storage_path, size_bytes, profile_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUMNS}`,
        [
          auth.user.id,
          kind === 'doc' ? 'document' : 'upload',
          id,
          src.format,
          (name?.trim() || src.name).slice(0, 200),
          storagePath,
          buffer.length,
          JSON.stringify(profile),
        ],
      )) as DocumentTemplate[];
      return rows[0]!;
    } catch (error) {
      await rm(absolute, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  list(auth: AuthContext): Promise<DocumentTemplate[]> {
    return this.dataSource.query(
      `SELECT ${COLUMNS} FROM document_templates WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [auth.user.id],
    ) as Promise<DocumentTemplate[]>;
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<DocumentTemplate & { profile: OfficeStyleProfile }> {
    const rows = (await this.dataSource.query(
      `SELECT ${COLUMNS}, profile_json AS profile FROM document_templates WHERE id = $1 AND user_id = $2`,
      [id, auth.user.id],
    )) as Array<DocumentTemplate & { profile: OfficeStyleProfile }>;
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Templat tidak ditemukan.', 404);
    return rows[0];
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const rows = updatedRows<{ storage_path: string }>(
      await this.dataSource.query(
        `DELETE FROM document_templates WHERE id = $1 AND user_id = $2 RETURNING storage_path`,
        [id, auth.user.id],
      ),
    );
    if (rows.length === 0)
      throw new AppError(ERROR_CODES.notFound, 'Templat tidak ditemukan.', 404);
    await rm(join(this.root(), rows[0]!.storage_path), { force: true }).catch(() => undefined);
  }
}

function unsupported(): AppError {
  return new AppError(
    ERROR_CODES.validation,
    'Hanya Word, Excel, dan PowerPoint yang dapat dibaca gayanya.',
    400,
  );
}
