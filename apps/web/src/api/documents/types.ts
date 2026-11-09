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
  created_at: string;
};

export type DocumentPreview = {
  id: string;
  title: string;
  format: DocumentFormat;
  text: string | null;
  sheets?: Array<{ name: string; rows: string[][] }>;
  slides?: Array<{ title: string; bullets: string[]; notes?: string }>;
};
