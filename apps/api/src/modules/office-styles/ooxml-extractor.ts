import { posix } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import type { OfficeFormat } from '../office/office-content';

/**
 * Ekstraksi gaya dari berkas OOXML (docx/pptx/xlsx): tema, style, master/layout, shape,
 * SmartArt, header/footer. Hasilnya JSON ringkas untuk inspektur gaya, konteks AI, dan
 * pemilihan layout saat dokumen baru dibuat dari templat.
 */

type Xml = Record<string, unknown>;

export interface ThemeProfile {
  name: string | null;
  /** dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink → hex tanpa #. */
  colors: Record<string, string>;
  fonts: { major: FontTriplet; minor: FontTriplet };
}

export interface FontTriplet {
  latin: string | null;
  ea: string | null;
  cs: string | null;
}

export interface DocxStyle {
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
}

export interface HeaderFooterPart {
  part: string;
  kind: 'header' | 'footer';
  text: string;
  images: string[];
}

export interface DocxProfile {
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
}

export interface ShapeInfo {
  kind: 'shape' | 'picture' | 'group' | 'graphic' | 'connector';
  name: string;
  placeholder: { type: string; idx: string | null } | null;
  /** Posisi dalam persen ukuran slide (0–100) agar mudah digambar. */
  box: { x: number; y: number; w: number; h: number } | null;
  geometry: string | null;
  fill: string | null;
  line: string | null;
  text: string[];
  image: string | null;
  smartArt: boolean;
}

export interface SlidePartInfo {
  part: string;
  name: string | null;
  type: string | null;
  background: string | null;
  shapes: ShapeInfo[];
}

export interface SmartArtNode {
  text: string;
  children: SmartArtNode[];
}

export interface SmartArtInfo {
  part: string;
  slide: string | null;
  layout: string | null;
  nodes: SmartArtNode[];
}

export interface PptxProfile {
  slideSize: { widthEmu: number; heightEmu: number; widthIn: number; heightIn: number };
  masters: SlidePartInfo[];
  layouts: Array<SlidePartInfo & { master: string | null }>;
  slides: Array<SlidePartInfo & { layout: string | null }>;
  smartArt: SmartArtInfo[];
}

export interface XlsxProfile {
  fonts: Array<{ name: string | null; sizePt: number | null; color: string | null; bold: boolean }>;
  fills: string[];
  numFmts: Array<{ id: number; code: string }>;
  cellStyles: string[];
  sheets: Array<{ name: string; columnWidths: number[] }>;
}

export interface OfficeStyleProfile {
  format: OfficeFormat;
  theme: ThemeProfile | null;
  docx?: DocxProfile;
  pptx?: PptxProfile;
  xlsx?: XlsxProfile;
  /** Ringkasan satu-dua kalimat untuk konteks model. */
  summary: string;
}

const LIMITS = {
  maxSlides: 60,
  maxShapes: 80,
  maxStyles: 200,
  maxText: 400,
  maxSmartArtNodes: 200,
} as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // Teks w:t / a:t bisa berupa objek bila punya atribut (xml:space).
  textNodeName: '#text',
});

function arr<T = Xml>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

function obj(value: unknown): Xml | undefined {
  if (Array.isArray(value)) return obj(value[0]);
  return value && typeof value === 'object' ? (value as Xml) : undefined;
}

function at(node: unknown, ...path: string[]): Xml | undefined {
  let current = obj(node);
  for (const key of path) {
    current = obj(current?.[key]);
    if (!current) return undefined;
  }
  return current;
}

function attr(node: unknown, name: string): string | null {
  const value = obj(node)?.[`@_${name}`];
  return typeof value === 'string' ? value : value === undefined ? null : String(value);
}

