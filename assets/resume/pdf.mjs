import { shape } from './typesetter.mjs';

const encoder = new TextEncoder();
const bytes = value => typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
const concat = chunks => {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
};
const number = value => {
  if (!Number.isFinite(value)) throw new Error('Invalid PDF coordinate');
  return String(Math.round(value * 10000) / 10000);
};
const hex = value => value.toString(16).padStart(4, '0');
const unicode = text => Array.from({ length: text.length }, (_, i) => hex(text.charCodeAt(i))).join('');
const pdfString = text => `<feff${unicode(String(text))}>`;
// URI actions require an ASCII URI, not a UTF-16 PDF text string.
const pdfURI = value => `<${Array.from(encoder.encode(new URL(value).href), byte => byte.toString(16).padStart(2, '0')).join('')}>`;
const rgb = color => [1, 3, 5].map(i => number(parseInt(color.slice(i, i + 2), 16) / 255)).join(' ');

class Objects {
  values = [];
  reserve() { this.values.push(null); return this.values.length; }
  set(id, value) { this.values[id - 1] = bytes(value); }
  add(value) { const id = this.reserve(); this.set(id, value); return id; }
  async stream(data, dictionary = '') {
    const raw = bytes(data);
    let encoded = raw, filter = '';
    if (typeof CompressionStream !== 'undefined') {
      const compressed = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
      if (compressed.byteLength < raw.length) { encoded = new Uint8Array(compressed); filter = '/Filter /FlateDecode'; }
    }
    return this.add(concat([
      bytes(`<< ${dictionary} ${filter} /Length ${encoded.length} >>\nstream\n`), encoded, bytes('\nendstream'),
    ]));
  }
  finish(root, info) {
    const chunks = [bytes('%PDF-1.7\n'), new Uint8Array([37, 226, 227, 207, 211, 10])];
    let offset = chunks.reduce((n, chunk) => n + chunk.length, 0);
    const offsets = [0];
    this.values.forEach((value, index) => {
      if (!value) throw new Error(`Unresolved PDF object ${index + 1}`);
      offsets.push(offset);
      const chunk = concat([bytes(`${index + 1} 0 obj\n`), value, bytes('\nendobj\n')]);
      chunks.push(chunk); offset += chunk.length;
    });
    const xref = offset;
    chunks.push(bytes(`xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
      offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${offsets.length} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return concat(chunks);
  }
}

/** Binary TTF data is supplied by the caller. There are no requests here. */
export async function makePDF(document, fonts, binaries) {
  const pdf = new Objects();
  const catalog = pdf.reserve(), tree = pdf.reserve();
  const used = new Map();
  // Assign CIDs by Unicode character, not glyph ID: extraction preserves characters
  // even when a font maps two code points onto the same glyph.
  for (const page of document.pages) for (const node of page.nodes) {
    if (node.type !== 'text') continue;
    for (const glyph of shape(node.text, node.font, node.size, fonts).glyphs) {
      if (!used.has(glyph.key)) used.set(glyph.key, new Map());
      const chars = used.get(glyph.key);
      if (!chars.has(glyph.cp)) chars.set(glyph.cp, { cid: chars.size + 1, gid: glyph.gid });
    }
  }
  const resources = new Map();
  for (const [key, chars] of used) {
    if (!binaries[key]) throw new Error(`Missing embedded font: ${key}`);
    const font = fonts[key], scale = value => number(value / font.units * 1000);
    const fontFile = await pdf.stream(binaries[key], `/Length1 ${binaries[key].byteLength}`);
    const descriptor = pdf.add(`<< /Type /FontDescriptor /FontName /${font.name}
      /Flags ${key === 'icons' ? 4 : key === 'italic' ? 98 : key === 'fallback' ? 32 : 34}
      /FontBBox [${font.bbox.map(scale).join(' ')}] /ItalicAngle ${number(font.italicAngle)}
      /Ascent ${scale(font.ascent)} /Descent ${scale(font.descent)} /CapHeight ${scale(font.ascent)}
      /StemV ${key === 'bold' ? 120 : 80} /FontFile2 ${fontFile} 0 R >>`);
    const gids = new Uint8Array((chars.size + 1) * 2), widths = [], mappings = [];
    for (const [cp, { cid, gid }] of chars) {
      gids[cid * 2] = gid >> 8; gids[cid * 2 + 1] = gid & 255;
      widths.push(scale(font.glyphs[cp]?.[1] ?? font.units * .65));
      mappings.push(`<${hex(cid)}> <${unicode(String.fromCodePoint(cp))}>`);
    }
    const mapping = await pdf.stream(gids);
    const descendant = pdf.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name}
      /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>
      /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${mapping} 0 R /DW 1000 /W [1 [${widths.join(' ')}]] >>`);
    const groups = [];
    for (let i = 0; i < mappings.length; i += 100) {
      const group = mappings.slice(i, i + 100);
      groups.push(`${group.length} beginbfchar\n${group.join('\n')}\nendbfchar`);
    }
    const toUnicode = await pdf.stream(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap
      /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
      /CMapName /ResumeUnicode def /CMapType 2 def
      1 begincodespacerange\n<0000> <ffff>\nendcodespacerange
      ${groups.join('\n')}
      endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`);
    const id = pdf.add(`<< /Type /Font /Subtype /Type0 /BaseFont /${font.name}
      /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
    resources.set(key, { id, label: `F${resources.size + 1}`, chars });
  }
  const resourceString = [...resources.values()].map(({ label, id }) => `/${label} ${id} 0 R`).join(' ');
  const kids = [];
  for (const page of document.pages) {
    const commands = [], annotations = [];
    for (const node of page.nodes) {
      if (node.type === 'line') {
        commands.push(`${rgb(node.color)} RG ${number(node.thickness)} w ${number(node.x)} ${number(document.height - node.y)} m ${number(node.x2)} ${number(document.height - node.y)} l S`);
        continue;
      }
      commands.push(`${rgb(node.color)} rg BT`);
      let previous;
      for (const glyph of shape(node.text, node.font, node.size, fonts).glyphs) {
        const font = resources.get(glyph.key);
        if (previous !== font.label) { commands.push(`/${font.label} ${number(node.size)} Tf`); previous = font.label; }
        commands.push(`1 0 0 1 ${number(node.x + glyph.x)} ${number(document.height - node.y)} Tm <${hex(font.chars.get(glyph.cp).cid)}> Tj`);
      }
      commands.push('ET');
      if (node.link && /^(https:\/\/|mailto:)/i.test(node.link)) {
        annotations.push(pdf.add(`<< /Type /Annot /Subtype /Link /Border [0 0 0]
          /Rect [${number(node.x)} ${number(document.height - node.y - 2)} ${number(node.x + node.width)} ${number(document.height - node.y + node.size)}]
          /A << /S /URI /URI ${pdfURI(node.link)} >> >>`));
      }
    }
    const content = await pdf.stream(commands.join('\n'));
    kids.push(pdf.add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${number(document.width)} ${number(document.height)}]
      /Resources << /Font << ${resourceString} >> >> /Contents ${content} 0 R
      /Annots [${annotations.map(id => `${id} 0 R`).join(' ')}] >>`));
  }
  pdf.set(tree, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${tree} 0 R /Lang (en-US) /ViewerPreferences << /DisplayDocTitle true >> >>`);
  const info = pdf.add(`<< /Title ${pdfString(document.title)} /Author ${pdfString(document.author)} /Creator (Resume workshop) /Producer (Browser resume typesetter) >>`);
  return pdf.finish(catalog, info);
}

export function renderPreview(document, fonts, container) {
  const namespace = 'http://www.w3.org/2000/svg';
  const make = (tag, attrs = {}) => {
    const node = window.document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const fragment = window.document.createDocumentFragment();
  for (const [index, page] of document.pages.entries()) {
    const svg = make('svg', {
      viewBox: `0 0 ${document.width} ${document.height}`, class: 'resume-page',
      role: 'img', 'aria-label': `Resume preview, page ${index + 1} of ${document.pages.length}`,
    });
    svg.append(make('rect', { x: 0, y: 0, width: document.width, height: document.height, fill: '#fff' }));
    for (const node of page.nodes) {
      if (node.type === 'line') {
        svg.append(make('line', { x1: node.x, x2: node.x2, y1: node.y, y2: node.y, stroke: node.color, 'stroke-width': node.thickness }));
        continue;
      }
      const runs = [];
      for (const glyph of shape(node.text, node.font, node.size, fonts).glyphs) {
        if (runs.at(-1)?.key !== glyph.key) runs.push({ key: glyph.key, glyphs: [] });
        runs.at(-1).glyphs.push(glyph);
      }
      let parent = svg;
      if (node.link && /^(https:\/\/|mailto:)/i.test(node.link)) {
        parent = make('a', { href: node.link, target: '_blank', rel: 'noopener noreferrer' }); svg.append(parent);
      }
      for (const run of runs) {
        const element = make('text', {
          x: run.glyphs.map(glyph => node.x + glyph.x).join(' '), y: node.y,
          'font-family': fonts[run.key].name, 'font-size': node.size, fill: node.color,
          'font-kerning': 'none', 'font-variant-ligatures': 'none', 'xml:space': 'preserve',
        });
        element.textContent = run.glyphs.map(glyph => glyph.character).join('');
        parent.append(element);
      }
    }
    fragment.append(svg);
  }
  container.replaceChildren(fragment);
}
