import { posix } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { DocumentSpec, SlideSpec } from './document-spec';
import { inlineRuns } from './markdown-blocks';
import { FORMAT_MIME, renderDocx, type RenderedDocument } from './renderers';

/**
 * "Klon sebagai templat": konten baru dimasukkan ke paket OOXML templat sehingga tema,
 * master/layout, style, header/footer, dan media templat tetap utuh byte-per-byte.
 */

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const;

const REL_TYPE = {
  slide: `${NS.rel}/slide`,
  slideLayout: `${NS.rel}/slideLayout`,
  notesSlide: `${NS.rel}/notesSlide`,
  notesMaster: `${NS.rel}/notesMaster`,
  diagramData: `${NS.rel}/diagramData`,
  diagramLayout: `${NS.rel}/diagramLayout`,
  diagramQuickStyle: `${NS.rel}/diagramQuickStyle`,
  diagramColors: `${NS.rel}/diagramColors`,
  diagramDrawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
} as const;

const CT = {
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
} as const;

export function escapeXml(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Karakter kontrol tidak sah di XML 1.0.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : null;
}

interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function relsPathOf(part: string): string {
  return posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
}

async function readRels(zip: JSZip, part: string): Promise<Rel[]> {
  const file = zip.file(relsPathOf(part));
  if (!file) return [];
  const xml = await file.async('string');
  return Array.from(xml.matchAll(/<Relationship\b[^>]*\/?>/g), (m) => ({
    id: attrOf(m[0], 'Id') ?? '',
    type: attrOf(m[0], 'Type') ?? '',
    target: attrOf(m[0], 'Target') ?? '',
    external: attrOf(m[0], 'TargetMode') === 'External',
  }));
}

function writeRels(zip: JSZip, part: string, rels: Rel[]): void {
  const body = rels
    .map(
      (r) =>
        `<Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(r.target)}"${
          r.external ? ' TargetMode="External"' : ''
        }/>`,
    )
    .join('');
  zip.file(
    relsPathOf(part),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`,
  );
}

/** Target relatif dari part `from` → path absolut paket. */
function resolveTarget(from: string, target: string): string {
  return target.startsWith('/')
    ? target.slice(1)
    : posix.normalize(posix.join(posix.dirname(from), target));
}

function relativeTarget(from: string, absolute: string): string {
  return posix.relative(posix.dirname(from), absolute);
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async('string') : null;
}

function addOverride(contentTypes: string, partName: string, type: string): string {
  if (contentTypes.includes(`PartName="/${partName}"`)) return contentTypes;
  return contentTypes.replace(
    '</Types>',
    `<Override PartName="/${partName}" ContentType="${type}"/></Types>`,
  );
}

function removeOverrides(contentTypes: string, prefix: string): string {
  return contentTypes.replace(new RegExp(`<Override PartName="/${prefix}[^"]*"[^>]*/>`, 'g'), '');
}

function inlineRunsXml(text: string, rPr: string): string {
  return inlineRuns(text)
    .map((run) => {
      const props = run.bold ? withBold(rPr) : rPr;
      return `<a:r>${props}<a:t>${escapeXml(run.text)}</a:t></a:r>`;
    })
    .join('');
}

