import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { assertInExam, loadExam } from '../admitCard/admitCard.service';
import { collect, loadPhoto, type CardData } from '../idCard/idCard.service';
import { Tenant } from '../tenant/tenant.model';

type Locale = 'bn' | 'en';
export type SeatDesign = 'band' | 'framed' | 'mono';

interface Target {
  examId: string;
  sectionId?: string;
  studentIds?: string[];
  room: string;
  seatsPerRoom?: number;
  startSeat: number;
}

const L = {
  en: { title: 'Exam Seat', seat: 'Seat', room: 'Room', cls: 'Class', roll: 'Roll', id: 'ID', exam: 'Exam' },
  bn: { title: 'আসন বিন্যাস', seat: 'আসন', room: 'কক্ষ', cls: 'শ্রেণি', roll: 'রোল', id: 'আইডি', exam: 'পরীক্ষা' },
} as const;

export interface SeatRow {
  studentId: string;
  studentCode: string;
  name: string;
  roll: number;
  className: string;
  sectionName: string | null;
  seat: number;
  /** Empty when the plan has a single unnamed room. */
  room: string;
}

/** Seats in roll order. With `seatsPerRoom` the students fill one room after another, each room starting again at `startSeat`. */
export const assignSeats = (cards: CardData[], q: Pick<Target, 'room' | 'seatsPerRoom' | 'startSeat'>): SeatRow[] => {
  const ordered = [...cards].sort((a, b) => a.className.localeCompare(b.className) || (a.sectionName ?? '').localeCompare(b.sectionName ?? '') || a.roll - b.roll);
  const per = q.seatsPerRoom;
  return ordered.map((c, i) => {
    const roomNo = per ? Math.floor(i / per) + 1 : 0;
    const seat = q.startSeat + (per ? i % per : i);
    const room = per ? `${q.room || 'Room'} ${roomNo}`.trim() : q.room;
    return { studentId: c.studentObjectId, studentCode: c.studentId, name: c.name, roll: c.roll, className: c.className, sectionName: c.sectionName ?? null, seat, room };
  });
};

const load = async (q: Target, locale: Locale) => {
  const exam = await loadExam(q.examId);
  const cards = await collect(q, locale);
  assertInExam(exam, cards);
  return { exam, cards, rows: assignSeats(cards, q) };
};

/** The seat list as data, for the preview table. */
export const assign = async (q: Target) => {
  const { exam, rows } = await load(q, 'en');
  return { exam: { _id: q.examId, name: exam.name }, rows };
};

const COLS = 3;
const ROWS = 4;
const MARGIN = 28;
const GAP = 8;

interface Ctx {
  doc: PDFKit.PDFDocument;
  design: SeatDesign;
  main: string;
  locale: Locale;
  school: string;
  exam: string;
}

const drawSeat = (ctx: Ctx, r: SeatRow, photo: Buffer | null, x: number, y: number, w: number, h: number) => {
  const { doc, design, main, locale } = ctx;
  const t = L[locale];
  const ink = '#111111';
  const accent = design === 'mono' ? '#000000' : main;

  if (design === 'band') {
    doc.roundedRect(x, y, w, h, 5).lineWidth(0.7).stroke('#888888');
    doc.save().roundedRect(x, y, w, 34, 5).clip().rect(x, y, w, 34).fill(accent).restore();
    doc.fillColor('#ffffff');
  } else {
    doc.roundedRect(x, y, w, h, 5).lineWidth(design === 'framed' ? 1.8 : 1).stroke(accent);
    if (design === 'framed') doc.roundedRect(x + 3.5, y + 3.5, w - 7, h - 7, 3).lineWidth(0.4).stroke(accent);
    doc.fillColor(accent);
  }
  doc.font('bold').fontSize(8.5).text(ctx.school, x + 6, y + 7, { width: w - 12, align: 'center', height: 11, ellipsis: true, lineBreak: false });
  doc.font('regular').fontSize(7.5).text(`${t.title} - ${ctx.exam}`, x + 6, y + 20, { width: w - 12, align: 'center', height: 10, ellipsis: true, lineBreak: false });

  // the seat number is the thing people look for, so it is the biggest
  doc.fillColor(accent).font('bold').fontSize(34).text(String(r.seat), x + 6, y + 44, { width: w - 12, align: 'center', height: 40, lineBreak: false });
  doc.fillColor('#555555').font('regular').fontSize(7.5).text(t.seat, x + 6, y + 84, { width: w - 12, align: 'center', lineBreak: false });
  if (r.room) doc.fillColor(ink).font('bold').fontSize(9).text(`${t.room}: ${r.room}`, x + 6, y + 96, { width: w - 12, align: 'center', height: 12, ellipsis: true, lineBreak: false });

  let ny = y + 114;
  if (photo) {
    try {
      doc.image(photo, x + w / 2 - 18, ny, { fit: [36, 44], align: 'center' });
      doc.rect(x + w / 2 - 18, ny, 36, 44).lineWidth(0.4).stroke('#bbbbbb');
      ny += 48;
    } catch {
      /* an unreadable photo leaves the space */
    }
  }
  doc.fillColor(ink).font('bold').fontSize(9.5).text(r.name, x + 6, ny, { width: w - 12, align: 'center', height: 12, ellipsis: true, lineBreak: false });
  doc.font('regular').fontSize(8).text(`${t.cls}: ${r.className}${r.sectionName ? ` - ${r.sectionName}` : ''}`, x + 6, ny + 13, { width: w - 12, align: 'center', height: 10, ellipsis: true, lineBreak: false });
  doc.text(`${t.roll}: ${r.roll}   ${t.id}: ${r.studentCode}`, x + 6, ny + 25, { width: w - 12, align: 'center', height: 10, ellipsis: true, lineBreak: false });
};

export const renderSeatPlan = async (q: Target & { design: SeatDesign; color: string; photo: boolean }, locale: Locale) => {
  const [{ exam, cards, rows }, tenant] = await Promise.all([load(q, locale), Tenant.findById(requireTenantId()).select('name nameBn').lean()]);
  const school = (locale === 'bn' && (tenant as any)?.nameBn) || (tenant as any)?.name || '';
  const byId = new Map(cards.map((c) => [c.studentObjectId, c]));
  const photos = q.photo ? await Promise.all(rows.map((r) => loadPhoto(byId.get(r.studentId)?.photoUrl))) : rows.map(() => null);

  const doc = createPdf({ margin: 0 });
  const w = (doc.page.width - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
  const h = (doc.page.height - 2 * MARGIN - (ROWS - 1) * GAP) / ROWS;
  const ctx: Ctx = { doc, design: q.design, main: q.color, locale, school, exam: exam.name };
  const perPage = COLS * ROWS;
  rows.forEach((r, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const slot = i % perPage;
    drawSeat(ctx, r, photos[i], MARGIN + (slot % COLS) * (w + GAP), MARGIN + Math.floor(slot / COLS) * (h + GAP), w, h);
  });

  await writeAudit({
    action: 'seatPlan.print',
    entityType: 'SeatPlan',
    entityId: requireTenantId(),
    after: { examId: q.examId, count: rows.length, design: q.design, rooms: new Set(rows.map((r) => r.room)).size },
  });
  return { pdf: await pdfToBuffer(doc), count: rows.length };
};
