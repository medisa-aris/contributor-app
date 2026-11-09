import { ApiError, apiDelete, apiGet, apiGetPaged, apiUrl } from '@/api/http';
import type { DocumentPreview, UserDocument } from './types';

export type { DocumentFormat, DocumentPreview, UserDocument } from './types';

export function listUserDocuments(query: { search?: string; page: number; pageSize: number }) {
  return apiGetPaged<UserDocument>('/documents', query);
}

export function documentPreview(id: string): Promise<DocumentPreview> {
  return apiGet<DocumentPreview>(`/documents/${id}/preview`);
}

export function deleteUserDocument(id: string): Promise<void> {
  return apiDelete<void>(`/documents/${id}`);
}

/** Ambil berkas asli sebagai Blob (cookie sesi ikut terkirim). */
export async function fetchDocumentBlob(id: string, inline = false): Promise<Blob> {
  const response = await fetch(apiUrl(`/documents/${id}/download${inline ? '?inline=1' : ''}`), {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Berkas dokumen tidak dapat diambil.');
  }
  return response.blob();
}

/** Unduh berkas ke perangkat pengguna. */
export async function downloadUserDocument(doc: Pick<UserDocument, 'id' | 'file_name'>): Promise<void> {
  const blob = await fetchDocumentBlob(doc.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.file_name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FORMAT_LABEL: Record<string, string> = {
  md: 'Markdown',
  txt: 'Teks',
  html: 'HTML',
  json: 'JSON',
  csv: 'CSV',
  xlsx: 'Excel',
  docx: 'Word',
  pptx: 'PowerPoint',
  pdf: 'PDF',
};

export function formatLabel(format: string): string {
  return FORMAT_LABEL[format] ?? format.toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
