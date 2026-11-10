import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { dayOfWeek, todayLocal } from '../../lib/localDate';
import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { Exam } from '../exam/exam.model';
import { list as listRoutine } from '../examRoutine/examRoutine.service';
import { collect, loadPhoto, type CardData } from '../idCard/idCard.service';
import { Invoice } from '../invoice/invoice.model';
import { Tenant } from '../tenant/tenant.model';
import { AdmitCardConfig, DEFAULT_ADMIT_CARD_CONFIG } from './admitCard.model';

type Config = typeof DEFAULT_ADMIT_CARD_CONFIG;
type Locale = 'bn' | 'en';
type Target = { examId: string; sectionId?: string; studentIds?: string[] };

const L = {
  en: { title: 'Admit Card', id: 'ID', cls: 'Class', roll: 'Roll', date: 'Date', day: 'Day', time: 'Time', subject: 'Subject', room: 'Room', due: 'Overdue fees' },
  bn: { title: 'প্রবেশপত্র', id: 'আইডি', cls: 'শ্রেণি', roll: 'রোল', date: 'তারিখ', day: 'বার', time: 'সময়', subject: 'বিষয়', room: 'কক্ষ', due: 'বকেয়া ফি' },
} as const;
const DAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  bn: ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'],
};

export const getConfig = async (): Promise<Config> => {
  const c = await AdmitCardConfig.findOne().lean();
  return c
    ? { signatureTitle: c.signatureTitle, instructions: c.instructions ?? '', blockIfDue: c.blockIfDue, maxDueAllowed: c.maxDueAllowed }
    : { ...DEFAULT_ADMIT_CARD_CONFIG };
};

export const saveConfig = async (input: Config) => {
  const before = await getConfig();
  await AdmitCardConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'admitCard.config', entityType: 'AdmitCardConfig', entityId: requireTenantId(), before, after: input });
  return input;
};

/** Overdue unpaid amount (poisha) per student. Only invoices already past their due date count. */
const overdueByStudent = async (studentIds: string[]) => {
  const rows = await Invoice.aggregate([
    {
      $match: {
        studentId: { $in: studentIds.map((id) => new Types.ObjectId(id)) },
        status: { $in: ['unpaid', 'partial'] },
        dueDate: { $lt: todayLocal() },
      },
    },
    { $group: { _id: '$studentId', due: { $sum: '$dueAmount' } } },
  ]);
  return new Map<string, number>(rows.map((r: any) => [String(r._id), r.due]));
};

const loadExam = async (examId: string) => {
  const exam = await Exam.findById(examId).select('name classIds').lean();
  if (!exam) throw AppError.notFound('Exam not found');
  return exam as any;
};

const assertInExam = (exam: any, cards: CardData[]) => {
  if (!exam.classIds?.length) return;
  const allowed = new Set(exam.classIds.map(String));
  if (cards.some((c) => !allowed.has(c.classId)))
    throw AppError.badRequest('Some of these students are in a class that is not part of the exam', undefined, 'CLASS_NOT_IN_EXAM');
};

/** Each student with their overdue fees and whether the school settings would block the card. */
export const eligibility = async (q: Target) => {
  const [exam, cfg] = await Promise.all([loadExam(q.examId), getConfig()]);
  const cards = await collect(q, 'en');
  assertInExam(exam, cards);
  const due = await overdueByStudent(cards.map((c) => c.studentObjectId));
  return {
    exam: { _id: q.examId, name: exam.name },
    blockIfDue: cfg.blockIfDue,
    maxDueAllowed: cfg.maxDueAllowed,
    rows: cards.map((c) => {
      const overdue = due.get(c.studentObjectId) ?? 0;
      return {
        studentId: c.studentObjectId,
        studentCode: c.studentId,
        name: c.name,
        roll: c.roll,
        overdue,
        blocked: cfg.blockIfDue && overdue > cfg.maxDueAllowed,
      };
    }),
  };
};