function num(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Teks per paragraf dari XML mentah; prefix p = 'w' (Word) atau 'a' (DrawingML). */
function paragraphsOf(xml: string, prefix: 'w' | 'a'): string[] {
  const out: string[] = [];
  const pRe = new RegExp(`<${prefix}:p[ >][\\s\\S]*?</${prefix}:p>`, 'g');
  const tRe = new RegExp(`<${prefix}:t(?: [^>]*)?>([\\s\\S]*?)</${prefix}:t>`, 'g');
  for (const p of xml.match(pRe) ?? []) {
    const text = Array.from(p.matchAll(tRe), (m) => decodeXml(m[1] ?? ''))
      .join('')
      .trim();
    if (text) out.push(text.slice(0, LIMITS.maxText));
  }
  return out;
}

async function readXml(zip: JSZip, path: string): Promise<{ raw: string; doc: Xml } | null> {
  const file = zip.file(path);
  if (!file) return null;
  const raw = await file.async('string');
  return { raw, doc: parser.parse(raw) as Xml };
}

/** Peta rId → path absolut dalam paket untuk sebuah part. */
async function relsOf(
  zip: JSZip,
  part: string,
): Promise<Map<string, { target: string; type: string }>> {
  const dir = posix.dirname(part);
  const relsPath = posix.join(dir, '_rels', `${posix.basename(part)}.rels`);
  const parsed = await readXml(zip, relsPath);
  const map = new Map<string, { target: string; type: string }>();
  for (const rel of arr(at(parsed?.doc, 'Relationships')?.Relationship)) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (!id || !target) continue;
    const external = attr(rel, 'TargetMode') === 'External';
    map.set(id, {
      target: external
        ? target
        : posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(dir, target)),
      type: (attr(rel, 'Type') ?? '').split('/').pop() ?? '',
    });
  }
  return map;
}

function sortedParts(zip: JSZip, re: RegExp): string[] {
  const n = (p: string) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0);
  return Object.keys(zip.files)
    .filter((p) => re.test(p))
    .sort((a, b) => n(a) - n(b));
}

// ---------- Tema ----------

function colorOf(node: Xml | undefined): string | null {
  if (!node) return null;
  const srgb = at(node, 'a:srgbClr');
  if (srgb) return attr(srgb, 'val');
  const sys = at(node, 'a:sysClr');
  if (sys) return attr(sys, 'lastClr') ?? attr(sys, 'val');
  const scheme = at(node, 'a:schemeClr');
  if (scheme) return `scheme:${attr(scheme, 'val')}`;
  return null;
}

function fontTriplet(node: Xml | undefined): FontTriplet {
  return {
    latin: attr(at(node, 'a:latin'), 'typeface'),
    ea: attr(at(node, 'a:ea'), 'typeface') || null,
    cs: attr(at(node, 'a:cs'), 'typeface') || null,
  };
}

async function extractTheme(zip: JSZip): Promise<ThemeProfile | null> {
  const path = sortedParts(zip, /^(word|ppt|xl)\/theme\/theme\d+\.xml$/)[0];
  if (!path) return null;
  const parsed = await readXml(zip, path);
  const elements = at(parsed?.doc, 'a:theme', 'a:themeElements');
  if (!elements) return null;
  const scheme = at(elements, 'a:clrScheme');
  const colors: Record<string, string> = {};
  for (const key of [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ]) {
    const value = colorOf(at(scheme, `a:${key}`));
    if (value) colors[key] = value;
  }
  const fontScheme = at(elements, 'a:fontScheme');
  return {
    name: attr(at(parsed?.doc, 'a:theme'), 'name'),
    colors,
    fonts: {
      major: fontTriplet(at(fontScheme, 'a:majorFont')),
      minor: fontTriplet(at(fontScheme, 'a:minorFont')),
    },
  };
}

// ---------- Word ----------

function runProps(rPr: Xml | undefined) {
  const fonts = at(rPr, 'w:rFonts');
  const size = num(attr(at(rPr, 'w:sz'), 'w:val'));
  const color = at(rPr, 'w:color');
  const toggle = (tag: string) => {
    if (!rPr || !(tag in rPr)) return false;
    const val = attr(at(rPr, tag), 'w:val');
    return val !== '0' && val !== 'false';
  };
  const themeFont = attr(fonts, 'w:asciiTheme');
  const themeColor = attr(color, 'w:themeColor');
  return {
    font:
      attr(fonts, 'w:ascii') ?? attr(fonts, 'w:hAnsi') ?? (themeFont ? `theme:${themeFont}` : null),
    sizePt: size === null ? null : size / 2,
    color:
      (attr(color, 'w:val') !== 'auto' ? attr(color, 'w:val') : null) ??
      (themeColor ? `scheme:${themeColor}` : null),
    bold: toggle('w:b'),
    italic: toggle('w:i'),
  };
}

const TWIP_TO_MM = 25.4 / 1440;