function withBold(rPr: string): string {
  if (!rPr) return '<a:rPr lang="id-ID" b="1" dirty="0"/>';
  if (/\sb="/.test(rPr)) return rPr.replace(/\sb="[^"]*"/, ' b="1"');
  return rPr.replace(/^<a:rPr/, '<a:rPr b="1"');
}

/**
 * Ganti paragraf dalam <p:txBody>/<dsp:txBody>/<dgm:t>: bodyPr & lstStyle dipertahankan,
 * pPr dan rPr paragraf pertama dipakai ulang agar format templat terjaga.
 */
export function replaceTxBody(bodyXml: string, paragraphs: string[]): string {
  const firstP = /<a:p>[\s\S]*?<\/a:p>|<a:p [^>]*>[\s\S]*?<\/a:p>|<a:p\/>/.exec(bodyXml)?.[0] ?? '';
  const pPr = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(firstP)?.[0] ?? '';
  const rPrRaw =
    /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(firstP)?.[0] ??
    '<a:rPr lang="id-ID" dirty="0"/>';
  const rPr = rPrRaw.replace(/\sb="[^"]*"/, '');
  const generated = (paragraphs.length ? paragraphs : [''])
    .map((text) => (text ? `<a:p>${pPr}${inlineRunsXml(text, rPr)}</a:p>` : `<a:p>${pPr}</a:p>`))
    .join('');
  const firstIndex = bodyXml.search(/<a:p[ >/]/);
  if (firstIndex < 0) {
    // Tidak ada paragraf: sisipkan sebelum tag penutup body.
    return bodyXml.replace(/(<\/[a-z]+:(txBody|t)>)$/, `${generated}$1`);
  }
  const lastClose = bodyXml.lastIndexOf('</a:p>');
  const lastSelf = bodyXml.lastIndexOf('<a:p/>');
  const end = Math.max(lastClose >= 0 ? lastClose + 6 : -1, lastSelf >= 0 ? lastSelf + 6 : -1);
  return bodyXml.slice(0, firstIndex) + generated + bodyXml.slice(end);
}

// ======================= PowerPoint =======================

interface LayoutInfo {
  part: string;
  name: string;
  type: string;
  /** Tag <p:ph .../> per placeholder di layout. */
  placeholders: Array<{ type: string; idx: string | null; tag: string }>;
}

async function layoutsOf(zip: JSZip): Promise<LayoutInfo[]> {
  const parts = Object.keys(zip.files)
    .filter((p) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const out: LayoutInfo[] = [];
  for (const part of parts) {
    const xml = (await readText(zip, part)) ?? '';
    const root = /<p:sldLayout\b[^>]*>/.exec(xml)?.[0] ?? '';
    out.push({
      part,
      name: attrOf(/<p:cSld\b[^>]*>/.exec(xml)?.[0] ?? '', 'name') ?? '',
      type: attrOf(root, 'type') ?? 'cust',
      placeholders: Array.from(xml.matchAll(/<p:ph\b[^>]*\/?>/g), (m) => ({
        type: attrOf(m[0], 'type') ?? 'body',
        idx: attrOf(m[0], 'idx'),
        tag: m[0].replace(/>$/, '').replace(/\/$/, '').trim() + '/>',
      })),
    });
  }
  return out;
}

function hasTitle(l: LayoutInfo): boolean {
  return l.placeholders.some((p) => p.type === 'title' || p.type === 'ctrTitle');
}

function bodyPlaceholders(l: LayoutInfo) {
  return l.placeholders.filter((p) => p.type === 'body' || p.type === 'obj');
}

function pickLayout(layouts: LayoutInfo[], wanted: 'cover' | 'content', name?: string): LayoutInfo {
  if (name) {
    const lowered = name.toLowerCase();
    const byName =
      layouts.find((l) => l.name.toLowerCase() === lowered) ??
      layouts.find((l) => l.name.toLowerCase().includes(lowered));
    if (byName) return byName;
  }
  if (wanted === 'cover') {
    return layouts.find((l) => l.type === 'title') ?? layouts.find(hasTitle) ?? layouts[0]!;
  }
  return (
    layouts.find((l) => l.type === 'obj') ??
    layouts.find((l) => l.type === 'tx') ??
    layouts.find((l) => hasTitle(l) && bodyPlaceholders(l).length > 0) ??
    layouts.find(hasTitle) ??
    layouts[0]!
  );
}

function placeholderShape(
  id: number,
  ph: { tag: string; type: string },
  paragraphs: string[],
): string {
  const name =
    ph.type === 'title' || ph.type === 'ctrTitle' ? `Title ${id}` : `Content Placeholder ${id}`;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${ph.tag}</p:nvPr></p:nvSpPr><p:spPr/>` +
    replaceTxBody('<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>', paragraphs) +
    `</p:sp>`
  );
}

function newSlideXml(
  layout: LayoutInfo,
  title: string,
  bullets: string[],
  subtitle?: string,
): string {
  const shapes: string[] = [];
  let id = 2;
  const titlePh = layout.placeholders.find((p) => p.type === 'title' || p.type === 'ctrTitle');
  if (titlePh) shapes.push(placeholderShape(id++, titlePh, [title]));
  const subPh = layout.placeholders.find((p) => p.type === 'subTitle');
  if (subPh && subtitle) shapes.push(placeholderShape(id++, subPh, [subtitle]));
  const body = bodyPlaceholders(layout)[0];
  if (body && bullets.length > 0)
    shapes.push(placeholderShape(id++, body, bullets.map(plainTextKeepBold)));
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

/** Markdown inline selain **tebal** dibuang; tebal diproses oleh inlineRunsXml. */
function plainTextKeepBold(text: string): string {
  return text.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function notesSlideXml(notes: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    replaceTxBody(
      '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>',
      notes
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean),
    ) +
    `</p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

interface OriginalSlide {
  part: string;
  xml: string;
  rels: Rel[];
}

/** Ganti teks placeholder judul/isi pada salinan slide templat. */
function fillClonedSlide(xml: string, title: string, bullets: string[]): string {
  let titleDone = false;
  let bodyDone = false;
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
    const ph = /<p:ph\b[^>]*\/?>/.exec(sp)?.[0];
    if (!ph) return sp;
    const type = attrOf(ph, 'type') ?? 'body';
    const isTitle = type === 'title' || type === 'ctrTitle';
    const isBody = type === 'body' || type === 'obj';
    if (isTitle && !titleDone) {
      titleDone = true;
      return sp.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, (body) => replaceTxBody(body, [title]));
    }
    if (isBody && !bodyDone && bullets.length > 0) {
      bodyDone = true;
      return sp.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, (body) =>
        replaceTxBody(body, bullets.map(plainTextKeepBold)),
      );
    }
    return sp;
  });
}

