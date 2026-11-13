import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, Footer, Header, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import { parseDocumentSpec } from '../../src/modules/documents/document-spec';
import {
  renderDocxFromTemplate,
  renderPptxFromTemplate,
  renderXlsxFromTemplate,
  replaceTxBody,
} from '../../src/modules/documents/template-renderers';
import { renderDocument } from '../../src/modules/documents/renderers';
import { extractStyleProfile } from '../../src/modules/office-styles/ooxml-extractor';
import { extractOfficeContent } from '../../src/modules/office/office-content';
import {
  mintFileToken,
  signJwt,
  verifyFileToken,
  verifyJwt,
} from '../../src/modules/office/office-token';
import { assertDocumentServerUrl } from '../../src/modules/office/office.service';

const PPTX_TEMPLATE = readFileSync(join(__dirname, '..', 'fixtures', 'office', 'template.pptx'));

async function docxTemplate(): Promise<Buffer> {
  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          run: { font: 'Montserrat', size: 36, color: '1B7F3B', bold: true },
        },
      ],
    },
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph('PT Contoh — Rahasia')] }) },
        footers: { default: new Footer({ children: [new Paragraph('Halaman kaki')] }) },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Isi lama')] }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

describe('office tokens', () => {
  const secret = 'rahasia-uji';

  it('signs and verifies HS256 JWT, rejecting tampering and expiry', () => {
    const token = signJwt({ a: 1 }, secret);
    expect(verifyJwt(token, secret)).toEqual({ a: 1 });
    expect(verifyJwt(token, 'lain')).toBeNull();
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ a: 2 })).toString('base64url')}.${s}`;
    expect(verifyJwt(forged, secret)).toBeNull();
    const expired = signJwt({ exp: Math.floor(Date.now() / 1000) - 10 }, secret);
    expect(verifyJwt(expired, secret)).toBeNull();
  });

  it('binds file tokens to kind and id', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = mintFileToken({ k: 'doc', id: 'abc', uid: 'u1', v: 2, exp }, secret);
    expect(verifyFileToken(token, secret, { k: 'doc', id: 'abc' })?.uid).toBe('u1');
    expect(verifyFileToken(token, secret, { k: 'doc', id: 'other' })).toBeNull();
    expect(verifyFileToken(token, secret, { k: 'att', id: 'abc' })).toBeNull();
    expect(verifyFileToken(`${token}x`, secret, { k: 'doc', id: 'abc' })).toBeNull();
    const old = mintFileToken({ k: 'doc', id: 'abc', uid: 'u1', v: 2, exp: 1 }, secret);
    expect(verifyFileToken(old, secret, { k: 'doc', id: 'abc' })).toBeNull();
  });

  it('only accepts callback downloads from the Document Server origin', () => {
    expect(() =>
      assertDocumentServerUrl(
        'http://localhost:8080/cache/files/x/output.docx',
        'http://localhost:8080',
      ),
    ).not.toThrow();
    expect(() =>
      assertDocumentServerUrl('http://169.254.169.254/latest', 'http://localhost:8080'),
    ).toThrow();
    expect(() =>
      assertDocumentServerUrl('http://localhost:8081/x', 'http://localhost:8080'),
    ).toThrow();
    expect(() => assertDocumentServerUrl('nonsense', 'http://localhost:8080')).toThrow();
  });
});

describe('style extraction', () => {
  it('reads pptx theme, master shapes, layouts and slides', async () => {
    const profile = await extractStyleProfile('pptx', PPTX_TEMPLATE);
    expect(profile.theme?.fonts.minor.latin).toBeTruthy();
    expect(profile.pptx?.layouts.length).toBeGreaterThan(5);
    expect(profile.pptx?.layouts.map((l) => l.name)).toContain('Title and Content');
    const bar = profile.pptx?.masters[0]?.shapes.find((s) => s.name === 'Brand Bar');
    expect(bar?.fill).toBe('1B7F3B');
    expect(bar?.box?.w).toBeCloseTo(100, 0);
    expect(profile.pptx?.slides[1]?.shapes.some((s) => s.text.includes('Agenda'))).toBe(true);
    expect(profile.summary).toContain('PowerPoint');
  });

  it('reads docx styles, page setup and header/footer', async () => {
    const profile = await extractStyleProfile('docx', await docxTemplate());
    const heading = profile.docx?.styles.find((s) => s.name === 'Heading 1');
    expect(heading).toMatchObject({ font: 'Montserrat', color: '1B7F3B', sizePt: 18, bold: true });
    expect(profile.docx?.headers.map((h) => h.text)).toContain('PT Contoh — Rahasia');
    expect(profile.docx?.footers.map((h) => h.text)).toContain('Halaman kaki');
  });

  it('builds the SmartArt node tree in order', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/diagrams/data1.xml',
      `<dgm:dataModel xmlns:dgm="d" xmlns:a="a"><dgm:ptLst>
        <dgm:pt modelId="0" type="doc"><dgm:t><a:p><a:r><a:t></a:t></a:r></a:p></dgm:t></dgm:pt>
        <dgm:pt modelId="1"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Plan</a:t></a:r></a:p></dgm:t></dgm:pt>
        <dgm:pt modelId="2"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Do</a:t></a:r></a:p></dgm:t></dgm:pt>
        <dgm:pt modelId="3"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Sub</a:t></a:r></a:p></dgm:t></dgm:pt>
      </dgm:ptLst><dgm:cxnLst>
        <dgm:cxn modelId="c1" srcId="0" destId="1" srcOrd="0"/>
        <dgm:cxn modelId="c2" srcId="0" destId="2" srcOrd="1"/>
        <dgm:cxn modelId="c3" srcId="2" destId="3" srcOrd="0"/>
      </dgm:cxnLst></dgm:dataModel>`,
    );
    // Slide yang merujuk diagram lewat dgm:relIds.
    zip.file(
      'ppt/presentation.xml',
      '<p:presentation xmlns:p="p"><p:sldSz cx="100" cy="100"/></p:presentation>',
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r" xmlns:dgm="d"><p:cSld><p:spTree>
        <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram 1"/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="0" y="0"/><a:ext cx="50" cy="50"/></p:xfrm>
        <a:graphic><a:graphicData><dgm:relIds r:dm="rId2" r:lo="rId3"/></a:graphicData></a:graphic></p:graphicFrame>
      </p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships><Relationship Id="rId2" Type="x/diagramData" Target="../diagrams/data1.xml"/>
       <Relationship Id="rId3" Type="x/diagramLayout" Target="../diagrams/layout1.xml"/></Relationships>`,
    );
    zip.file(
      'ppt/diagrams/layout1.xml',
      '<dgm:layoutDef xmlns:dgm="d" uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/process1"/>',
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const profile = await extractStyleProfile('pptx', buffer);
    expect(profile.pptx?.smartArt[0]?.layout).toContain('process1');
    expect(profile.pptx?.smartArt[0]?.nodes).toEqual([
      { text: 'Plan', children: [] },
      { text: 'Do', children: [{ text: 'Sub', children: [] }] },
    ]);
  });
});