async function headerFooterParts(
  zip: JSZip,
  kind: 'header' | 'footer',
): Promise<HeaderFooterPart[]> {
  const parts = sortedParts(zip, new RegExp(`^word/${kind}\\d+\\.xml$`));
  const out: HeaderFooterPart[] = [];
  for (const part of parts) {
    const raw = await zip.file(part)!.async('string');
    const rels = await relsOf(zip, part);
    out.push({
      part,
      kind,
      text: paragraphsOf(raw, 'w').join('\n'),
      images: [...rels.values()].filter((r) => r.type === 'image').map((r) => r.target),
    });
  }
  return out;
}

async function extractDocx(zip: JSZip): Promise<DocxProfile> {
  const stylesXml = await readXml(zip, 'word/styles.xml');
  const root = at(stylesXml?.doc, 'w:styles');
  const defaults = runProps(at(root, 'w:docDefaults', 'w:rPrDefault', 'w:rPr'));
  const styles: DocxStyle[] = arr(root?.['w:style'])
    .slice(0, LIMITS.maxStyles)
    .map((style) => {
      const r = runProps(at(style, 'w:rPr'));
      const spacing = at(style, 'w:pPr', 'w:spacing');
      const before = num(attr(spacing, 'before'));
      const after = num(attr(spacing, 'after'));
      return {
        id: attr(style, 'w:styleId') ?? '',
        name: attr(at(style, 'w:name'), 'w:val') ?? attr(style, 'w:styleId') ?? '',
        type: attr(style, 'w:type') ?? 'paragraph',
        basedOn: attr(at(style, 'w:basedOn'), 'w:val'),
        font: r.font,
        sizePt: r.sizePt,
        color: r.color,
        bold: r.bold,
        italic: r.italic,
        spacingBeforePt: before === null ? null : before / 20,
        spacingAfterPt: after === null ? null : after / 20,
        isDefault: attr(style, 'w:default') === '1',
      };
    })
    .filter((s) => s.id);

  const documentXml = await readXml(zip, 'word/document.xml');
  const body = at(documentXml?.doc, 'w:document', 'w:body');
  const sectPr = at(body, 'w:sectPr');
  const pgSz = at(sectPr, 'w:pgSz');
  const pgMar = at(sectPr, 'w:pgMar');
  const mm = (v: string | null) => (num(v) === null ? null : round(num(v)! * TWIP_TO_MM));

  const numbering = await readXml(zip, 'word/numbering.xml');
  const abstracts = arr(at(numbering?.doc, 'w:numbering')?.['w:abstractNum']);
  const formats = new Set<string>();
  for (const abstract of abstracts) {
    for (const level of arr(abstract['w:lvl']).slice(0, 1)) {
      const fmt = attr(at(level, 'w:numFmt'), 'w:val');
      if (fmt) formats.add(fmt);
    }
  }

  return {
    docDefaults: { font: defaults.font, sizePt: defaults.sizePt, color: defaults.color },
    styles,
    page: {
      widthMm: mm(attr(pgSz, 'w:w')),
      heightMm: mm(attr(pgSz, 'w:h')),
      orientation: attr(pgSz, 'w:orient') === 'landscape' ? 'landscape' : 'portrait',
      marginsMm: {
        top: mm(attr(pgMar, 'w:top')),
        right: mm(attr(pgMar, 'w:right')),
        bottom: mm(attr(pgMar, 'w:bottom')),
        left: mm(attr(pgMar, 'w:left')),
      },
    },
    headers: await headerFooterParts(zip, 'header'),
    footers: await headerFooterParts(zip, 'footer'),
    numbering: { abstractCount: abstracts.length, formats: [...formats] },
  };
}

// ---------- PowerPoint ----------

function fillOf(spPr: Xml | undefined): string | null {
  if (!spPr) return null;
  if ('a:noFill' in spPr) return 'none';
  const solid = at(spPr, 'a:solidFill');
  if (solid) return colorOf(solid);
  if ('a:gradFill' in spPr) return 'gradient';
  if ('a:blipFill' in spPr) return 'image';
  return null;
}

function lineOf(spPr: Xml | undefined): string | null {
  const ln = at(spPr, 'a:ln');
  if (!ln) return null;
  if ('a:noFill' in ln) return 'none';
  return colorOf(at(ln, 'a:solidFill'));
}

