import { entryLines } from './entries.mjs';
// Fixed A4 layout modeled on assets/resume.pdf. The browser and PDF use the
// same glyph positions; there are no visitor-selectable format settings.
export const PAPER = { a4: { width: 595.276, height: 841.89 } };
export const INK = '#000000';
const MARGIN = 43;
const clean = text => String(text ?? '').normalize('NFC')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
  .replace(/[\u202a-\u202e\u2066-\u2069]/gu, '');

export function shape(text, family, size, fonts) {
  const glyphs = [];
  let x = 0, previous;
  for (const character of clean(text)) {
    const cp = character.codePointAt(0);
    const key = fonts[family].glyphs[cp] ? family : 'fallback';
    const font = fonts[key];
    const [gid, advance] = font.glyphs[cp] ?? [0, font.units * .65];
    if (previous?.key === key) x += (font.kern[`${previous.gid},${gid}`] ?? 0) / font.units * size;
    glyphs.push({ character, cp, key, gid, x, advance: advance / font.units * size });
    x += advance / font.units * size;
    previous = { key, gid };
  }
  return { glyphs, width: x };
}

// Greedy line breaking with metric-based splitting for long unbroken input.
// The original characters are retained, including words longer than a line.
export function wrap(text, width, family, size, fonts) {
  if (!(width > size)) throw new Error('Text column is too narrow');
  const measure = value => shape(value, family, size, fonts).width;
  const result = [];
  for (const paragraph of clean(text).split(/\r\n?|\n/u)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
      if (measure(line ? `${line} ${word}` : word) <= width + .001) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) result.push(line);
      line = '';
      if (measure(word) <= width) { line = word; continue; }
      for (const char of word) {
        if (measure(line + char) > width && line) { result.push(line); line = ''; }
        line += char;
      }
    }
    if (line) result.push(line);
    else if (!paragraph.trim()) result.push('');
  }
  return result;
}

