import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { fillTemplate } from '../../lib/fillTemplate';
import { dayOfWeek, todayLocal } from '../../lib/localDate';
import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { drawQr } from '../../lib/qr';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { Enrolment } from '../enrolment/enrolment.model';
import { currentSession } from '../enrolment/enrolment.service';
import { Exam } from '../exam/exam.model';
import { ExamRoutineEntry } from '../examRoutine/examRoutine.model';
import { list as listRoutine } from '../examRoutine/examRoutine.service';
import { collect, loadPhoto, loadPng, SAMPLE_CARD, type CardData } from '../idCard/idCard.service';
import { Invoice } from '../invoice/invoice.model';
import { Student } from '../student/student.model';
import { linkedStudentIds } from '../student/student.access';
import { Tenant } from '../tenant/tenant.model';
import { AdmitCardConfig, AdmitLockRule, normalizeAdmitConfig, type AdmitConfigData, type AdmitDesign } from './admitCard.model';

type Locale = 'bn' | 'en';
type Target = { examId: string; sectionId?: string; studentIds?: string[] };
type Auth = { userId: Types.ObjectId; role: string };

const L = {
  en: { title: 'Admit Card', id: 'ID', cls: 'Class', roll: 'Roll', group: 'Group', father: 'Father', dob: 'DOB', date: 'Date', day: 'Day', time: 'Time', subject: 'Subject', room: 'Room', due: 'Overdue fees', notes: 'Instructions' },
  bn: { title: 'প্রবেশপত্র', id: 'আইডি', cls: 'শ্রেণি', roll: 'রোল', group: 'বিভাগ', father: 'পিতা', dob: 'জন্ম', date: 'তারিখ', day: 'বার', time: 'সময়', subject: 'বিষয়', room: 'কক্ষ', due: 'বকেয়া ফি', notes: 'নির্দেশনা' },
} as const;
const DAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  bn: ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'],
};

export const getConfig = async (): Promise<AdmitConfigData> => normalizeAdmitConfig(await AdmitCardConfig.findOne().lean());

export const saveConfig = async (input: AdmitConfigData) => {
  const before = await getConfig();
  await AdmitCardConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'admitCard.config', entityType: 'AdmitCardConfig', entityId: requireTenantId(), before, after: input });
  return getConfig();
};

// ---------------------------------------------------------------- fee lockdown

export interface Policy {
  blockIfDue: boolean;
  /** Poisha. */
  maxDueAllowed: number;
  /** Empty means every fee head counts. */
  feeHeadIds: string[];
  adminCanPrint: boolean;
  source: 'rule' | 'default';
}

/** The lockdown that applies to one exam: its own rule if it has one, else the school-wide default. */
export const policyFor = async (examId: string, cfg?: AdmitConfigData): Promise<Policy> => {
  const rule: any = await AdmitLockRule.findOne({ examId }).lean();
  if (rule)
    return { blockIfDue: !!rule.active, maxDueAllowed: rule.maxDueAllowed ?? 0, feeHeadIds: (rule.feeHeadIds ?? []).map(String), adminCanPrint: rule.adminCanPrint !== false, source: 'rule' };
  const c = cfg ?? (await getConfig());
  return { blockIfDue: c.blockIfDue, maxDueAllowed: c.maxDueAllowed, feeHeadIds: [], adminCanPrint: true, source: 'default' };
};

/** Overdue unpaid amount (poisha) per student. Only invoices already past their due date count, and, when the rule names fee heads, only invoices that include one of them. */
const overdueByStudent = async (studentIds: string[], feeHeadIds: string[] = []) => {
  const match: Record<string, unknown> = {
    studentId: { $in: studentIds.map((id) => new Types.ObjectId(id)) },
    status: { $in: ['unpaid', 'partial'] },
    dueDate: { $lt: todayLocal() },
  };
  if (feeHeadIds.length) match['lines.feeHeadId'] = { $in: feeHeadIds.map((id) => new Types.ObjectId(id)) };
  const rows = await Invoice.aggregate([{ $match: match }, { $group: { _id: '$studentId', due: { $sum: '$dueAmount' } } }]);
  return new Map<string, number>(rows.map((r: any) => [String(r._id), r.due]));
};

const isBlocked = (p: Policy, overdue: number) => p.blockIfDue && overdue > p.maxDueAllowed;