interface SlideContext {
  sizeEmu: { cx: number; cy: number };
  rels: Map<string, { target: string; type: string }>;
  smartArtRefs: Array<{ data: string | null; layout: string | null }>;
}

function boxOf(xfrm: Xml | undefined, ctx: SlideContext): ShapeInfo['box'] {
  const off = at(xfrm, 'a:off');
  const ext = at(xfrm, 'a:ext');
  if (!off || !ext) return null;
  const pct = (v: string | null, total: number) => round(((num(v) ?? 0) / total) * 100, 2);
  return {
    x: pct(attr(off, 'x'), ctx.sizeEmu.cx),
    y: pct(attr(off, 'y'), ctx.sizeEmu.cy),
    w: pct(attr(ext, 'cx'), ctx.sizeEmu.cx),
    h: pct(attr(ext, 'cy'), ctx.sizeEmu.cy),
  };
}

function placeholderOf(nvPr: Xml | undefined): ShapeInfo['placeholder'] {
  const ph = at(nvPr, 'p:ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') ?? 'body', idx: attr(ph, 'idx') };
}

/** Kumpulkan shape dari pohon p:spTree (rekursif untuk grup). */
function collectShapes(
  tree: Xml | undefined,
  rawXml: string,
  ctx: SlideContext,
  out: ShapeInfo[],
): void {
  if (!tree) return;
  const push = (shape: ShapeInfo) => {
    if (out.length < LIMITS.maxShapes) out.push(shape);
  };
  for (const sp of arr(tree['p:sp'])) {
    const nv = at(sp, 'p:nvSpPr');
    const spPr = at(sp, 'p:spPr');
    const txBody = sp['p:txBody'];
    // Teks diambil dari XML mentah shape ini agar run berformat tetap terbaca.
    const name = attr(at(nv, 'p:cNvPr'), 'name') ?? '';
    push({
      kind: 'shape',
      name,
      placeholder: placeholderOf(at(nv, 'p:nvPr')),
      box: boxOf(at(spPr, 'a:xfrm'), ctx),
      geometry: attr(at(spPr, 'a:prstGeom'), 'prst') ?? (at(spPr, 'a:custGeom') ? 'custom' : null),
      fill: fillOf(spPr),
      line: lineOf(spPr),
      text: txBody ? textOfTxBody(txBody) : [],
      image: null,
      smartArt: false,
    });
  }
  for (const pic of arr(tree['p:pic'])) {
    const nv = at(pic, 'p:nvPicPr');
    const embed = attr(at(pic, 'p:blipFill', 'a:blip'), 'r:embed');
    push({
      kind: 'picture',
      name: attr(at(nv, 'p:cNvPr'), 'name') ?? '',
      placeholder: placeholderOf(at(nv, 'p:nvPr')),
      box: boxOf(at(pic, 'p:spPr', 'a:xfrm'), ctx),
      geometry: attr(at(pic, 'p:spPr', 'a:prstGeom'), 'prst'),
      fill: null,
      line: null,
      text: [],
      image: embed ? (ctx.rels.get(embed)?.target ?? null) : null,
      smartArt: false,
    });
  }
  for (const cxn of arr(tree['p:cxnSp'])) {
    push({
      kind: 'connector',
      name: attr(at(cxn, 'p:nvCxnSpPr', 'p:cNvPr'), 'name') ?? '',
      placeholder: null,
      box: boxOf(at(cxn, 'p:spPr', 'a:xfrm'), ctx),
      geometry: attr(at(cxn, 'p:spPr', 'a:prstGeom'), 'prst'),
      fill: null,
      line: lineOf(at(cxn, 'p:spPr')),
      text: [],
      image: null,
      smartArt: false,
    });
  }
  for (const frame of arr(tree['p:graphicFrame'])) {
    const data = at(frame, 'a:graphic', 'a:graphicData');
    const relIds = at(data, 'dgm:relIds');
    const isSmartArt = !!relIds;
    if (relIds) {
      const dm = attr(relIds, 'r:dm');
      const lo = attr(relIds, 'r:lo');
      ctx.smartArtRefs.push({
        data: dm ? (ctx.rels.get(dm)?.target ?? null) : null,
        layout: lo ? (ctx.rels.get(lo)?.target ?? null) : null,
      });
    }
    const xfrm = at(frame, 'p:xfrm');
    push({
      kind: 'graphic',
      name: attr(at(frame, 'p:nvGraphicFramePr', 'p:cNvPr'), 'name') ?? '',
      placeholder: placeholderOf(at(frame, 'p:nvGraphicFramePr', 'p:nvPr')),
      box: boxOf(xfrm, ctx),
      geometry: isSmartArt ? 'smartart' : at(data, 'a:tbl') ? 'table' : 'chart',
      fill: null,
      line: null,
      text: [],
      image: null,
      smartArt: isSmartArt,
    });
  }
  for (const group of arr(tree['p:grpSp'])) {
    push({
      kind: 'group',
      name: attr(at(group, 'p:nvGrpSpPr', 'p:cNvPr'), 'name') ?? '',
      placeholder: null,
      box: boxOf(at(group, 'p:grpSpPr', 'a:xfrm'), ctx),
      geometry: null,
      fill: null,
      line: null,
      text: [],
      image: null,
      smartArt: false,
    });
    collectShapes(group, rawXml, ctx, out);
  }
}

