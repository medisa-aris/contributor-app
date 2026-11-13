import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { AttachmentsService } from '../ai/attachments.service';
import { DocumentsService } from '../documents/documents.service';
import { DOCUMENT_TYPE, isOfficeFormat, type OfficeFormat } from './office-content';
import {
  mintFileToken,
  signJwt,
  verifyFileToken,
  verifyJwt,
  type FileTokenClaims,
  type OfficeSourceKind,
} from './office-token';

/** Batas ukuran berkas hasil suntingan yang diterima dari Document Server. */
export const OFFICE_MAX_SAVE_BYTES = 50 * 1024 * 1024;
const FILE_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Status callback OnlyOffice: 2 = siap disimpan (sesi ditutup), 6 = simpan paksa. */
const SAVE_STATUSES = new Set([2, 6]);

export interface EditorConfigResponse {
  enabled: boolean;
  documentServerUrl: string | null;
  config: Record<string, unknown> | null;
  version: number;
}

interface CallbackBody {
  key?: string;
  status?: number;
  url?: string;
  token?: string;
}

@Injectable()
export class OfficeService {
  private readonly logger = new Logger(OfficeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
    private readonly attachments: AttachmentsService,
  ) {}

  private settings() {
    const enabled = this.config.get<boolean>('app.onlyofficeEnabled') ?? false;
    const publicUrl = this.config.get<string | null>('app.onlyofficePublicUrl') ?? null;
    const jwtSecret = this.config.get<string | null>('app.onlyofficeJwtSecret') ?? null;
    const fileSecret = this.config.get<string | null>('app.officeFileTokenSecret') ?? null;
    const internalUrl =
      this.config.get<string>('app.onlyofficeApiInternalUrl') ?? 'http://host.docker.internal:3000';
    return {
      enabled: enabled && !!publicUrl && !!jwtSecret && !!fileSecret,
      publicUrl,
      jwtSecret,
      fileSecret,
      internalUrl,
    };
  }

  private requireSettings() {
    const s = this.settings();
    if (!s.enabled) {
      throw new AppError(ERROR_CODES.notFound, 'Penyunting OnlyOffice belum diaktifkan.', 404);
    }
    return s as {
      enabled: true;
      publicUrl: string;
      jwtSecret: string;
      fileSecret: string;
      internalUrl: string;
    };
  }

  /** Konfigurasi editor yang ditandatangani untuk dokumen AI (mode sunting) atau lampiran (baca saja). */
  async editorConfig(
    auth: AuthContext,
    kind: OfficeSourceKind,
    id: string,
  ): Promise<EditorConfigResponse> {
    const s = this.settings();
    if (!s.enabled) return { enabled: false, documentServerUrl: null, config: null, version: 0 };
    const { publicUrl, jwtSecret, fileSecret, internalUrl } = this.requireSettings();

    let format: OfficeFormat;
    let title: string;
    let version: number;
    let editable: boolean;
    if (kind === 'doc') {
      const doc = await this.documents.officeSource(auth.user.id, id);
      if (!isOfficeFormat(doc.format)) {
        throw new AppError(ERROR_CODES.validation, 'Format ini tidak dibuka di OnlyOffice.', 400);
      }
      format = doc.format;
      title = doc.file_name;
      version = doc.version;
      editable = true;
    } else {
      const att = await this.attachments.officeSource(auth.user.id, id);
      if (!isOfficeFormat(att.extension)) {
        throw new AppError(ERROR_CODES.validation, 'Format ini tidak dibuka di OnlyOffice.', 400);
      }
      format = att.extension;
      title = att.fileName;
      version = 0;
      editable = false;
    }

    const claims: FileTokenClaims = {
      k: kind,
      id,
      uid: auth.user.id,
      v: version,
      exp: Math.floor(Date.now() / 1000) + FILE_TOKEN_TTL_SECONDS,
    };
    const t = encodeURIComponent(mintFileToken(claims, fileSecret));
    const config: Record<string, unknown> = {
      documentType: DOCUMENT_TYPE[format],
      document: {
        fileType: format,
        // Kunci berubah tiap versi agar Document Server tidak menyajikan salinan lama dari cache.
        key: `${kind}-${id}-v${version}`,
        title,
        url: `${internalUrl}/api/office/files/${kind}/${id}?t=${t}`,
        permissions: {
          edit: editable,
          download: true,
          print: true,
          comment: editable,
          review: editable,
        },
      },
      editorConfig: {
        mode: editable ? 'edit' : 'view',
        lang: 'id',
        ...(editable
          ? { callbackUrl: `${internalUrl}/api/office/callback/${kind}/${id}?t=${t}` }
          : {}),
        user: { id: auth.user.id, name: auth.user.displayName },
        customization: {
          autosave: true,
          forcesave: true,
          compactHeader: true,
          hideRightMenu: false,
          uiTheme: 'theme-light',
        },
      },
    };
    const token = signJwt(config, jwtSecret);
    return { enabled: true, documentServerUrl: publicUrl, config: { ...config, token }, version };
  }

