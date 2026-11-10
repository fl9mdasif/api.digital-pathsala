import QRCode from 'qrcode';

/** Draws a QR code as vector squares into a pdfkit document. Nothing is rasterised, so it prints sharp at any size. */
export const drawQr = (doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number, color = '#000000') => {
  if (!text) return;
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  doc.save().fillColor(color);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.modules.data[r * n + c]) doc.rect(x + c * cell, y + r * cell, cell + 0.15, cell + 0.15).fill();
  doc.restore();
};