/** Isi node SmartArt berurutan (data model + drawing cache) dengan teks baru. */
function fillSmartArt(
  dataXml: string,
  drawingXml: string | null,
  items: string[],
): { data: string; drawing: string | null } {
  const textByModel = new Map<string, string>();
  let index = 0;
  const data = dataXml.replace(/<dgm:pt\b[^>]*?(?:\/>|>[\s\S]*?<\/dgm:pt>)/g, (pt) => {
    const open = /<dgm:pt\b[^>]*>/.exec(pt)?.[0] ?? '';
    const type = attrOf(open, 'type') ?? 'node';
    if (type !== 'node' || !/<dgm:t>/.test(pt)) return pt;
    const text = items[index] ?? '';
    index += 1;
    const modelId = attrOf(open, 'modelId');
    if (modelId) textByModel.set(modelId, text);
    return pt.replace(/<dgm:t>[\s\S]*?<\/dgm:t>/, (t) => replaceTxBody(t, [text]));
  });
  const drawing = drawingXml
    ? drawingXml.replace(/<dsp:sp\b[^>]*>[\s\S]*?<\/dsp:sp>/g, (sp) => {
        const modelId = attrOf(/<dsp:sp\b[^>]*>/.exec(sp)?.[0] ?? '', 'modelId');
        if (!modelId || !textByModel.has(modelId)) return sp;
        return sp.replace(/<dsp:txBody>[\s\S]*?<\/dsp:txBody>/, (body) =>
          replaceTxBody(body, [textByModel.get(modelId)!]),
        );
      })
    : null;
  return { data, drawing };
}