export const listLockRules = async () => {
  const [exams, rules] = await Promise.all([
    Exam.find().select('name status startDate').sort({ createdAt: -1 }).limit(100).lean(),
    AdmitLockRule.find().lean(),
  ]);
  const byExam = new Map(rules.map((r: any) => [String(r.examId), r]));
  return exams.map((e: any) => {
    const r: any = byExam.get(String(e._id));
    return {
      examId: String(e._id),
      examName: e.name,
      status: e.status,
      startDate: e.startDate ?? null,
      rule: r ? { active: r.active, maxDueAllowed: r.maxDueAllowed, feeHeadIds: (r.feeHeadIds ?? []).map(String), adminCanPrint: r.adminCanPrint } : null,
    };
  });
};

export const saveLockRule = async (examId: string, input: { active: boolean; maxDueAllowed: number; feeHeadIds: string[]; adminCanPrint: boolean }) => {
  await loadExam(examId);
  const before = await AdmitLockRule.findOne({ examId }).lean();
  await AdmitLockRule.findOneAndUpdate({ examId }, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'admitCard.lockRule', entityType: 'AdmitLockRule', entityId: new Types.ObjectId(examId), before, after: input });
  return (await listLockRules()).find((r) => r.examId === examId)!;
};

export const deleteLockRule = async (examId: string) => {
  const before = await AdmitLockRule.findOneAndDelete({ examId }).lean();
  if (!before) throw AppError.notFound('This exam has no lockdown rule');
  await writeAudit({ action: 'admitCard.lockRuleRemoved', entityType: 'AdmitLockRule', entityId: new Types.ObjectId(examId), before });
};

// ---------------------------------------------------------------- lookups

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

/** Each student with their overdue fees and whether the exam's lockdown would block the card. */
export const eligibility = async (q: Target) => {
  const [exam, cfg] = await Promise.all([loadExam(q.examId), getConfig()]);
  const policy = await policyFor(q.examId, cfg);
  const cards = await collect(q, 'en');
  assertInExam(exam, cards);
  const due = await overdueByStudent(cards.map((c) => c.studentObjectId), policy.feeHeadIds);
  return {
    exam: { _id: q.examId, name: exam.name },
    blockIfDue: policy.blockIfDue,
    maxDueAllowed: policy.maxDueAllowed,
    adminCanPrint: policy.adminCanPrint,
    source: policy.source,
    rows: cards.map((c) => {
      const overdue = due.get(c.studentObjectId) ?? 0;
      return { studentId: c.studentObjectId, studentCode: c.studentId, name: c.name, roll: c.roll, overdue, blocked: isBlocked(policy, overdue) };
    }),
  };
};

// ---------------------------------------------------------------- drawing

interface RoutineRow {
  date: string;
  startTime: string;
  endTime: string;
  room?: string | null;
  subject?: { name?: string; nameBn?: string } | null;
}

const SAMPLE_ROUTINE: RoutineRow[] = [
  { date: '2026-12-01', startTime: '10:00', endTime: '12:00', room: 'Hall 1', subject: { name: 'Bangla', nameBn: 'বাংলা' } },
  { date: '2026-12-03', startTime: '10:00', endTime: '12:00', room: 'Hall 1', subject: { name: 'English', nameBn: 'ইংরেজি' } },
  { date: '2026-12-05', startTime: '10:00', endTime: '12:00', room: 'Hall 1', subject: { name: 'Mathematics', nameBn: 'গণিত' } },
  { date: '2026-12-07', startTime: '10:00', endTime: '12:00', room: 'Hall 2', subject: { name: 'Science', nameBn: 'বিজ্ঞান' } },
  { date: '2026-12-09', startTime: '10:00', endTime: '12:00', room: 'Hall 2', subject: { name: 'Social Science', nameBn: 'সমাজ বিজ্ঞান' } },
];

const PAGE_MARGIN = 28;
const SLOT_GAP = 10;
const ROW_H = 10.5;

/** Height a card needs: header, student block, the routine rows, then signatures and notes. */
const needed = (rows: number, showRoutine: boolean) => 44 + 66 + (showRoutine ? 14 + rows * ROW_H : 0) + 56;
const slotHeight = (pageH: number, n: number) => (pageH - 2 * PAGE_MARGIN - SLOT_GAP * (n - 1)) / n;

interface Ctx {
  doc: PDFKit.PDFDocument;
  cfg: AdmitConfigData;
  design: AdmitDesign;
  locale: Locale;
  schoolName: string;
  examName: string;
  signature: Buffer | null;
  main: string;
  ink: string;
}

