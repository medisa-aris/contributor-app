export type DocumentFormat = 'md' | 'txt' | 'html' | 'json' | 'csv' | 'xlsx' | 'docx' | 'pptx' | 'pdf';

export type UserDocument = {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  title: string;
  format: DocumentFormat;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** Naik setiap kali disimpan dari OnlyOffice. */
  version?: number;
  created_at: string;
  updated_at?: string | null;
};

/** Sumber berkas untuk OnlyOffice: dokumen AI (dapat disunting) atau lampiran (baca saja). */
export type OfficeSourceKind = 'doc' | 'att';

export type OfficeEditorConfig = {
  enabled: boolean;
  documentServerUrl: string | null;
  /** Konfigurasi DocsAPI.DocEditor yang sudah ditandatangani server (berisi `token`). */
  config: Record<string, unknown> | null;
  version: number;
};

export type DocumentPreview = {
  id: string;
  title: string;
  format: DocumentFormat;
  text: string | null;
  sheets?: Array<{ name: string; rows: string[][] }>;
  slides?: Array<{ title: string; bullets: string[]; notes?: string }>;
};