function nextFreeNumber(zip: JSZip, dir: string, prefix: string): number {
  let max = 0;
  for (const path of Object.keys(zip.files)) {
    const m = new RegExp(`^${dir}/${prefix}(\\d+)\\.xml$`).exec(path);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

const DIAGRAM_PREFIX: Record<string, string> = {
  [REL_TYPE.diagramData]: 'data',
  [REL_TYPE.diagramLayout]: 'layout',
  [REL_TYPE.diagramQuickStyle]: 'quickStyle',
  [REL_TYPE.diagramColors]: 'colors',
  [REL_TYPE.diagramDrawing]: 'drawing',
};

const DIAGRAM_CT: Record<string, string> = {
  data: 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml',
  layout: 'application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml',
  quickStyle: 'application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml',
  colors: 'application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml',
  drawing: 'application/vnd.ms-office.drawingml.diagramDrawing+xml',
};

export async function renderPptxFromTemplate(
  spec: DocumentSpec,
  template: Buffer,
): Promise<RenderedDocument> {
  const zip = await JSZip.loadAsync(template);
  const presentationPart = 'ppt/presentation.xml';
  let presentation = (await readText(zip, presentationPart)) ?? '';
  let contentTypes = (await readText(zip, '[Content_Types].xml')) ?? '';
  const presRels = await readRels(zip, presentationPart);
  const layouts = await layoutsOf(zip);
  if (layouts.length === 0) throw new Error('Templat PowerPoint tidak memiliki slide layout.');
  const notesMasterRel = presRels.find((r) => r.type === REL_TYPE.notesMaster);
  const notesMaster = notesMasterRel
    ? resolveTarget(presentationPart, notesMasterRel.target)
    : null;

  // 1. Simpan slide asli (untuk template_slide) lalu buang seluruh slide + catatan dari paket.
  const originals: OriginalSlide[] = [];
  const slideIds = Array.from(presentation.matchAll(/<p:sldId\b[^>]*\/>/g), (m) =>
    attrOf(m[0], 'r:id'),
  );
  for (const rid of slideIds) {
    const rel = presRels.find((r) => r.id === rid);
    if (!rel) continue;
    const part = resolveTarget(presentationPart, rel.target);
    originals.push({
      part,
      xml: (await readText(zip, part)) ?? '',
      rels: await readRels(zip, part),
    });
  }
  for (const path of Object.keys(zip.files)) {
    if (/^ppt\/(slides|notesSlides)\/(_rels\/)?[^/]+\.(xml|rels)$/.test(path)) zip.remove(path);
  }
  contentTypes = removeOverrides(removeOverrides(contentTypes, 'ppt/slides/'), 'ppt/notesSlides/');
  // Daftar section & custom show merujuk id slide lama.
  presentation = presentation
    .replace(/<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/g, '')
    .replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/g, '');

  // 2. Bangun slide baru: sampul + isi.
  const keptPresRels = presRels.filter((r) => r.type !== REL_TYPE.slide);
  const sldIds: string[] = [];
  const plan: Array<{
    title: string;
    bullets: string[];
    notes?: string;
    slide?: SlideSpec;
    cover?: boolean;
  }> = [
    { title: spec.title, bullets: [], cover: true },
    ...(spec.slides ?? []).map((slide) => ({
      title: slide.title,
      bullets: slide.bullets,
      notes: slide.notes,
      slide,
    })),
  ];
  // Bila slide pertama spec menunjuk slide templat, sampul otomatis tidak dibuat.
  if (spec.slides?.[0]?.templateSlide !== undefined) plan.shift();

  for (const [i, item] of plan.entries()) {
    const n = i + 1;
    const part = `ppt/slides/slide${n}.xml`;
    const relId = `rIdSlide${n}`;
    let xml: string;
    let rels: Rel[];
    const source = item.slide?.templateSlide ? originals[item.slide.templateSlide - 1] : undefined;
    if (source) {
      xml = fillClonedSlide(source.xml, item.title, item.bullets);
      rels = [];
      for (const rel of source.rels) {
        if (rel.type === REL_TYPE.notesSlide) continue;
        const absolute = rel.external ? rel.target : resolveTarget(source.part, rel.target);
        const prefix = DIAGRAM_PREFIX[rel.type];
        if (prefix && !rel.external && zip.file(absolute)) {
          // Salin part diagram agar tiap slide punya SmartArt sendiri.
          const num = nextFreeNumber(zip, 'ppt/diagrams', prefix);
          const copyPath = `ppt/diagrams/${prefix}${num}.xml`;
          zip.file(copyPath, await zip.file(absolute)!.async('string'));
          contentTypes = addOverride(contentTypes, copyPath, DIAGRAM_CT[prefix]!);
          rels.push({ ...rel, target: relativeTarget(part, copyPath) });
        } else {
          rels.push({ ...rel, target: rel.external ? rel.target : relativeTarget(part, absolute) });
        }
      }
      const items = item.slide?.diagramItems;
      if (items?.length) {
        const dataRel = rels.find((r) => r.type === REL_TYPE.diagramData);
        const drawingRel = rels.find((r) => r.type === REL_TYPE.diagramDrawing);
        if (dataRel) {
          const dataPath = resolveTarget(part, dataRel.target);
          const drawingPath = drawingRel ? resolveTarget(part, drawingRel.target) : null;
          const filled = fillSmartArt(
            (await readText(zip, dataPath)) ?? '',
            drawingPath ? await readText(zip, drawingPath) : null,
            items,
          );
          zip.file(dataPath, filled.data);
          if (drawingPath && filled.drawing) zip.file(drawingPath, filled.drawing);
        }
      }
    } else {
      const layout = pickLayout(layouts, item.cover ? 'cover' : 'content', item.slide?.layout);
      xml = newSlideXml(layout, item.title, item.bullets);
      rels = [
        {
          id: 'rId1',
          type: REL_TYPE.slideLayout,
          target: relativeTarget(part, layout.part),
          external: false,
        },
      ];
    }
    if (item.notes && notesMaster) {
      const notesPart = `ppt/notesSlides/notesSlide${n}.xml`;
      zip.file(notesPart, notesSlideXml(item.notes));
      writeRels(zip, notesPart, [
        {
          id: 'rId1',
          type: REL_TYPE.notesMaster,
          target: relativeTarget(notesPart, notesMaster),
          external: false,
        },
        {
          id: 'rId2',
          type: REL_TYPE.slide,
          target: relativeTarget(notesPart, part),
          external: false,
        },
      ]);
      contentTypes = addOverride(contentTypes, notesPart, CT.notesSlide);
      rels.push({
        id: 'rIdNotes',
        type: REL_TYPE.notesSlide,
        target: relativeTarget(part, notesPart),
        external: false,
      });
    }
    zip.file(part, xml);
    writeRels(zip, part, rels);
    contentTypes = addOverride(contentTypes, part, CT.slide);
    keptPresRels.push({
      id: relId,
      type: REL_TYPE.slide,
      target: `slides/slide${n}.xml`,
      external: false,
    });
    sldIds.push(`<p:sldId id="${256 + i}" r:id="${relId}"/>`);
  }

  const list = `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>`;
  if (/<p:sldIdLst\b/.test(presentation)) {
    presentation = presentation.replace(
      /<p:sldIdLst\b[^>]*\/>|<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/,
      list,
    );
  } else {
    presentation = presentation.replace(/<p:sldSz\b/, `${list}<p:sldSz`);
  }
  zip.file(presentationPart, presentation);
  writeRels(zip, presentationPart, keptPresRels);
  zip.file('[Content_Types].xml', contentTypes);
  await setCoreTitleAsync(zip, spec.title);

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outline = (spec.slides ?? [])
    .map((s) =>
      [
        `## ${s.title}`,
        ...s.bullets.map((b) => `- ${b}`),
        ...(s.diagramItems ?? []).map((d) => `- ${d}`),
      ].join('\n'),
    )
    .join('\n\n');
  return {
    buffer,
    mimeType: FORMAT_MIME.pptx,
    extension: 'pptx',
    contentText: `# ${spec.title}\n\n${outline}`,
    previewJson: { slides: spec.slides ?? [] },
  };
}

async function setCoreTitleAsync(zip: JSZip, title: string): Promise<void> {
  const core = await readText(zip, 'docProps/core.xml');
  if (!core) return;
  const escaped = escapeXml(title);
  const next = /<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/.test(core)
    ? core.replace(/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/, `<dc:title>${escaped}</dc:title>`)
    : core.replace(/<\/cp:coreProperties>/, `<dc:title>${escaped}</dc:title></cp:coreProperties>`);
  zip.file('docProps/core.xml', next);
}

// ======================= Word =======================

function styleIdsByName(stylesXml: string): Map<string, { id: string; xml: string }> {
  const map = new Map<string, { id: string; xml: string }>();
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    const id = attrOf(/<w:style\b[^>]*>/.exec(m[0])?.[0] ?? '', 'w:styleId');
    const name = attrOf(/<w:name\b[^>]*\/>/.exec(m[0])?.[0] ?? '', 'w:val');
    if (id && name) map.set(name.toLowerCase(), { id, xml: m[0] });
  }
  return map;
}