describe('template rendering', () => {
  it('replaces txBody paragraphs while keeping bodyPr and run formatting', () => {
    const out = replaceTxBody(
      '<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4000"/><a:t>Old</a:t></a:r></a:p></p:txBody>',
      ['Baru **tebal**', 'Dua & tiga'],
    );
    expect(out).toContain('<a:bodyPr anchor="ctr"/>');
    expect(out).toContain('<a:pPr algn="ctr"/><a:r><a:rPr sz="4000"/><a:t>Baru </a:t></a:r>');
    expect(out).toContain('<a:rPr b="1" sz="4000"/><a:t>tebal</a:t>');
    expect(out).toContain('Dua &amp; tiga');
    expect(out).not.toContain('Old');
  });

  it('clones the pptx template: same theme/master, new slides on template layouts', async () => {
    const spec = parseDocumentSpec({
      format: 'pptx',
      title: 'Rencana Q1',
      template_id: '11111111-2222-3333-4444-555555555555',
      slides: [
        { title: 'Latar', bullets: ['Satu', 'Dua'], notes: 'catatan' },
        { title: 'Bagian', bullets: [], layout: 'Section Header' },
        { title: 'Agenda baru', bullets: ['X'], template_slide: 2 },
      ],
    });
    const out = await renderPptxFromTemplate(spec, PPTX_TEMPLATE);
    const tpl = await JSZip.loadAsync(PPTX_TEMPLATE);
    const zip = await JSZip.loadAsync(out.buffer);
    expect(await zip.file('ppt/theme/theme1.xml')!.async('string')).toBe(
      await tpl.file('ppt/theme/theme1.xml')!.async('string'),
    );
    expect(await zip.file('ppt/slideMasters/slideMaster1.xml')!.async('string')).toContain(
      'Brand Bar',
    );
    const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    expect(slides).toHaveLength(4); // sampul + 3
    const presentation = await zip.file('ppt/presentation.xml')!.async('string');
    expect(presentation.match(/<p:sldId /g)).toHaveLength(4);
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    for (const s of slides) expect(ct).toContain(`/${s}"`);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('Rencana Q1');
    expect(await zip.file('ppt/slides/_rels/slide2.xml.rels')!.async('string')).toContain(
      'notesSlide',
    );
    const sectionRels = await zip.file('ppt/slides/_rels/slide3.xml.rels')!.async('string');
    const profile = await extractStyleProfile('pptx', out.buffer);
    const sectionLayout = profile.pptx?.layouts.find((l) => l.name === 'Section Header')?.part;
    expect(sectionRels).toContain(sectionLayout!.split('/').pop()!);
    const cloned = await zip.file('ppt/slides/slide4.xml')!.async('string');
    expect(cloned).toContain('Agenda baru');
    expect(cloned).not.toContain('>Agenda<');
    // Hasil tetap dapat dibaca ulang sebagai konten.
    const content = await extractOfficeContent('pptx', out.buffer);
    expect(content.contentText).toContain('Latar');
  });

  it('clones the docx template: keeps header/footer + style ids, replaces body', async () => {
    const template = await docxTemplate();
    const spec = parseDocumentSpec({
      format: 'docx',
      title: 'Laporan',
      template_id: '11111111-2222-3333-4444-555555555555',
      content: '# Ringkasan\n\nParagraf **penting**.\n\n- butir satu\n- butir dua',
    });
    const out = await renderDocxFromTemplate(spec, template);
    const zip = await JSZip.loadAsync(out.buffer);
    const document = await zip.file('word/document.xml')!.async('string');
    expect(document).toContain('Ringkasan');
    expect(document).not.toContain('Isi lama');
    expect(document).toMatch(/<w:headerReference/);
    expect(document).toMatch(/<w:footerReference/);
    const profile = await extractStyleProfile('docx', out.buffer);
    expect(profile.docx?.styles.find((s) => s.name === 'Heading 1')?.font).toBe('Montserrat');
    expect(profile.docx?.headers.map((h) => h.text)).toContain('PT Contoh — Rahasia');
    const numbering = await zip.file('word/numbering.xml')!.async('string');
    const numIds = Array.from(document.matchAll(/<w:numId w:val="(\d+)"/g), (m) => m[1]);
    expect(numIds.length).toBeGreaterThan(0);
    for (const id of numIds) expect(numbering).toContain(`w:numId="${id}"`);
    const text = await extractOfficeContent('docx', out.buffer);
    expect(text.contentText).toContain('butir dua');
  });

  it('clones the xlsx template: keeps header/body cell styles', async () => {
    const template = await renderDocument({
      format: 'xlsx',
      title: 'tpl',
      sheets: [
        {
          name: 'Lama',
          rows: [
            ['A', 'B'],
            ['1', '2'],
          ],
        },
      ],
    });
    const spec = parseDocumentSpec({
      format: 'xlsx',
      title: 'Baru',
      template_id: '11111111-2222-3333-4444-555555555555',
      sheets: [
        {
          name: 'Data',
          rows: [
            ['Nama', 'Nilai'],
            ['x', '3'],
          ],
        },
      ],
    });
    const out = await renderXlsxFromTemplate(spec, template.buffer);
    const content = await extractOfficeContent('xlsx', out.buffer);
    expect(content.previewJson).toEqual({
      sheets: [
        {
          name: 'Data',
          rows: [
            ['Nama', 'Nilai'],
            ['x', '3'],
          ],
        },
      ],
    });
  });

  it('rejects template_id on non-office formats and invalid ids', () => {
    expect(() =>
      parseDocumentSpec({
        format: 'md',
        title: 't',
        content: 'x',
        template_id: '11111111-2222-3333-4444-555555555555',
      }),
    ).toThrow();
    expect(() =>
      parseDocumentSpec({ format: 'docx', title: 't', content: 'x', template_id: '../etc' }),
    ).toThrow();
  });
});