const drawFrame = (ctx: Ctx, x: number, y: number, w: number, h: number) => {
  const { doc, design, main } = ctx;
  if (design === 'modern') {
    doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).stroke('#888888');
    doc.save().roundedRect(x, y, w, 40, 6).clip().rect(x, y, w, 40).fill(main).restore();
  } else if (design === 'classic') {
    doc.roundedRect(x, y, w, h, 6).lineWidth(1.6).stroke(main);
    doc.roundedRect(x + 3.5, y + 3.5, w - 7, h - 7, 4).lineWidth(0.5).stroke(main);
  } else if (design === 'idstyle') {
    doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).stroke('#888888');
    doc.save().roundedRect(x, y, w, h, 6).clip().rect(x, y, 14, h).fill(main).restore();
  } else {
    doc.rect(x, y, w, h).lineWidth(1).stroke('#000000');
  }
};

const drawCard = (ctx: Ctx, c: CardData, rows: RoutineRow[], photo: Buffer | null, due: number | null, x: number, y: number, w: number, h: number) => {
  const { doc, cfg, design, locale, main, ink } = ctx;
  const t = L[locale];
  const s = cfg.show;
  drawFrame(ctx, x, y, w, h);

  const left = x + (design === 'idstyle' ? 26 : 16);
  const right = x + w - 16;
  const onBand = design === 'modern';
  doc.fillColor(onBand ? '#ffffff' : design === 'mono' ? '#000000' : main).font('bold').fontSize(13).text(ctx.schoolName, left, y + 8, { width: right - left, align: 'center', height: 16, ellipsis: true, lineBreak: false });
  doc.fontSize(9.5).text(`${t.title} - ${ctx.examName}`, left, y + 25, { width: right - left, align: 'center', height: 12, ellipsis: true, lineBreak: false });
  if (design === 'classic' || design === 'idstyle') doc.moveTo(left, y + 41).lineTo(right, y + 41).lineWidth(0.5).stroke(main);

  // student block: details on the left, photo and QR on the right
  const top = y + 50;
  doc.fillColor(ink).font('bold').fontSize(11).text(c.name, left, top, { width: right - left - 130, height: 14, ellipsis: true, lineBreak: false });
  const info: string[] = [`${t.id}: ${c.studentId}`];
  if (s.class) info.push(`${t.cls}: ${c.className}${c.sectionName ? ` - ${c.sectionName}` : ''}`);
  if (s.roll) info.push(`${t.roll}: ${c.roll}`);
  if (s.group && c.groupName) info.push(`${t.group}: ${c.groupName}`);
  if (s.father && c.fatherName) info.push(`${t.father}: ${c.fatherName}`);
  if (s.dob && c.dob) info.push(`${t.dob}: ${c.dob}`);
  doc.font('regular').fontSize(8.5);
  info.forEach((line, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    doc.text(line, left + col * ((right - left - 130) / 2), top + 16 + row * 12, { width: (right - left - 130) / 2 - 4, height: 11, ellipsis: true, lineBreak: false });
  });
  if (due !== null && s.dueAmount) doc.fillColor('#b00020').text(`${t.due}: ${(due / 100).toFixed(2)}`, left, top + 16 + Math.ceil(info.length / 2) * 12, { width: right - left - 130, lineBreak: false }).fillColor(ink);

  let rx = right;
  if (s.photo) {
    rx -= 56;
    doc.rect(rx, top - 4, 56, 68).lineWidth(0.5).stroke('#bbbbbb');
    if (photo) {
      try {
        doc.image(photo, rx + 1, top - 3, { fit: [54, 66], align: 'center', valign: 'center' });
      } catch {
        /* an unreadable image leaves the empty frame */
      }
    }
    rx -= 8;
  }
  if (s.qr) {
    rx -= 52;
    drawQr(doc, fillTemplate(cfg.qrData, { student_id: c.studentId, name: c.name, roll: c.roll, class_name: c.className, section_name: c.sectionName, exam: ctx.examName }), rx, top, 52, ink);
  }

  // routine table
  let ty = top + 74;
  if (s.routine) {
    const cols = [left, left + 70, left + 140, left + 220, right - 60];
    const widths = [66, 66, 76, right - left - 220 - 64, 56];
    doc.moveTo(left, ty - 2).lineTo(right, ty - 2).lineWidth(0.5).stroke('#888888');
    doc.font('bold').fontSize(8);
    [t.date, t.day, t.time, t.subject, t.room].forEach((hd, k) => doc.text(hd, cols[k], ty + 1, { width: widths[k], lineBreak: false }));
    doc.font('regular').fontSize(7.5);
    ty += 14;
    rows.forEach((e, r) => {
      const ry = ty + r * ROW_H;
      const cells = [e.date, DAYS[locale][dayOfWeek(e.date)], `${e.startTime}-${e.endTime}`, (locale === 'bn' && e.subject?.nameBn) || e.subject?.name || '', e.room ?? ''];
      cells.forEach((v, k) => doc.text(v, cols[k], ry, { width: widths[k], height: 10, ellipsis: true, lineBreak: false }));
    });
  }

  // footer: notes on the left, signatures on the right
  const sigs: { label: string; image?: Buffer | null }[] = [];
  if (s.sigClassTeacher) sigs.push({ label: cfg.sigClassTeacherLabel });
  if (s.sigAccounts) sigs.push({ label: cfg.sigAccountsLabel });
  if (s.sigHead) sigs.push({ label: cfg.signatureTitle, image: ctx.signature });
  const lineY = y + h - 20;
  const sigW = 96;
  if (cfg.instructions) doc.fillColor('#444444').font('regular').fontSize(7).text(cfg.instructions, left, lineY - 26, { width: right - left - sigs.length * (sigW + 8) - 8, height: 34, ellipsis: true });
  sigs.forEach((g, i) => {
    const sx = right - (sigs.length - i) * (sigW + 8) + 8;
    if (g.image) {
      try {
        doc.image(g.image, sx + 12, lineY - 17, { fit: [sigW - 24, 16] });
      } catch {
        /* an unreadable signature leaves the line */
      }
    }
    doc.moveTo(sx, lineY).lineTo(sx + sigW, lineY).lineWidth(0.5).stroke('#555555');
    doc.fillColor(ink).font('regular').fontSize(7.5).text(g.label, sx, lineY + 3, { width: sigW, align: 'center', height: 10, ellipsis: true, lineBreak: false });
  });
};