export function typeset(model, person, fonts) {
  const { width, height } = PAPER.a4;
  const column = width - MARGIN * 2, bottom = height - 45;
  const pages = [];
  let page, y, employer = null, continuation = null;
  const newPage = () => {
    if (pages.length === 80) throw new Error('The document exceeds 80 pages.');
    page = { nodes: [] }; pages.push(page); y = 30;
    if (employer || continuation) {
      text(`${employer || continuation} (continued)`, MARGIN, y + 10, 'italic', 9.7);
      y += 25;
    }
  };
  function text(value, x, baseline, font = 'regular', size = 10.2, align = 'left', link = null) {
    const content = clean(value), measured = shape(content, font, size, fonts);
    page.nodes.push({ type: 'text', text: content, x: align === 'right' ? x - measured.width : x,
      y: baseline, font, size, color: INK, width: measured.width, link });
  }
  const ensure = amount => { if (y + amount > bottom) newPage(); };
  const linesFor = (value, font = 'regular', size = 10.2, indent = 0) => wrap(value, column - indent, font, size, fonts);
  const lineKeep = count => Math.min(count, count === 3 ? 3 : 2) * 15;
  function paragraph(value, { font = 'regular', size = 10.2, indent = 0, after = 3, leading = 15, link = null } = {}) {
    const lines = linesFor(value, font, size, indent);
    for (let i = 0; i < lines.length;) {
      const remaining = lines.length - i;
      let fit = Math.floor((bottom - y) / leading);
      if (fit < Math.min(remaining, 2) || remaining === 3 && fit === 2) { newPage(); fit = Math.floor((bottom - y) / leading); }
      let take = Math.min(fit, remaining);
      if (remaining - take === 1 && take > 2) take--;
      for (let j = 0; j < take; j++, i++) {
        text(lines[i], MARGIN + indent, y + size, font, size, 'left', link); y += leading;
      }
    }
    y += after;
  }
  function section(title, keep = 40) {
    continuation = null;
    ensure(29 + keep);
    continuation = title;
    y += 5;
    const size = 14.4;
    text(title, MARGIN, y + size, 'bold', size);
    const x = MARGIN + shape(title, 'bold', size, fonts).width + 11;
    page.nodes.push({ type: 'line', x, x2: width - MARGIN, y: y + 14.7, color: INK, thickness: .4 });
    y += 24;
  }
  function bullet(value, indent = 0) {
    ensure(lineKeep(linesFor(value, 'regular', 10.2, indent + 9).length) + 3);
    text('\u22c5', MARGIN + indent + 1, y + 10.2, 'regular', 11);
    paragraph(value, { indent: indent + 9, after: 2 });
  }
  function header(title, date, subtitle = '', location = '', url = null) {
    const dateWidth = shape(date, 'italic', 9.7, fonts).width;
    const lines = wrap(title, column - (date ? dateWidth + 15 : 0), 'bold', 10.5, fonts);
    ensure(lines.length * 15 + (subtitle ? 15 : 0) + 30);
    const start = y;
    for (const line of lines) { text(line, MARGIN, y + 10.5, 'bold', 10.5, 'left', url); y += 15; }
    if (date) text(date, width - MARGIN, start + 10.5, 'italic', 9.7, 'right');
    if (subtitle) {
      text(subtitle, MARGIN, y + 10.2, 'italic');
      if (location) text(location, width - MARGIN, y + 10.2, 'italic', 9.7, 'right');
      y += 17;
    }
  }
  const compactLines = item => entryLines(item, run => shape(run.text, run.font, run.size, fonts).width, column - 18);
  function compactEntry(item) {
    const lines = compactLines(item);
    ensure(lines.length * 15 + 2);
    text('\u22c5', MARGIN + 10, y + 10.2, 'regular', 11);
    lines.forEach((runs, row) => {
      let x = MARGIN + 18;
      for (const run of runs) {
        text(run.text, x, y + 10.2, run.font, run.size, 'left', run.link);
        const node = page.nodes.at(-1);
        node.entry = item.id; node.entryRow = row;
        x += node.width;
      }
      y += 15;
    });
    y += 2;
  }
  function workGroup(title, items) {
    if (!items?.length) return;
    ensure(20 + compactLines(items[0]).length * 15 + 2);
    paragraph(title, { font: 'bold', indent: 9, after: 5 });
    items.forEach(compactEntry);
    y += 3;
  }
  function nestedHeading(title, keep = 30) {
    ensure(linesFor(title, 'bold', 10.2, 9).length * 15 + keep);
    text('\u22c5', MARGIN + 1, y + 10.2, 'regular', 11);
    paragraph(title, { font: 'bold', indent: 9, after: 2 });
  }
  newPage(); y = 66;
  text(person.name, MARGIN, y + 16, 'bold', 20.6);
  person.headline.forEach((line, i) => text(line, MARGIN, y + 36 + i * 15, 'regular', 10.2));
  const contacts = [
    ['\uf0e0', person.email, `mailto:${person.email}`],
    ['\uf0ac', 'deut-erium.github.io', person.website],
    ['\uf09b', 'deut-erium', person.github],
    ['\uf0e1', 'himanshu-sheoran', person.linkedin],
  ];
  contacts.forEach(([icon, label, url], i) => {
    const baseline = y + 21 + i * 15;
    text(label, width - MARGIN, baseline, 'regular', 10.2, 'right', url);
    const w = shape(label, 'regular', 10.2, fonts).width;
    text(icon, width - MARGIN - w - 21, baseline, 'icons', 10, 'left', url);
  });
  y += 76;
  section('Education', 47);
  header(model.education.title, model.education.date, model.education.detail);
  paragraph(model.education.note, { font: 'italic', after: 4 });
  section('Professional Experience', 80);
  for (const job of model.experience) {
    employer = null;
    const estimate = 32 + job.bullets.reduce((sum, value) => sum + linesFor(value, 'regular', 10.2, 9).length * 15 + 3, 0) + 7;
    // Long employers paginate internally; never move their heading away from
    // the section heading or reserve a block taller than a page.
    if (job !== model.experience[0]) ensure(Math.min(estimate, 100));
    header(job.title, job.date, job.subtitle, job.location, job.url);
    employer = job.title;
    job.bullets.forEach(value => bullet(value));
    for (const group of job.groups ?? []) {
      nestedHeading(group.title, lineKeep(linesFor(group.bullets[0], 'regular', 10.2, 18).length) + 3);
      group.bullets.forEach(value => bullet(value, 9));
      y += 3;
    }
    workGroup('Engagements', job.audits);
    workGroup('Research and Bugs', job.research);
    employer = null;
    y += 7;
  }
  section('Awards & Achievements', 45);
  for (const award of model.awards) {
    const lines = wrap(award.text, column - 50, 'regular', 10.2, fonts);
    ensure(lines.length * 15 + 3);
    const start = y;
    text('\u22c5', MARGIN + 1, y + 10.2, 'regular', 11);
    for (const line of lines) { text(line, MARGIN + 9, y + 10.2, 'regular', 10.2, 'left', award.url); y += 15; }
    text(`(${award.date})`, width - MARGIN, start + 10.2, 'italic', 9.7, 'right'); y += 3;
  }
  const projectHeight = project => linesFor(project.title, 'bold', 10.5).length * 15 + 2
    + project.bullets.reduce((sum, value) => sum + linesFor(value, 'regular', 10.2, 9).length * 15 + 2, 0) + 5;
  section('Projects', projectHeight(model.projects[0]));
  for (const project of model.projects) {
    ensure(projectHeight(project));
    paragraph(project.title, { font: 'bold', size: 10.5, after: 2, link: project.url });
    project.bullets.forEach(value => bullet(value));
    y += 5;
  }
  // Original short lists, including their original links. Keep each entry intact.
  function linkedList(items) {
    for (const item of items) {
      const value = `${item.title} - ${item.detail}`;
      ensure(linesFor(value, 'regular', 10.2, 9).length * 15 + 3);
      text('\u22c5', MARGIN + 1, y + 10.2, 'regular', 11);
      paragraph(value, { indent: 9, after: 3, link: item.url });
    }
  }
  section('Blogs', 45);
  linkedList(model.blogs);
  section('Talks', 45);
  linkedList(model.talks);
  section('Technical Skills', 40);
  for (const skill of model.skills) {
    ensure(35); text(skill.title, MARGIN, y + 10.2, 'bold');
    paragraph(skill.text, { indent: 128, after: 2 });
  }
  // The joke is an appendix to the real resume, never a replacement for it.
  if (model.qualifications.length) {
    section('Additional Qualifications', lineKeep(linesFor(model.qualifications[0], 'regular', 10.2, 9).length) + 3);
    model.qualifications.forEach(value => bullet(value));
  }
  pages.forEach((target, index) => {
    page = target; text(`${index + 1} / ${pages.length}`, width - MARGIN, height - 22, 'italic', 8, 'right');
  });
  return { width, height, pages, title: `${person.name} - Resume`, author: person.name };
}

export function checkLayout(document, fonts) {
  const issues = [];
  document.pages.forEach((page, index) => {
    for (const node of page.nodes) {
      if (node.type !== 'text') continue;
      if (node.x < MARGIN - .1 || node.x + node.width > document.width - MARGIN + .1)
        issues.push(`Page ${index + 1}: horizontal overflow: ${node.text}`);
      if (node.y - node.size < 0 || node.y > document.height - 15)
        issues.push(`Page ${index + 1}: vertical overflow: ${node.text}`);
      for (const glyph of shape(node.text, node.font, node.size, fonts).glyphs)
        if (!glyph.gid) issues.push(`Unsupported glyph U+${glyph.cp.toString(16).toUpperCase()}`);
    }
  });
  return [...new Set(issues)];
}
