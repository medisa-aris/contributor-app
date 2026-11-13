import { apiDelete, apiGet, apiPost } from '@/api/http';
import type { OfficeSourceKind } from '@/api/documents';

/** Profil gaya hasil ekstraksi OOXML (lihat apps/api/.../ooxml-extractor.ts). */
export type FontTriplet = { latin: string | null; ea: string | null; cs: string | null };

export type ThemeProfile = {
  name: string | null;
  colors: Record<string, string>;
  fonts: { major: FontTriplet; minor: FontTriplet };
};

export type DocxStyle = {
  id: string;
  name: string;
  type: string;
  basedOn: string | null;
  font: string | null;
  sizePt: number | null;
  color: string | null;
  bold: boolean;
  italic: boolean;
  spacingBeforePt: number | null;
  spacingAfterPt: number | null;
  isDefault: boolean;
};

export type HeaderFooterPart = {
  part: string;
  kind: 'header' | 'footer';
  text: string;
  images: string[];
};

export type ShapeInfo = {
  kind: 'shape' | 'picture' | 'group' | 'graphic' | 'connector';
  name: string;
  placeholder: { type: string; idx: string | null } | null;
  box: { x: number; y: number; w: number; h: number } | null;
  geometry: string | null;
  fill: string | null;
  line: string | null;
  text: string[];
  image: string | null;
  smartArt: boolean;
};

export type SlidePartInfo = {
  part: string;
  name: string | null;
  type: string | null;
  background: string | null;
  shapes: ShapeInfo[];
  layout?: string | null;
  master?: string | null;
};

export type SmartArtNode = { text: string; children: SmartArtNode[] };

export type OfficeStyleProfile = {
  format: 'docx' | 'pptx' | 'xlsx';
  theme: ThemeProfile | null;
  summary: string;
  docx?: {
    docDefaults: { font: string | null; sizePt: number | null; color: string | null };
    styles: DocxStyle[];
    page: {
      widthMm: number | null;
      heightMm: number | null;
      orientation: 'portrait' | 'landscape';
      marginsMm: {
        top: number | null;
        right: number | null;
        bottom: number | null;
        left: number | null;
      };
    };
    headers: HeaderFooterPart[];
    footers: HeaderFooterPart[];
    numbering: { abstractCount: number; formats: string[] };
  };
  pptx?: {
    slideSize: { widthEmu: number; heightEmu: number; widthIn: number; heightIn: number };
    masters: SlidePartInfo[];
    layouts: SlidePartInfo[];
    slides: SlidePartInfo[];
    smartArt: Array<{
      part: string;
      slide: string | null;
      layout: string | null;
      nodes: SmartArtNode[];
    }>;
  };
  xlsx?: {
    fonts: Array<{
      name: string | null;
      sizePt: number | null;
      color: string | null;
      bold: boolean;
    }>;
    fills: string[];
    numFmts: Array<{ id: number; code: string }>;
    cellStyles: string[];
    sheets: Array<{ name: string; columnWidths: number[] }>;
  };
};

export type DocumentTemplate = {
  id: string;
  name: string;
  format: 'docx' | 'pptx' | 'xlsx';
  source_kind: 'upload' | 'document';
  source_id: string | null;
  size_bytes: number;
  summary: string;
  created_at: string;
};

export function fetchStyleProfile(kind: OfficeSourceKind, id: string): Promise<OfficeStyleProfile> {
  return apiGet<OfficeStyleProfile>(`/office-styles/${kind}/${id}/profile`);
}

export function listTemplates(): Promise<DocumentTemplate[]> {
  return apiGet<DocumentTemplate[]>('/office-styles/templates');
}

export function createTemplate(
  sourceKind: OfficeSourceKind,
  sourceId: string,
  name?: string,
): Promise<DocumentTemplate> {
  return apiPost<DocumentTemplate>('/office-styles/templates', {
    sourceKind,
    sourceId,
    ...(name ? { name } : {}),
  });
}

export function deleteTemplate(id: string): Promise<void> {
  return apiDelete<void>(`/office-styles/templates/${id}`);
}

/** "scheme:accent1" / "theme:..." → hex dari tema; hex biasa dikembalikan apa adanya. */
export function resolveColor(value: string | null, theme: ThemeProfile | null): string | null {
  if (!value || value === 'none' || value === 'gradient' || value === 'image' || value === 'theme')
    return null;
  const alias: Record<string, string> = {
    tx1: 'dk1',
    bg1: 'lt1',
    tx2: 'dk2',
    bg2: 'lt2',
    text1: 'dk1',
    background1: 'lt1',
    text2: 'dk2',
    background2: 'lt2',
    hyperlink: 'hlink',
  };
  if (value.startsWith('scheme:')) {
    const key = value.slice(7);
    const hex = theme?.colors[alias[key] ?? key];
    return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null;
  }
  const hex = value.length === 8 ? value.slice(2) : value; // ARGB Excel
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null;
}
