/**
 * Backend-authoritative product imagery.
 *
 * Catalogue images are stored in PostgreSQL as ImageKit CDN URLs (or, when the
 * upload is still pending, the static ImageKit folder pointer). The frontend
 * must render those URLs verbatim and never substitute a bundled sample JPEG.
 * When no backend URL exists we render a neutral SVG placeholder instead.
 */
export const FALLBACK_PRODUCT_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="10" fill="#f1f5f9"/><path d="M26 62l13-16 11 12 9-10 11 14H26z" fill="#cbd5e1"/><circle cx="36" cy="34" r="6" fill="#e2e8f0"/></svg>'
  );

export function resolveBackendImageUrl(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
  }
  return FALLBACK_PRODUCT_IMAGE;
}