  /** Header Authorization dari Document Server (bila ada) harus bertanda tangan sah. */
  private verifyServerHeader(authorization: string | undefined, jwtSecret: string): void {
    if (!authorization) {
      throw new AppError(ERROR_CODES.unauthenticated, 'Token Document Server tidak ada.', 401);
    }
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!verifyJwt(token, jwtSecret)) {
      throw new AppError(ERROR_CODES.forbidden, 'Token Document Server tidak valid.', 403);
    }
  }

  private verifyFile(
    kind: OfficeSourceKind,
    id: string,
    t: string | undefined,
    fileSecret: string,
  ): FileTokenClaims {
    const claims = t ? verifyFileToken(t, fileSecret, { k: kind, id }) : null;
    if (!claims)
      throw new AppError(ERROR_CODES.forbidden, 'Token berkas tidak valid atau kedaluwarsa.', 403);
    return claims;
  }

  /** Aliran berkas untuk Document Server; diautentikasi lewat token berkas + JWT server. */
  async openFile(
    kind: OfficeSourceKind,
    id: string,
    t: string | undefined,
    authorization: string | undefined,
  ): Promise<{ stream: Readable; size: number; fileName: string }> {
    const { jwtSecret, fileSecret } = this.requireSettings();
    this.verifyServerHeader(authorization, jwtSecret);
    const claims = this.verifyFile(kind, id, t, fileSecret);
    const source =
      kind === 'doc'
        ? await this.documents
            .officeSource(claims.uid, id)
            .then((d) => ({ path: d.absolutePath, name: d.file_name }))
        : await this.attachments
            .officeSource(claims.uid, id)
            .then((a) => ({ path: a.absolutePath, name: a.fileName }));
    const info = await stat(source.path).catch(() => null);
    if (!info)
      throw new AppError(ERROR_CODES.notFound, 'Berkas tidak ditemukan di penyimpanan.', 404);
    return { stream: createReadStream(source.path), size: info.size, fileName: source.name };
  }

  /**
   * Callback simpan dari Document Server. Payload diambil dari JWT (bukan body mentah) agar
   * url unduhan tidak dapat dipalsukan.
   */
  async handleCallback(
    kind: OfficeSourceKind,
    id: string,
    t: string | undefined,
    body: CallbackBody,
    authorization: string | undefined,
  ): Promise<{ error: number }> {
    const { jwtSecret, fileSecret, publicUrl } = this.requireSettings();
    const claims = this.verifyFile(kind, id, t, fileSecret);
    if (kind !== 'doc') return { error: 0 };

    const payload = this.callbackPayload(body, authorization, jwtSecret);
    if (!payload) throw new AppError(ERROR_CODES.forbidden, 'Token callback tidak valid.', 403);
    const status = Number(payload.status);
    if (!SAVE_STATUSES.has(status)) return { error: 0 };
    if (typeof payload.url !== 'string') return { error: 1 };

    try {
      const buffer = await this.downloadEdited(payload.url, publicUrl);
      const saved = await this.documents.saveEditedVersion(claims.uid, id, buffer);
      this.logger.log(
        `Dokumen ${id} disimpan dari OnlyOffice (status ${status}) sebagai versi ${saved.version}`,
      );
      return { error: 0 };
    } catch (error) {
      this.logger.warn(
        `Gagal menyimpan dokumen ${id} dari OnlyOffice: ${(error as Error).message}`,
      );
      return { error: 1 };
    }
  }

  private callbackPayload(
    body: CallbackBody,
    authorization: string | undefined,
    jwtSecret: string,
  ): CallbackBody | null {
    if (typeof body.token === 'string') {
      return verifyJwt(body.token, jwtSecret) as CallbackBody | null;
    }
    if (authorization) {
      const decoded = verifyJwt(authorization.replace(/^Bearer\s+/i, ''), jwtSecret);
      const inner = decoded?.payload;
      return inner && typeof inner === 'object' ? (inner as CallbackBody) : null;
    }
    return null;
  }

  /** Unduh hasil suntingan; hanya dari origin Document Server yang dikonfigurasi (cegah SSRF). */
  private async downloadEdited(url: string, publicUrl: string): Promise<Buffer> {
    assertDocumentServerUrl(url, publicUrl);
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) throw new Error(`Unduhan gagal: HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > OFFICE_MAX_SAVE_BYTES) throw new Error('Berkas hasil suntingan terlalu besar.');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > OFFICE_MAX_SAVE_BYTES) throw new Error('Berkas hasil suntingan terlalu besar.');
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    // Berkas OOXML adalah arsip ZIP.
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      throw new Error('Berkas hasil suntingan bukan dokumen Office yang valid.');
    }
    return buffer;
  }
}

/** URL unduhan callback wajib berasal dari origin Document Server yang dikonfigurasi. */
export function assertDocumentServerUrl(url: string, publicUrl: string): void {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error('URL hasil suntingan tidak valid.');
  }
  if (target.origin !== new URL(publicUrl).origin) {
    throw new Error(`URL hasil suntingan bukan dari Document Server: ${target.origin}`);
  }
}