/** Teks per paragraf dari objek p:txBody hasil parse. */
function textOfTxBody(txBody: unknown): string[] {
  const out: string[] = [];
  for (const p of arr(obj(txBody)?.['a:p'])) {
    const parts: string[] = [];
    for (const r of [...arr(p['a:r']), ...arr(p['a:fld'])]) {
      const t = r['a:t'];
      if (typeof t === 'string') parts.push(t);
      else if (t && typeof t === 'object' && typeof (t as Xml)['#text'] === 'string')
        parts.push((t as Xml)['#text'] as string);
    }
    const text = decodeXml(parts.join('')).trim();
    if (text) out.push(text.slice(0, LIMITS.maxText));
  }
  return out;
}

function backgroundOf(cSld: Xml | undefined): string | null {
  const bg = at(cSld, 'p:bg');
  if (!bg) return null;
  const bgPr = at(bg, 'p:bgPr');
  if (bgPr) return fillOf(bgPr);
  const ref = at(bg, 'p:bgRef');
  return ref ? (colorOf(ref) ?? 'theme') : null;
}

async function slidePart(
  zip: JSZip,
  part: string,
  rootTag: 'p:sldMaster' | 'p:sldLayout' | 'p:sld',
  sizeEmu: SlideContext['sizeEmu'],
  smartArtRefs: SlideContext['smartArtRefs'],
): Promise<{ info: SlidePartInfo; rels: SlideContext['rels'] }> {
  const parsed = await readXml(zip, part);
  const root = at(parsed?.doc, rootTag);
  const cSld = at(root, 'p:cSld');
  const rels = await relsOf(zip, part);
  const ctx: SlideContext = { sizeEmu, rels, smartArtRefs };
  const shapes: ShapeInfo[] = [];
  collectShapes(at(cSld, 'p:spTree'), parsed?.raw ?? '', ctx, shapes);
  return {
    info: {
      part,
      name: attr(cSld, 'name'),
      type: attr(root, 'type'),
      background: backgroundOf(cSld),
      shapes,
    },
    rels,
  };
}

async function smartArtTree(zip: JSZip, dataPart: string): Promise<SmartArtNode[]> {
  const parsed = await readXml(zip, dataPart);
  const model = at(parsed?.doc, 'dgm:dataModel');
  const texts = new Map<string, string>();
  const types = new Map<string, string>();
  for (const pt of arr(at(model, 'dgm:ptLst')?.['dgm:pt'])) {
    const id = attr(pt, 'modelId');
    if (!id) continue;
    types.set(id, attr(pt, 'type') ?? 'node');
    texts.set(id, textOfTxBody(pt['dgm:t']).join(' '));
  }
  const children = new Map<string, Array<{ id: string; ord: number }>>();
  const hasParent = new Set<string>();
  for (const cxn of arr(at(model, 'dgm:cxnLst')?.['dgm:cxn'])) {
    const type = attr(cxn, 'type') ?? 'parOf';
    if (type !== 'parOf') continue;
    const src = attr(cxn, 'srcId');
    const dest = attr(cxn, 'destId');
    if (!src || !dest) continue;
    const list = children.get(src) ?? [];
    list.push({ id: dest, ord: num(attr(cxn, 'srcOrd')) ?? 0 });
    children.set(src, list);
    hasParent.add(dest);
  }
  let count = 0;
  const build = (id: string, depth: number): SmartArtNode[] => {
    if (depth > 8) return [];
    const list = (children.get(id) ?? []).sort((a, b) => a.ord - b.ord);
    const nodes: SmartArtNode[] = [];
    for (const child of list) {
      if (count >= LIMITS.maxSmartArtNodes) break;
      const type = types.get(child.id) ?? 'node';
      if (type !== 'node' && type !== 'asst') continue;
      count += 1;
      nodes.push({ text: texts.get(child.id) ?? '', children: build(child.id, depth + 1) });
    }
    return nodes;
  };
  const docRoot = [...types.entries()].find(([, type]) => type === 'doc')?.[0];
  return docRoot ? build(docRoot, 0) : [];
}

