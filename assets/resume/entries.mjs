// Shared inline copy for HTML, SVG and PDF. Keep named repositories clickable.
export function entryRuns(item) {
  return [
    { text: item.title, font: 'bold', size: 10.2, link: item.repo },
    { text: ' - ', font: 'regular', size: 10.2 },
    ...item.summary.map(run => ({ text: run.text, font: 'regular', size: 10.2, link: run.url })),
  ];
}
export function referenceRuns(item) {
  const runs = [];
  if (item.links.length && item.referencePrefix) runs.push({ text: item.referencePrefix });
  item.links.forEach((link, index) => {
    if (index) runs.push({ text: '  ' });
    runs.push({ text: item.bareReferences ? link.label : `[${link.label}]`, link: link.url });
  });
  return runs.map(run => ({ ...run, font: 'italic', size: 9.3 }));
}
export function entryLines(item, measure, available) {
  const primary = entryRuns(item), refs = referenceRuns(item);
  const width = runs => runs.reduce((sum, run) => sum + measure(run), 0);
  if (width(primary) > available) throw new Error(`${item.id}: shorten the summary to one line`);
  if (width(refs) > available) throw new Error(`${item.id}: references exceed one line`);
  if (!refs.length) return [primary];
  const combined = [...primary, { text: '  ', font: 'regular', size: 10.2 }, ...refs];
  return !item.bareReferences && width(combined) <= available ? [combined] : [primary, refs];
}
