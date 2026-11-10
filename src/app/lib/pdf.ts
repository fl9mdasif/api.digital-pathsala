import path from 'node:path';
import PDFDocument from 'pdfkit';

const FONT_DIR = path.resolve(process.cwd(), 'assets', 'fonts');
export const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansBengali-Regular.ttf');
export const FONT_BOLD = path.join(FONT_DIR, 'NotoSansBengali-Bold.ttf');

/** A4 document with Noto Sans Bengali registered (it also covers Latin text) so Bangla shapes correctly. */
export const createPdf = (opts: { margin?: number; layout?: 'portrait' | 'landscape' } = {}) => {
  const doc = new PDFDocument({
    size: 'A4',
    layout: opts.layout ?? 'portrait',
    margin: opts.margin ?? 40,
    info: { Producer: 'School Management' },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('regular');
  return doc;
};

export const pdfToBuffer = (doc: PDFKit.PDFDocument): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** poisha to a Taka string like 1,250.00 */
export const formatTaka = (poisha: number): string => {
  const taka = poisha / 100;
  return taka.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
