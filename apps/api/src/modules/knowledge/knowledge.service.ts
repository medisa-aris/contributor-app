import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS } from '@contributor/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import type {
  CreateCollectionDto,
  CreateDocumentDto,
  CreateSourceDto,
  SearchKnowledgeDto,
  SetCollectionSourcesDto,
  UpdateCollectionDto,
  UpdateDocumentDto,
  UpdateSourceDto,
} from './dto/knowledge.dto';

export interface SourceRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  origin: string;
  acl: { roles?: string[]; departments?: string[] };
  doc_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  source_id: string;
  source_name: string | null;
  title: string;
  locator: string | null;
  status: string;
  index_error: string | null;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  source_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface SearchHit {
  document_id: string;
  title: string;
  locator: string | null;
  snippet: string;
  rank: number;
  source_id: string;
  source_name: string;
  source_code: string;
}

const SELECT_SOURCES = `
  SELECT s.id, s.code, s.name, s.description, s.origin, s.acl, s.created_at, s.updated_at,
         (SELECT count(*)::int FROM knowledge_documents d WHERE d.source_id = s.id) AS doc_count
    FROM knowledge_sources s`;

/** Kondisi SQL visibilitas ACL sumber pengetahuan; param urutan: roleCodes, deptId, isSuper. */
const ACL_VISIBLE = `($3::boolean OR (
  COALESCE(jsonb_array_length(COALESCE(acl->'roles', '[]'::jsonb)), 0) = 0
  OR (acl->'roles') ?| $1::text[]
) AND (
  COALESCE(jsonb_array_length(COALESCE(acl->'departments', '[]'::jsonb)), 0) = 0
  OR (acl->'departments') @> to_jsonb($2::text)
))`;

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private async aclParams(auth: AuthContext): Promise<[string[], string | null, boolean]> {
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT r.code
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1
       UNION
       SELECT DISTINCT r.code
         FROM user_groups ug
         JOIN group_roles gr ON gr.group_id = ug.group_id
         JOIN roles r ON r.id = gr.role_id
        WHERE ug.user_id = $1`,
      [auth.user.id],
    )) as { code: string }[];
    return [rows.map((r) => r.code), auth.user.departmentId, auth.user.isSuperadmin];
  }

  async listSources(
    auth: AuthContext,
    options: { skip: number; take: number },
  ): Promise<{ items: SourceRow[]; total: number }> {
    const [roleCodes, deptId, isSuper] = await this.aclParams(auth);
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM knowledge_sources WHERE ${ACL_VISIBLE}`,
      [roleCodes, deptId, isSuper],
    )) as { total: number }[];
    const items = (await this.dataSource.query(
      `${SELECT_SOURCES} WHERE ${ACL_VISIBLE} ORDER BY s.name LIMIT $4 OFFSET $5`,
      [roleCodes, deptId, isSuper, options.take, options.skip],
    )) as SourceRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  /** Sumber harus terlihat oleh pengguna (dipakai detail dokumen, pencarian, dsb.). */
  private async assertSourceVisible(auth: AuthContext, sourceId: string): Promise<void> {
    const [roleCodes, deptId, isSuper] = await this.aclParams(auth);
    const rows = (await this.dataSource.query(
      `SELECT id FROM knowledge_sources WHERE ${ACL_VISIBLE} AND id = $4`,
      [roleCodes, deptId, isSuper, sourceId],
    )) as { id: string }[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Sumber pengetahuan tidak ditemukan.', 404);
    }
  }

  async createSource(auth: AuthContext, dto: CreateSourceDto): Promise<SourceRow> {
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO knowledge_sources (code, name, description, origin, acl)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [dto.code, dto.name, dto.description ?? null, dto.origin, JSON.stringify(dto.acl ?? {})],
      )) as { id: string }[];
      await this.audit.record({
        eventKey: AUDIT_EVENTS.knowledgeSourceCreated,
        severity: 'info',
        summary: `Membuat sumber pengetahuan "${dto.name}" (${dto.code})`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'knowledge_source',
        entityId: rows[0]!.id,
        payload: { code: dto.code, origin: dto.origin },
      });
      const detail = await this.sourceDetail(rows[0]!.id);
      return detail;
    } catch (error) {
      throw this.conflictAs(error, 'Kode sumber sudah dipakai.');
    }
  }

  async updateSource(
    auth: AuthContext,
    sourceId: string,
    dto: UpdateSourceDto,
  ): Promise<SourceRow> {
    await this.assertSourceVisible(auth, sourceId);
    const sets: string[] = [];
    const params: unknown[] = [sourceId];
    const push = (clause: string, value: unknown) => {
      params.push(value);
      sets.push(`${clause} = $${params.length}`);
    };
    if (dto.name !== undefined) push('name', dto.name);
    if (dto.description !== undefined) push('description', dto.description);
    if (dto.acl !== undefined) push('acl', JSON.stringify(dto.acl));
    if (sets.length > 0) {
      await this.dataSource.query(
        `UPDATE knowledge_sources SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeSourceUpdated,
      severity: 'info',
      summary: `Mengubah sumber pengetahuan ${sourceId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_source',
      entityId: sourceId,
      payload: { fields: Object.keys(dto) },
    });
    return this.sourceDetail(sourceId);
  }

  async deleteSource(auth: AuthContext, sourceId: string): Promise<void> {
    await this.assertSourceVisible(auth, sourceId);
    const rows = updatedRows<{ name: string }>(
      await this.dataSource.query(
        `DELETE FROM knowledge_sources WHERE id = $1 RETURNING name`,
        [sourceId],
      ),
    );
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Sumber pengetahuan tidak ditemukan.', 404);
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeSourceDeleted,
      severity: 'warn',
      summary: `Menghapus sumber pengetahuan "${rows[0]!.name}" beserta dokumennya`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_source',
      entityId: sourceId,
      payload: {},
    });
  }

  private async sourceDetail(sourceId: string): Promise<SourceRow> {
    const rows = (await this.dataSource.query(`${SELECT_SOURCES} WHERE s.id = $1`, [sourceId])) as SourceRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Sumber pengetahuan tidak ditemukan.', 404);
    }
    return rows[0]!;
  }

  async listDocuments(
    auth: AuthContext,
    options: { sourceId?: string; status?: string; search?: string; skip: number; take: number },
  ): Promise<{ items: DocumentRow[]; total: number }> {
    const [roleCodes, deptId, isSuper] = await this.aclParams(auth);
    const params: unknown[] = [roleCodes, deptId, isSuper];
    let where = ACL_VISIBLE.replaceAll('acl', 's.acl');
    if (options.sourceId) {
      params.push(options.sourceId);
      where += ` AND d.source_id = $${params.length}`;
    }
    if (options.status) {
      params.push(options.status);
      where += ` AND d.status = $${params.length}`;
    }
    if (options.search) {
      params.push(`%${options.search}%`);
      where += ` AND d.title ILIKE $${params.length}`;
    }
    const from = `FROM knowledge_documents d JOIN knowledge_sources s ON s.id = d.source_id WHERE ${where}`;
    const totalRows = (await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params)) as {
      total: number;
    }[];
    params.push(options.take, options.skip);
    const items = (await this.dataSource.query(
      `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.locator, d.status,
              d.index_error, d.indexed_at, d.created_at, d.updated_at
         ${from} ORDER BY d.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as DocumentRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async documentContent(auth: AuthContext, documentId: string): Promise<{ title: string; content: string }> {
    const rows = (await this.dataSource.query(
      `SELECT d.title, d.content, d.source_id FROM knowledge_documents d WHERE d.id = $1`,
      [documentId],
    )) as { title: string; content: string; source_id: string }[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Dokumen tidak ditemukan.', 404);
    }
    await this.assertSourceVisible(auth, rows[0]!.source_id);
    return { title: rows[0]!.title, content: rows[0]!.content };
  }

  async createDocument(auth: AuthContext, dto: CreateDocumentDto): Promise<DocumentRow> {
    await this.assertSourceVisible(auth, dto.sourceId);
    const rows = (await this.dataSource.query(
      `INSERT INTO knowledge_documents (source_id, title, locator, content, status, indexed_at)
       VALUES ($1, $2, $3, $4, 'indexed', now()) RETURNING id`,
      [dto.sourceId, dto.title, dto.locator ?? null, dto.content],
    )) as { id: string }[];
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeDocumentCreated,
      severity: 'info',
      summary: `Menambahkan dokumen "${dto.title}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_document',
      entityId: rows[0]!.id,
      payload: { sourceId: dto.sourceId },
    });
    return this.documentDetail(auth, rows[0]!.id);
  }

  async updateDocument(
    auth: AuthContext,
    documentId: string,
    dto: UpdateDocumentDto,
  ): Promise<DocumentRow> {
    const sets: string[] = [];
    const params: unknown[] = [documentId];
    const push = (clause: string, value: unknown) => {
      params.push(value);
      sets.push(`${clause} = $${params.length}`);
    };
    if (dto.title !== undefined) push('title', dto.title);
    if (dto.locator !== undefined) push('locator', dto.locator);
    if (dto.content !== undefined) {
      push('content', dto.content);
      sets.push(`indexed_at = now()`);
    }
    if (dto.status !== undefined) {
      push('status', dto.status);
      if (dto.status === 'indexed') sets.push(`indexed_at = now()`);
      if (dto.status === 'pending') sets.push(`indexed_at = NULL`);
    }
    if (sets.length > 0) {
      await this.dataSource.query(
        `UPDATE knowledge_documents SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeDocumentUpdated,
      severity: 'info',
      summary: `Mengubah dokumen ${documentId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_document',
      entityId: documentId,
      payload: { fields: Object.keys(dto) },
    });
    return this.documentDetail(auth, documentId);
  }

  async deleteDocument(auth: AuthContext, documentId: string): Promise<void> {
    const rows = updatedRows<{ title: string; source_id: string }>(
      await this.dataSource.query(
        `DELETE FROM knowledge_documents WHERE id = $1 RETURNING title, source_id`,
        [documentId],
      ),
    );
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Dokumen tidak ditemukan.', 404);
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeDocumentDeleted,
      severity: 'warn',
      summary: `Menghapus dokumen "${rows[0]!.title}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_document',
      entityId: documentId,
      payload: { sourceId: rows[0]!.source_id },
    });
  }

  private async documentDetail(auth: AuthContext, documentId: string): Promise<DocumentRow> {
    const rows = (await this.dataSource.query(
      `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.locator, d.status,
              d.index_error, d.indexed_at, d.created_at, d.updated_at
         FROM knowledge_documents d JOIN knowledge_sources s ON s.id = d.source_id
        WHERE d.id = $1`,
      [documentId],
    )) as DocumentRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Dokumen tidak ditemukan.', 404);
    }
    await this.assertSourceVisible(auth, rows[0]!.source_id);
    return rows[0]!;
  }

  async listCollections(
    options: { skip: number; take: number },
  ): Promise<{ items: CollectionRow[]; total: number }> {
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM knowledge_collections`,
    )) as { total: number }[];
    const items = (await this.dataSource.query(
      `SELECT c.id, c.code, c.name, c.description, c.created_at, c.updated_at,
              (SELECT count(*)::int FROM knowledge_collection_sources kcs WHERE kcs.collection_id = c.id) AS source_count
         FROM knowledge_collections c ORDER BY c.name LIMIT $1 OFFSET $2`,
      [options.take, options.skip],
    )) as CollectionRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async collectionDetail(collectionId: string): Promise<CollectionRow & { source_ids: string[] }> {
    const rows = (await this.dataSource.query(
      `SELECT id, code, name, description, created_at, updated_at,
              (SELECT count(*)::int FROM knowledge_collection_sources kcs WHERE kcs.collection_id = id) AS source_count
         FROM knowledge_collections WHERE id = $1`,
      [collectionId],
    )) as CollectionRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Koleksi tidak ditemukan.', 404);
    }
    const members = (await this.dataSource.query(
      `SELECT source_id FROM knowledge_collection_sources WHERE collection_id = $1`,
      [collectionId],
    )) as { source_id: string }[];
    return { ...rows[0]!, source_ids: members.map((m) => m.source_id) };
  }

  async createCollection(auth: AuthContext, dto: CreateCollectionDto): Promise<CollectionRow> {
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO knowledge_collections (code, name, description) VALUES ($1, $2, $3) RETURNING id`,
        [dto.code, dto.name, dto.description ?? null],
      )) as { id: string }[];
      await this.audit.record({
        eventKey: AUDIT_EVENTS.knowledgeCollectionCreated,
        severity: 'info',
        summary: `Membuat koleksi "${dto.name}" (${dto.code})`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'knowledge_collection',
        entityId: rows[0]!.id,
        payload: { code: dto.code },
      });
      return this.collectionDetail(rows[0]!.id);
    } catch (error) {
      throw this.conflictAs(error, 'Kode koleksi sudah dipakai.');
    }
  }

  async updateCollection(
    auth: AuthContext,
    collectionId: string,
    dto: UpdateCollectionDto,
  ): Promise<CollectionRow> {
    await this.collectionDetail(collectionId);
    const sets: string[] = [];
    const params: unknown[] = [collectionId];
    if (dto.name !== undefined) {
      params.push(dto.name);
      sets.push(`name = $${params.length}`);
    }
    if (dto.description !== undefined) {
      params.push(dto.description);
      sets.push(`description = $${params.length}`);
    }
    if (sets.length > 0) {
      await this.dataSource.query(
        `UPDATE knowledge_collections SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeCollectionUpdated,
      severity: 'info',
      summary: `Mengubah koleksi ${collectionId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_collection',
      entityId: collectionId,
      payload: { fields: Object.keys(dto) },
    });
    return this.collectionDetail(collectionId);
  }

  async deleteCollection(auth: AuthContext, collectionId: string): Promise<void> {
    const detail = await this.collectionDetail(collectionId);
    await this.dataSource.query(`DELETE FROM knowledge_collections WHERE id = $1`, [collectionId]);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeCollectionDeleted,
      severity: 'warn',
      summary: `Menghapus koleksi "${detail.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_collection',
      entityId: collectionId,
      payload: {},
    });
  }

  async setCollectionSources(
    auth: AuthContext,
    collectionId: string,
    dto: SetCollectionSourcesDto,
  ): Promise<CollectionRow & { source_ids: string[] }> {
    await this.collectionDetail(collectionId);
    await this.dataSource.query(
      `DELETE FROM knowledge_collection_sources WHERE collection_id = $1`,
      [collectionId],
    );
    for (const sourceId of dto.sourceIds) {
      await this.dataSource.query(
        `INSERT INTO knowledge_collection_sources (collection_id, source_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [collectionId, sourceId],
      );
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeCollectionUpdated,
      severity: 'info',
      summary: `Mengatur ${dto.sourceIds.length} sumber pada koleksi ${collectionId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_collection',
      entityId: collectionId,
      payload: { sourceIds: dto.sourceIds },
    });
    return this.collectionDetail(collectionId);
  }

  /** Pencarian full-text permission-aware dengan cuplikan sitasi (ts_headline). */
  async search(
    auth: AuthContext,
    dto: SearchKnowledgeDto,
  ): Promise<{ hits: SearchHit[]; total: number }> {
    const [roleCodes, deptId, isSuper] = await this.aclParams(auth);
    const params: unknown[] = [roleCodes, deptId, isSuper];
    let scope = '';
    if (dto.collectionId) {
      params.push(dto.collectionId);
      scope += ` AND d.source_id IN (SELECT source_id FROM knowledge_collection_sources WHERE collection_id = $${params.length})`;
    }
    if (dto.sourceIds && dto.sourceIds.length > 0) {
      params.push(dto.sourceIds);
      scope += ` AND d.source_id = ANY($${params.length}::uuid[])`;
    }
    const query = dto.query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
    if (query.length === 0) {
      throw new AppError(ERROR_CODES.validation, 'Kata kunci pencarian tidak valid.', 400);
    }
    params.push(query);
    const q = `$${params.length}`;
    const sql = `
      WITH q AS (SELECT websearch_to_tsquery('simple', ${q}) AS tsq),
           ranked AS (
        SELECT d.id AS document_id, d.title, d.locator, s.id AS source_id,
               s.name AS source_name, s.code AS source_code,
               ts_rank(
                 to_tsvector('simple', d.title || ' ' || d.content),
                 (SELECT tsq FROM q)
               ) AS rank
          FROM knowledge_documents d
          JOIN knowledge_sources s ON s.id = d.source_id
         WHERE d.status = 'indexed' AND ${ACL_VISIBLE.replaceAll('acl', 's.acl')}${scope}
           AND to_tsvector('simple', d.title || ' ' || d.content) @@ (SELECT tsq FROM q)
      )
      SELECT document_id, title, locator, source_id, source_name, source_code, rank,
             ts_headline(
               'simple',
               (SELECT content FROM knowledge_documents WHERE id = ranked.document_id),
               (SELECT tsq FROM q),
               'MaxFragments=2, MaxWords=25, MinWords=8, StartSel=<mark>, StopSel=</mark>'
             ) AS snippet
        FROM ranked
       ORDER BY rank DESC, title
       LIMIT 20`;
    const hits = (await this.dataSource.query(sql, params)) as (SearchHit & { rank: number })[];
    await this.audit.record({
      eventKey: AUDIT_EVENTS.knowledgeSearchPerformed,
      severity: 'info',
      summary: `Mencari "${dto.query.slice(0, 80)}" (${hits.length} hasil)`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'knowledge_search',
      entityId: null,
      payload: { query: dto.query.slice(0, 200), hits: hits.length, collectionId: dto.collectionId ?? null },
    });
    return { hits, total: hits.length };
  }

  private conflictAs(error: unknown, message: string): unknown {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return new AppError(ERROR_CODES.conflict, message, 409);
    }
    return error;
  }
}