function maxAttr(xml: string, tag: string, attr: string): number {
  let max = 0;
  for (const m of xml.matchAll(new RegExp(`<${tag}\\b[^>]*\\s${attr}="(\\d+)"`, 'g')))
    max = Math.max(max, Number(m[1]));
  return max;
}

const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const NUMBERING_REL = `${NS.rel}/numbering`;

export async function renderDocxFromTemplate(
  spec: DocumentSpec,
  template: Buffer,
): Promise<RenderedDocument> {
  const generated = await renderDocx(spec);
  const gen = await JSZip.loadAsync(generated.buffer);
  const zip = await JSZip.loadAsync(template);

  const genDocument = (await readText(gen, 'word/document.xml')) ?? '';
  const genStyles = (await readText(gen, 'word/styles.xml')) ?? '';
  const genNumbering = await readText(gen, 'word/numbering.xml');
  let document = (await readText(zip, 'word/document.xml')) ?? '';
  let styles = (await readText(zip, 'word/styles.xml')) ?? '';

  // 1. Isi body hasil render (tanpa sectPr-nya sendiri).
  const genBody = /<w:body>([\s\S]*)<\/w:body>/.exec(genDocument)?.[1] ?? '';
  let content = genBody.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/, '');

  // 2. Petakan style hasil render ke style templat menurut nama; salin style yang belum ada.
  const genByName = styleIdsByName(genStyles);
  const tplByName = styleIdsByName(styles);
  const idMap = new Map<string, string>();
  const missing: string[] = [];
  for (const [name, gStyle] of genByName) {
    const tStyle = tplByName.get(name);
    if (tStyle) idMap.set(gStyle.id, tStyle.id);
    else if (new RegExp(`w:val="${gStyle.id}"`).test(content)) missing.push(gStyle.xml);
  }
  content = content.replace(
    /(<w:(?:pStyle|rStyle|tblStyle) w:val=")([^"]+)(")/g,
    (_m, a: string, id: string, b: string) => `${a}${idMap.get(id) ?? id}${b}`,
  );
  if (missing.length) styles = styles.replace('</w:styles>', `${missing.join('')}</w:styles>`);

  // 3. Gabungkan definisi penomoran (bullet) dengan offset id agar tidak bentrok.
  if (genNumbering && /<w:numPr>/.test(content)) {
    let numbering = await readText(zip, 'word/numbering.xml');
    if (!numbering) {
      numbering =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:numbering>';
      const docRels = await readRels(zip, 'word/document.xml');
      docRels.push({
        id: 'rIdNumberingTpl',
        type: NUMBERING_REL,
        target: 'numbering.xml',
        external: false,
      });
      writeRels(zip, 'word/document.xml', docRels);
      let ct = (await readText(zip, '[Content_Types].xml')) ?? '';
      ct = addOverride(ct, 'word/numbering.xml', NUMBERING_CT);
      zip.file('[Content_Types].xml', ct);
    }
    const absOffset = maxAttr(numbering, 'w:abstractNum', 'w:abstractNumId') + 100;
    const numOffset = maxAttr(numbering, 'w:num', 'w:numId') + 100;
    const abstracts = Array.from(
      genNumbering.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g),
      (m) =>
        m[0].replace(
          /w:abstractNumId="(\d+)"/,
          (_x, id: string) => `w:abstractNumId="${Number(id) + absOffset}"`,
        ),
    );
    const nums = Array.from(genNumbering.matchAll(/<w:num\b[\s\S]*?<\/w:num>/g), (m) =>
      m[0]
        .replace(/w:numId="(\d+)"/, (_x, id: string) => `w:numId="${Number(id) + numOffset}"`)
        .replace(
          /(<w:abstractNumId w:val=")(\d+)/,
          (_x, a: string, id: string) => `${a}${Number(id) + absOffset}`,
        ),
    );
    // Urutan skema: seluruh abstractNum sebelum num.
    const firstNum = numbering.search(/<w:num\b/);
    numbering =
      firstNum >= 0
        ? numbering.slice(0, firstNum) + abstracts.join('') + numbering.slice(firstNum)
        : numbering.replace('</w:numbering>', `${abstracts.join('')}</w:numbering>`);
    numbering = numbering.replace('</w:numbering>', `${nums.join('')}</w:numbering>`);
    zip.file('word/numbering.xml', numbering);
    content = content.replace(
      /(<w:numId w:val=")(\d+)/g,
      (_x, a: string, id: string) => `${a}${Number(id) + numOffset}`,
    );
  }

  // 4. Ganti isi body templat; sectPr terakhir templat (header/footer, margin) dipertahankan.
  const tplBody = /<w:body>([\s\S]*)<\/w:body>/.exec(document)?.[1] ?? '';
  const sectPr = /<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/.exec(tplBody)?.[0] ?? '';
  document = document.replace(
    /<w:body>[\s\S]*<\/w:body>/,
    () => `<w:body>${content}${sectPr}</w:body>`,
  );
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', styles);
  await setCoreTitleAsync(zip, spec.title);

  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    mimeType: FORMAT_MIME.docx,
    extension: 'docx',
    contentText: generated.contentText,
    previewJson: null,
  };
}