async function smartArtLayoutName(zip: JSZip, layoutPart: string | null): Promise<string | null> {
  if (!layoutPart) return null;
  const parsed = await readXml(zip, layoutPart);
  const def = at(parsed?.doc, 'dgm:layoutDef');
  return attr(def, 'uniqueId') ?? attr(at(def, 'dgm:title'), 'val');
}

async function extractPptx(zip: JSZip): Promise<PptxProfile> {
  const presentation = await readXml(zip, 'ppt/presentation.xml');
  const sldSz = at(presentation?.doc, 'p:presentation', 'p:sldSz');
  const cx = num(attr(sldSz, 'cx')) ?? 12192000;
  const cy = num(attr(sldSz, 'cy')) ?? 6858000;
  const sizeEmu = { cx, cy };
  const smartArtRefs: SlideContext['smartArtRefs'] = [];
  const slideOfRef = new Map<number, string>();

  const masters: SlidePartInfo[] = [];
  for (const part of sortedParts(zip, /^ppt\/slideMasters\/slideMaster\d+\.xml$/)) {
    masters.push((await slidePart(zip, part, 'p:sldMaster', sizeEmu, [])).info);
  }
  const layouts: PptxProfile['layouts'] = [];
  for (const part of sortedParts(zip, /^ppt\/slideLayouts\/slideLayout\d+\.xml$/)) {
    const { info, rels } = await slidePart(zip, part, 'p:sldLayout', sizeEmu, []);
    const master = [...rels.values()].find((r) => r.type === 'slideMaster')?.target ?? null;
    layouts.push({ ...info, master });
  }
  const slides: PptxProfile['slides'] = [];
  for (const part of sortedParts(zip, /^ppt\/slides\/slide\d+\.xml$/).slice(0, LIMITS.maxSlides)) {
    const before = smartArtRefs.length;
    const { info, rels } = await slidePart(zip, part, 'p:sld', sizeEmu, smartArtRefs);
    for (let i = before; i < smartArtRefs.length; i += 1) slideOfRef.set(i, part);
    const layout = [...rels.values()].find((r) => r.type === 'slideLayout')?.target ?? null;
    slides.push({ ...info, layout });
  }

  const smartArt: SmartArtInfo[] = [];
  for (const [index, ref] of smartArtRefs.entries()) {
    if (!ref.data || !zip.file(ref.data)) continue;
    smartArt.push({
      part: ref.data,
      slide: slideOfRef.get(index) ?? null,
      layout: await smartArtLayoutName(zip, ref.layout),
      nodes: await smartArtTree(zip, ref.data),
    });
  }

  return {
    slideSize: {
      widthEmu: cx,
      heightEmu: cy,
      widthIn: round(cx / 914400, 2),
      heightIn: round(cy / 914400, 2),
    },
    masters,
    layouts,
    slides,
    smartArt,
  };
}

// ---------- Excel ----------

