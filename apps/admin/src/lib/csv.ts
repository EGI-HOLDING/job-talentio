/** Minimal CSV export: quotes every field so commas and newlines survive. */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: Array<{ header: string; value: (row: T) => unknown }>,
): void {
  const head = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(','));
  // The BOM keeps Excel from mangling non-ASCII names in the export.
  const csv = `\uFEFF${[head, ...body].join('\r\n')}`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function timestampedName(prefix: string): string {
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${prefix}-${now}.csv`;
}