// ======================= Excel =======================

function toCell(value: string): string | number {
  const trimmed = value.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) && trimmed.length < 16 ? Number(trimmed) : value;
}

type CellStyle = Partial<Pick<ExcelJS.Cell, 'font' | 'fill' | 'border' | 'alignment' | 'numFmt'>>;

function styleOf(cell: ExcelJS.Cell | undefined): CellStyle {
  if (!cell) return {};
  const style: CellStyle = {};
  if (cell.font) style.font = { ...cell.font };
  if (cell.fill) style.fill = { ...cell.fill } as ExcelJS.Fill;
  if (cell.border) style.border = { ...cell.border };
  if (cell.alignment) style.alignment = { ...cell.alignment };
  return style;
}

export async function renderXlsxFromTemplate(
  spec: DocumentSpec,
  template: Buffer,
): Promise<RenderedDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as ArrayBuffer);
  const reference = workbook.worksheets[0];
  const headerStyles: CellStyle[] = [];
  const bodyStyles: CellStyle[] = [];
  const widths: number[] = [];
  if (reference) {
    for (let c = 1; c <= Math.max(reference.columnCount, 1); c += 1) {
      headerStyles.push(styleOf(reference.getRow(1).getCell(c)));
      bodyStyles.push(styleOf(reference.getRow(2).getCell(c)));
      widths.push(reference.getColumn(c).width ?? 0);
    }
  }
  const pick = (list: CellStyle[], index: number) => list[index] ?? list[list.length - 1] ?? {};
  for (const ws of [...workbook.worksheets]) workbook.removeWorksheet(ws.id);
  (workbook as unknown as { definedNames: { model: unknown[] } }).definedNames.model = [];
  workbook.title = spec.title;

  for (const sheet of spec.sheets ?? []) {
    const ws = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row, r) => {
      const added = ws.addRow(row.map(toCell));
      added.eachCell({ includeEmpty: true }, (cell, c) => {
        Object.assign(cell, pick(r === 0 ? headerStyles : bodyStyles, c - 1));
      });
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns.forEach((column, index) => {
      const widest = sheet.rows.reduce((max, row) => Math.max(max, (row[index] ?? '').length), 8);
      column.width = Math.max(widths[index] ?? 0, Math.min(60, widest + 2));
    });
  }
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    mimeType: FORMAT_MIME.xlsx,
    extension: 'xlsx',
    contentText: null,
    previewJson: { sheets: spec.sheets ?? [] },
  };
}

export async function renderFromTemplate(
  spec: DocumentSpec,
  template: Buffer,
): Promise<RenderedDocument> {
  switch (spec.format) {
    case 'pptx':
      return renderPptxFromTemplate(spec, template);
    case 'docx':
      return renderDocxFromTemplate(spec, template);
    case 'xlsx':
      return renderXlsxFromTemplate(spec, template);
    default:
      throw new Error(`Templat tidak didukung untuk format ${spec.format}.`);
  }
}