export const renderAdmitCards = async (q: Target & { includeBlocked: boolean }, locale: Locale) => {
  const [exam, cfg, tenant] = await Promise.all([
    loadExam(q.examId),
    getConfig(),
    Tenant.findById(requireTenantId()).select('name nameBn').lean(),
  ]);
  const all = await collect(q, locale);
  assertInExam(exam, all);
  const due = await overdueByStudent(all.map((c) => c.studentObjectId));
  const blocked = all.filter((c) => cfg.blockIfDue && (due.get(c.studentObjectId) ?? 0) > cfg.maxDueAllowed);
  const cards = q.includeBlocked ? all : all.filter((c) => !blocked.includes(c));
  if (cards.length === 0)
    throw AppError.badRequest('Every selected student is blocked by overdue fees', undefined, 'ALL_BLOCKED');

  const schedules = new Map<string, any[]>();
  for (const c of cards) {
    const key = `${c.classId}|${c.sectionId ?? ''}`;
    if (!schedules.has(key)) {
      const r = await listRoutine({ examId: q.examId, classId: c.classId, sectionId: c.sectionId });
      schedules.set(key, r.entries);
    }
    if (schedules.get(key)!.length === 0)
      throw AppError.badRequest('Schedule the exam routine for this class before printing admit cards', undefined, 'NO_ROUTINE');
  }
  const photos = await Promise.all(cards.map((c) => loadPhoto(c.photoUrl)));
  const t = L[locale];
  const schoolName = (locale === 'bn' && (tenant as any)?.nameBn) || (tenant as any)?.name || '';

  const doc = createPdf({ margin: 0 });
  const PAGE_H = doc.page.height;
  const X = 30;
  const W = doc.page.width - 60;
  let y = 30;

  cards.forEach((c, i) => {
    const entries = schedules.get(`${c.classId}|${c.sectionId ?? ''}`)!;
    const rowH = 13;
    const tableTop = 128;
    const cardH = Math.max(385, tableTop + 16 + entries.length * rowH + 78);
    if (y + cardH > PAGE_H - 20) {
      doc.addPage();
      y = 30;
    }

    doc.roundedRect(X, y, W, cardH, 6).lineWidth(0.8).stroke('#555555');
    doc.fillColor('#111111').font('bold').fontSize(14).text(schoolName, X + 10, y + 10, { width: W - 20, align: 'center', height: 18, ellipsis: true });
    doc.fontSize(11).text(`${t.title} - ${exam.name}`, X + 10, y + 32, { width: W - 20, align: 'center', height: 15, ellipsis: true });

    doc.font('bold').fontSize(11).text(c.name, X + 16, y + 62, { width: W - 120, height: 15, ellipsis: true });
    doc.font('regular').fontSize(9);
    doc.text(`${t.id}: ${c.studentId}`, X + 16, y + 80);
    doc.text(`${t.cls}: ${c.className}${c.sectionName ? ` - ${c.sectionName}` : ''}     ${t.roll}: ${c.roll}`, X + 16, y + 94);
    if (q.includeBlocked && blocked.includes(c))
      doc.fillColor('#b00020').text(`${t.due}: ${((due.get(c.studentObjectId) ?? 0) / 100).toFixed(2)}`, X + 16, y + 108).fillColor('#111111');

    const px = X + W - 76;
    doc.rect(px, y + 56, 56, 68).lineWidth(0.5).stroke('#bbbbbb');
    const photo = photos[i];
    if (photo) {
      try {
        doc.image(photo, px + 1, y + 57, { fit: [54, 66], align: 'center', valign: 'center' });
      } catch {
        /* an unreadable image leaves the empty frame */
      }
    }

    const cols = [X + 16, X + 96, X + 176, X + 296, X + W - 76];
    const head = [t.date, t.day, t.time, t.subject, t.room];
    const ty = y + tableTop;
    doc.moveTo(X + 12, ty - 2).lineTo(X + W - 12, ty - 2).lineWidth(0.5).stroke('#888888');
    doc.font('bold').fontSize(8.5);
    head.forEach((h, k) => doc.text(h, cols[k], ty + 1, { width: k === 3 ? 125 : 76 }));
    doc.font('regular').fontSize(8);
    entries.forEach((e, r) => {
      const ry = ty + 16 + r * rowH;
      const row = [e.date, DAYS[locale][dayOfWeek(e.date)], `${e.startTime}-${e.endTime}`, (locale === 'bn' && e.subject?.nameBn) || e.subject?.name || '', e.room ?? ''];
      row.forEach((v, k) => doc.text(v, cols[k], ry, { width: k === 3 ? 125 : 76, height: 11, ellipsis: true }));
    });

    const by = y + cardH - 52;
    if (cfg.instructions) doc.fillColor('#444444').fontSize(7.5).text(cfg.instructions, X + 16, by, { width: W - 200, height: 36, ellipsis: true });
    doc.fillColor('#111111').moveTo(X + W - 150, y + cardH - 24).lineTo(X + W - 16, y + cardH - 24).lineWidth(0.5).stroke('#555555');
    doc.fontSize(8).text(cfg.signatureTitle, X + W - 150, y + cardH - 20, { width: 134, align: 'center' });
    y += cardH + 12;
  });

  await writeAudit({
    action: 'admitCard.print',
    entityType: 'AdmitCard',
    entityId: requireTenantId(),
    after: { examId: q.examId, count: cards.length, blocked: blocked.length, includeBlocked: q.includeBlocked },
  });
  return { pdf: await pdfToBuffer(doc), count: cards.length, blocked: q.includeBlocked ? 0 : blocked.length };
};
