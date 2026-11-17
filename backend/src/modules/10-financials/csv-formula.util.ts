/**
 * Neutralizes spreadsheet formula injection (CWE-1236) and formats RFC-4180 CSV cells.
 * Any value starting with =, +, -, @, tab (\t), or carriage return (\r) is prefixed with '.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

export const UTF8_BOM = '\uFEFF';