async function extractXlsx(zip: JSZip): Promise<XlsxProfile> {
  const styles = await readXml(zip, 'xl/styles.xml');
  const sheet = at(styles?.doc, 'styleSheet');
  const fonts = arr(at(sheet, 'fonts')?.font).map((font) => ({
    name: attr(at(font, 'name'), 'val'),
    sizePt: num(attr(at(font, 'sz'), 'val')),
    color:
      attr(at(font, 'color'), 'rgb') ??
      (attr(at(font, 'color'), 'theme') ? `theme:${attr(at(font, 'color'), 'theme')}` : null),
    bold: !!font && 'b' in font,
  }));
  const fills = arr(at(sheet, 'fills')?.fill).map(
    (fill) =>
      attr(at(fill, 'patternFill', 'fgColor'), 'rgb') ??
      attr(at(fill, 'patternFill'), 'patternType') ??
      'none',
  );
  const numFmts = arr(at(sheet, 'numFmts')?.numFmt).map((f) => ({
    id: num(attr(f, 'numFmtId')) ?? 0,
    code: attr(f, 'formatCode') ?? '',
  }));
  const cellStyles = arr(at(sheet, 'cellStyles')?.cellStyle)
    .map((s) => attr(s, 'name') ?? '')
    .filter(Boolean);

  const workbook = await readXml(zip, 'xl/workbook.xml');
  const wbRels = await relsOf(zip, 'xl/workbook.xml');
  const sheets: XlsxProfile['sheets'] = [];
  for (const s of arr(at(workbook?.doc, 'workbook', 'sheets')?.sheet).slice(0, 20)) {
    const rid = attr(s, 'r:id');
    const target = rid ? wbRels.get(rid)?.target : undefined;
    const ws = target ? await readXml(zip, target) : null;
    const widths = arr(at(ws?.doc, 'worksheet', 'cols')?.col)
      .slice(0, 50)
      .map((c) => num(attr(c, 'width')) ?? 0);
    sheets.push({ name: attr(s, 'name') ?? '', columnWidths: widths });
  }
  return { fonts, fills, numFmts, cellStyles, sheets };
}

// ---------- Ringkasan ----------

function summarize(profile: Omit<OfficeStyleProfile, 'summary'>): string {
  const parts: string[] = [];
  const theme = profile.theme;
  if (theme) {
    const fonts = [theme.fonts.major.latin, theme.fonts.minor.latin].filter(Boolean);
    const accents = ['accent1', 'accent2', 'accent3']
      .map((k) => theme.colors[k])
      .filter((c): c is string => !!c && !c.startsWith('scheme:'))
      .map((c) => `#${c}`);
    parts.push(
      `Tema "${theme.name ?? '-'}"${fonts.length ? `, font ${fonts.join('/')}` : ''}${accents.length ? `, aksen ${accents.join(' ')}` : ''}.`,
    );
  }
  if (profile.docx) {
    const d = profile.docx;
    const headings = d.styles
      .filter((s) => /^(title|heading [1-3])$/i.test(s.name))
      .map((s) => s.name);
    parts.push(
      `Word ${d.page.orientation}, ${d.page.widthMm ?? '?'}×${d.page.heightMm ?? '?'} mm; ${d.styles.length} style${headings.length ? ` (${headings.join(', ')})` : ''}.`,
    );
    const hf = [...d.headers, ...d.footers].filter((h) => h.text || h.images.length);
    if (hf.length)
      parts.push(
        `Header/footer: ${hf.map((h) => `${h.kind}${h.text ? ` "${h.text.slice(0, 60)}"` : ''}${h.images.length ? ' +logo' : ''}`).join('; ')}.`,
      );
  }
  if (profile.pptx) {
    const p = profile.pptx;
    parts.push(
      `PowerPoint ${p.slideSize.widthIn}×${p.slideSize.heightIn} in, ${p.masters.length} master, layout: ${p.layouts
        .map((l) => l.name ?? l.type)
        .filter(Boolean)
        .join(', ')}.`,
    );
    if (p.smartArt.length)
      parts.push(
        `${p.smartArt.length} SmartArt (${p.smartArt.map((s) => s.layout ?? '?').join(', ')}).`,
      );
  }
  if (profile.xlsx) {
    parts.push(
      `Excel ${profile.xlsx.sheets.length} sheet, font utama ${profile.xlsx.fonts[0]?.name ?? '-'}.`,
    );
  }
  return parts.join(' ');
}

export async function extractStyleProfile(
  format: OfficeFormat,
  buffer: Buffer,
): Promise<OfficeStyleProfile> {
  const zip = await JSZip.loadAsync(buffer);
  const theme = await extractTheme(zip);
  const base: Omit<OfficeStyleProfile, 'summary'> = { format, theme };
  if (format === 'docx') base.docx = await extractDocx(zip);
  else if (format === 'pptx') base.pptx = await extractPptx(zip);
  else base.xlsx = await extractXlsx(zip);
  return { ...base, summary: summarize(base) };
}