export interface RenderOptions extends Target {
  includeBlocked: boolean;
  design?: AdmitDesign;
  perPage?: number;
  sample?: boolean;
}

export const renderAdmitCards = async (q: RenderOptions, locale: Locale) => {
  const [cfg, tenant] = await Promise.all([getConfig(), Tenant.findById(requireTenantId()).select('name nameBn').lean()]);
  const schoolName = (locale === 'bn' && (tenant as any)?.nameBn) || (tenant as any)?.name || '';

  let cards: CardData[];
  let schedules = new Map<string, RoutineRow[]>();
  let dueByStudent = new Map<string, number>();
  let blocked: CardData[] = [];
  let examName: string;

  if (q.sample) {
    cards = [SAMPLE_CARD];
    schedules = new Map([[`${SAMPLE_CARD.classId}|`, SAMPLE_ROUTINE]]);
    examName = locale === 'bn' ? 'নমুনা পরীক্ষা' : 'Sample Examination';
  } else {
    const [exam, all] = await Promise.all([loadExam(q.examId), collect(q, locale)]);
    examName = exam.name;
    assertInExam(exam, all);
    const policy = await policyFor(q.examId, cfg);
    if (q.includeBlocked && !policy.adminCanPrint)
      throw AppError.forbidden('This exam is locked: cards of students with overdue fees cannot be printed, even by an admin', 'LOCKDOWN_NO_OVERRIDE');
    dueByStudent = await overdueByStudent(all.map((c) => c.studentObjectId), policy.feeHeadIds);
    blocked = all.filter((c) => isBlocked(policy, dueByStudent.get(c.studentObjectId) ?? 0));
    cards = q.includeBlocked ? all : all.filter((c) => !blocked.includes(c));
    if (cards.length === 0) throw AppError.badRequest('Every selected student is blocked by overdue fees', undefined, 'ALL_BLOCKED');

    for (const c of cards) {
      const key = `${c.classId}|${c.sectionId ?? ''}`;
      if (!schedules.has(key)) schedules.set(key, (await listRoutine({ examId: q.examId, classId: c.classId, sectionId: c.sectionId })).entries as RoutineRow[]);
      if (schedules.get(key)!.length === 0)
        throw AppError.badRequest('Schedule the exam routine for this class before printing admit cards', undefined, 'NO_ROUTINE');
    }
  }

  const [photos, signature] = await Promise.all([Promise.all(cards.map((c) => loadPhoto(c.photoUrl))), cfg.show.sigHead ? loadPng(cfg.signatureUrl, 300) : Promise.resolve(null)]);
  const design = q.design ?? cfg.design;
  const doc = createPdf({ margin: 0 });
  const PAGE_H = doc.page.height;
  const W = doc.page.width - 2 * PAGE_MARGIN;
  const ctx: Ctx = {
    doc,
    cfg,
    design,
    locale,
    schoolName,
    examName,
    signature,
    main: design === 'mono' ? '#000000' : cfg.themeColor,
    ink: '#111111',
  };

  // The most routine rows any card needs decides how many fit on a page; fewer per page when the routine is long.
  const maxRows = Math.max(...cards.map((c) => schedules.get(`${c.classId}|${c.sectionId ?? ''}`)?.length ?? 0));
  let perPage = q.perPage ?? cfg.perPage;
  while (perPage > 1 && needed(maxRows, cfg.show.routine) > slotHeight(PAGE_H, perPage)) perPage -= 1;
  const slotH = slotHeight(PAGE_H, perPage);

  cards.forEach((c, i) => {
    const slot = i % perPage;
    if (i > 0 && slot === 0) doc.addPage();
    const rows = schedules.get(`${c.classId}|${c.sectionId ?? ''}`) ?? [];
    const due = q.includeBlocked && blocked.includes(c) ? (dueByStudent.get(c.studentObjectId) ?? 0) : null;
    drawCard(ctx, c, rows, photos[i], due, PAGE_MARGIN, PAGE_MARGIN + slot * (slotH + SLOT_GAP), W, Math.max(slotH, perPage === 1 ? needed(rows.length, cfg.show.routine) : slotH));
  });

  await writeAudit({
    action: 'admitCard.print',
    entityType: 'AdmitCard',
    entityId: requireTenantId(),
    after: { examId: q.sample ? 'sample' : q.examId, count: cards.length, blocked: blocked.length, includeBlocked: q.includeBlocked, design, perPage },
  });
  return { pdf: await pdfToBuffer(doc), count: cards.length, blocked: q.includeBlocked ? 0 : blocked.length, perPage };
};

// ---------------------------------------------------------------- student and guardian portal

/** Published-or-running exams of the linked students' classes, with whether each card is ready or on hold. */
export const myAdmitCards = async (auth: Auth) => {
  const ids = await linkedStudentIds(auth);
  if (ids.length === 0) return [];
  const session = await currentSession();
  const [enrolments, students, exams, cfg] = await Promise.all([
    Enrolment.find({ sessionId: session._id, studentId: { $in: ids }, status: 'active' }).select('studentId classId').lean(),
    Student.find({ _id: { $in: ids } }).select('name').lean(),
    Exam.find({ sessionId: session._id, status: { $ne: 'draft' } }).select('name classIds startDate endDate').sort({ startDate: 1 }).lean(),
    getConfig(),
  ]);
  const names = new Map(students.map((s: any) => [String(s._id), s.name]));
  const out: any[] = [];
  for (const e of enrolments as any[]) {
    for (const exam of exams as any[]) {
      if (exam.classIds?.length && !exam.classIds.some((c: any) => String(c) === String(e.classId))) continue;
      const hasRoutine = !!(await ExamRoutineEntry.exists({ examId: exam._id, classId: e.classId }));
      const policy = await policyFor(String(exam._id), cfg);
      const overdue = policy.blockIfDue ? ((await overdueByStudent([String(e.studentId)], policy.feeHeadIds)).get(String(e.studentId)) ?? 0) : 0;
      out.push({
        studentId: String(e.studentId),
        studentName: names.get(String(e.studentId)) ?? '',
        examId: String(exam._id),
        examName: exam.name,
        startDate: exam.startDate ?? null,
        endDate: exam.endDate ?? null,
        ready: hasRoutine,
        blocked: isBlocked(policy, overdue),
        overdue: isBlocked(policy, overdue) ? overdue : 0,
      });
    }
  }
  return out;
};

/** One card for one linked student. The lockdown always applies here, with no admin override. */
export const myAdmitCardPdf = async (auth: Auth, examId: string, studentId: string, locale: Locale) => {
  const ids = await linkedStudentIds(auth);
  if (!ids.some((id) => String(id) === studentId)) throw AppError.forbidden();
  const policy = await policyFor(examId);
  const overdue = policy.blockIfDue ? ((await overdueByStudent([studentId], policy.feeHeadIds)).get(studentId) ?? 0) : 0;
  if (isBlocked(policy, overdue))
    throw AppError.forbidden('This admit card is on hold because of unpaid fees. Please contact the school office.', 'ADMIT_BLOCKED');
  return renderAdmitCards({ examId, studentIds: [studentId], includeBlocked: false }, locale);
};
