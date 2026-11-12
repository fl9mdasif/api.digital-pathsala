import { AppError } from '../../errors/AppError';
import { fillTemplate } from '../../lib/fillTemplate';
import { buildMeta, escapeRegex, toSkip } from '../../lib/pagination';
import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { drawQr } from '../../lib/qr';
import { requireTenantId } from '../../lib/tenantContext';
import { AcademicSession } from '../academicSession/academicSession.model';
import { writeAudit } from '../auditLog/auditLog.model';
import { ClassModel } from '../class/class.model';
import { nextSeq } from '../counter/counter.model';
import { Enrolment } from '../enrolment/enrolment.model';
import { Exam } from '../exam/exam.model';
import { Guardian } from '../guardian/guardian.model';
import { loadPhoto, loadPng } from '../idCard/idCard.service';
import { Result } from '../result/result.model';
import { Section } from '../section/section.model';
import { Student } from '../student/student.model';
import { Tenant } from '../tenant/tenant.model';
import {
  Certificate,
  CertificateConfig,
  normalizeCertificateConfig,
  type CertificateConfigData,
  type CertificateLayout,
} from './certificate.model';

type Locale = 'bn' | 'en';

export const getConfig = async (): Promise<CertificateConfigData> => normalizeCertificateConfig(await CertificateConfig.findOne().lean());

export const saveConfig = async (input: CertificateConfigData) => {
  const before = await getConfig();
  await CertificateConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'certificate.config', entityType: 'CertificateConfig', entityId: requireTenantId(), before, after: input });
  return getConfig();
};

export const DEFAULT_BODY: Record<Locale, string> = {
  bn: 'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {name}, পিতা: {father_name}, মাতা: {mother_name}, {session} শিক্ষাবর্ষে এই প্রতিষ্ঠানের {class_name} শ্রেণিতে (শাখা: {section_name}, রোল: {roll}) অধ্যয়ন করে কৃতিত্বের সাথে শিক্ষাবর্ষ সমাপ্ত করেছে।{gpa_line} আমরা তার উত্তরোত্তর সাফল্য ও উজ্জ্বল ভবিষ্যৎ কামনা করি।',
  en: 'This is to certify that {name}, child of {father_name} and {mother_name}, studied in {class_name} (Section {section_name}, Roll {roll}) of this institution during the academic session {session} and has successfully completed the year.{gpa_line} We wish {him_her} every success and a bright future.',
};
const GPA_LINE: Record<Locale, string> = {
  bn: ' {exam} ফলাফলে তার প্রাপ্ত জিপিএ {gpa} (গ্রেড {letter})।',
  en: ' In the {exam}, {he_she} achieved GPA {gpa} (Grade {letter}).',
};
const TITLE: Record<Locale, { title: string; sub: string; no: string; date: string; verify: string }> = {
  bn: { title: 'বার্ষিক সমাপনী সনদপত্র', sub: 'শিক্ষাবর্ষ সমাপ্তির প্রত্যয়ন', no: 'ক্রমিক নং', date: 'তারিখ', verify: 'যাচাই' },
  en: { title: 'Certificate of Completion', sub: 'Academic year completion', no: 'Serial', date: 'Date', verify: 'Verify' },
};

const words = (gender: string | undefined, locale: Locale) => {
  if (locale === 'bn') return { he_she: 'সে', his_her: 'তার', him_her: 'তাকে' };
  if (gender === 'male') return { he_she: 'he', his_her: 'his', him_her: 'him' };
  if (gender === 'female') return { he_she: 'she', his_her: 'her', him_her: 'her' };
  return { he_she: 'they', his_her: 'their', him_her: 'them' };
};

export const renderBody = (r: any, cfg: CertificateConfigData, locale: Locale, school = ''): string => {
  const values = {
    name: (locale === 'bn' && r.nameBn) || r.name,
    father_name: r.fatherName || '-',
    mother_name: r.motherName || '-',
    student_id: r.studentCode,
    class_name: (locale === 'bn' && r.classNameBn) || r.className,
    section_name: r.sectionName || '-',
    roll: r.roll,
    session: r.sessionName,
    gpa: r.gpa,
    letter: r.letter,
    exam: r.examName || (locale === 'bn' ? 'বার্ষিক পরীক্ষার' : 'annual examination'),
    school,
    issue_date: r.issueDate,
    serial: r.serial,
    ...words(r.gender, locale),
  };
  const gpaLine = cfg.show.gpa && r.gpa ? fillTemplate(GPA_LINE[locale], values) : '';
  const text = fillTemplate(cfg.bodyTemplate || DEFAULT_BODY[locale], { ...values, gpa_line: gpaLine });
  return locale === 'bn' ? bnDigits(text) : text;
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Bangla certificates print numbers in Bangla digits (serial numbers stay as they are). */
export const bnDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

const fmtGpa = (g: unknown) => (typeof g === 'number' && Number.isFinite(g) ? g.toFixed(2) : '');

/** Parents' names from the guardian records, by student. */
const parentsOf = async (studentIds: unknown[]) => {
  const rows: any[] = await Guardian.find({ studentIds: { $in: studentIds } }).select('name relation studentIds').lean();
  const map = new Map<string, { father?: string; mother?: string }>();
  for (const g of rows)
    for (const sid of g.studentIds ?? []) {
      const k = String(sid);
      const p = map.get(k) ?? {};
      if (g.relation === 'father' && !p.father) p.father = g.name;
      if (g.relation === 'mother' && !p.mother) p.mother = g.name;
      map.set(k, p);
    }
  return map;
};

const publishedResults = async (examId: string | undefined, studentIds: unknown[]) => {
  if (!examId) return { exam: null as any, byStudent: new Map<string, any>() };
  const exam: any = await Exam.findById(examId).select('name sessionId').lean();
  if (!exam) throw AppError.badRequest('Exam not found', undefined, 'EXAM_NOT_FOUND');
  const rows: any[] = await Result.find({ examId, studentId: { $in: studentIds }, status: 'published' }).select('studentId gpa letter').lean();
  return { exam, byStudent: new Map(rows.map((r) => [String(r.studentId), r])) };
};

/**
 * The students who completed one class in one session: their enrolment for that year was closed by promotion
 * (a repeated or still active year does not count).
 */
export const candidates = async (q: { sessionId: string; classId: string; sectionId?: string; examId?: string }) => {
  const filter: Record<string, unknown> = { sessionId: q.sessionId, classId: q.classId, status: 'promoted' };
  if (q.sectionId) filter.sectionId = q.sectionId;
  const enrols: any[] = await Enrolment.find(filter).sort({ roll: 1 }).lean();
  const studentIds = enrols.map((e) => e.studentId);
  const [students, sections, parents, results, issued] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('name nameBn studentId').lean(),
    Section.find({ _id: { $in: enrols.map((e) => e.sectionId) } }).select('name').lean(),
    parentsOf(studentIds),
    publishedResults(q.examId, studentIds),
    Certificate.find({ enrolmentId: { $in: enrols.map((e) => e._id) }, status: 'issued' }).select('enrolmentId serial').lean(),
  ]);
  const stu = new Map((students as any[]).map((s) => [String(s._id), s]));
  const sec = new Map((sections as any[]).map((s) => [String(s._id), s.name]));
  const done = new Map((issued as any[]).map((c) => [String(c.enrolmentId), c.serial]));
  return enrols.map((e) => {
    const s: any = stu.get(String(e.studentId)) ?? {};
    const r = results.byStudent.get(String(e.studentId));
    return {
      enrolmentId: String(e._id),
      studentId: String(e.studentId),
      studentCode: s.studentId,
      name: s.name,
      nameBn: s.nameBn,
      roll: e.roll,
      sectionName: sec.get(String(e.sectionId)) ?? null,
      fatherName: parents.get(String(e.studentId))?.father ?? null,
      gpa: fmtGpa(r?.gpa),
      letter: r?.letter ?? '',
      issuedSerial: done.get(String(e._id)) ?? null,
    };
  });
};

/** Issues one numbered certificate per completed year: CRT-YYYY-NNNN, numbered per year of issue. */
export const issue = async (input: { issueDate: string; examId?: string; items: { enrolmentId: string; gpa?: string; letter?: string }[] }) => {
  const ids = [...new Set(input.items.map((i) => i.enrolmentId))];
  if (ids.length !== input.items.length) throw AppError.badRequest('A student appears twice in this batch', undefined, 'DUPLICATE_STUDENT');
  const enrols: any[] = await Enrolment.find({ _id: { $in: ids } }).lean();
  if (enrols.length !== ids.length) throw AppError.badRequest('Some enrolments were not found', undefined, 'ENROLMENT_NOT_FOUND');
  if (enrols.some((e) => e.status !== 'promoted'))
    throw AppError.badRequest('A certificate is only for a completed (promoted) year', undefined, 'YEAR_NOT_COMPLETED');
  const already = await Certificate.find({ enrolmentId: { $in: ids }, status: 'issued' }).select('serial').lean();
  if (already.length > 0) throw AppError.conflict(`Already issued: ${(already as any[]).map((c) => c.serial).join(', ')}`, 'ALREADY_ISSUED');

  const studentIds = enrols.map((e) => e.studentId);
  const [students, classes, sections, sessions, parents, results] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('name nameBn gender studentId').lean(),
    ClassModel.find({ _id: { $in: enrols.map((e) => e.classId) } }).select('name nameBn').lean(),
    Section.find({ _id: { $in: enrols.map((e) => e.sectionId) } }).select('name isDefault').lean(),
    AcademicSession.find({ _id: { $in: enrols.map((e) => e.sessionId) } }).select('name').lean(),
    parentsOf(studentIds),
    publishedResults(input.examId, studentIds),
  ]);
  const by = <T extends { _id: unknown }>(rows: T[]) => new Map(rows.map((r) => [String(r._id), r as any]));
  const stu = by(students as any[]);
  const cls = by(classes as any[]);
  const sec = by(sections as any[]);
  const ses = by(sessions as any[]);
  const enrol = new Map(enrols.map((e) => [String(e._id), e]));

  const year = Number(input.issueDate.slice(0, 4));
  const created: any[] = [];
  for (const item of input.items) {
    const e = enrol.get(item.enrolmentId);
    const s = stu.get(String(e.studentId)) ?? {};
    const c = cls.get(String(e.classId)) ?? {};
    const sc = sec.get(String(e.sectionId));
    const r = results.byStudent.get(String(e.studentId));
    const serial = `CRT-${year}-${String(await nextSeq(`certificate-${year}`)).padStart(4, '0')}`;
    const doc = await Certificate.create({
      serial,
      year,
      studentId: e.studentId,
      enrolmentId: e._id,
      studentCode: s.studentId,
      name: s.name,
      nameBn: s.nameBn,
      gender: s.gender,
      fatherName: parents.get(String(e.studentId))?.father,
      motherName: parents.get(String(e.studentId))?.mother,
      className: c.name,
      classNameBn: c.nameBn,
      sectionName: sc && !sc.isDefault ? sc.name : '',
      sessionName: ses.get(String(e.sessionId))?.name,
      roll: e.roll,
      examName: results.exam?.name ?? '',
      gpa: item.gpa ?? fmtGpa(r?.gpa),
      letter: item.letter ?? r?.letter ?? '',
      issueDate: input.issueDate,
    });
    created.push(doc.toObject());
  }
  await writeAudit({ action: 'certificate.issue', entityType: 'Certificate', entityId: requireTenantId(), after: { count: created.length, serials: created.map((x) => x.serial), issueDate: input.issueDate } });
  return created;
};

export const list = async (q: { page: number; limit: number; search?: string; year?: number; status?: string }) => {
  const filter: Record<string, unknown> = {};
  if (q.year) filter.year = q.year;
  if (q.status) filter.status = q.status;
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: re }, { nameBn: re }, { serial: re }, { studentCode: re }];
  }
  const [rows, total] = await Promise.all([
    Certificate.find(filter).sort({ createdAt: -1 }).skip(toSkip(q)).limit(q.limit).lean(),
    Certificate.countDocuments(filter),
  ]);
  return { rows, meta: buildMeta(q, total) };
};

export const update = async (id: string, patch: Record<string, unknown>) => {
  const before: any = await Certificate.findById(id).lean();
  if (!before) throw AppError.notFound('Certificate not found');
  if (patch.status === 'issued' && before.status === 'cancelled') {
    const clash = await Certificate.exists({ enrolmentId: before.enrolmentId, status: 'issued', _id: { $ne: before._id } });
    if (clash) throw AppError.conflict('Another certificate is already issued for this year', 'ALREADY_ISSUED');
  }
  const after = await Certificate.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  await writeAudit({ action: patch.status === 'cancelled' ? 'certificate.cancel' : 'certificate.update', entityType: 'Certificate', entityId: before._id, before, after });
  return after;
};

// ---------------------------------------------------------------- PDF (A4 landscape)

const SAMPLE: any = {
  serial: 'CRT-2026-0001',
  name: 'Sample Student',
  nameBn: 'নমুনা শিক্ষার্থী',
  gender: 'male',
  studentCode: '26-0001',
  fatherName: 'Abdul Karim',
  motherName: 'Rahima Begum',
  className: 'Class Eight',
  classNameBn: 'অষ্টম',
  sectionName: 'A',
  sessionName: '2026',
  roll: 7,
  examName: '',
  gpa: '5.00',
  letter: 'A+',
  issueDate: '2026-12-31',
};

const W = 841.89;
const H = 595.28;
const GOLD = '#b08d3c';

/** Mixes a hex colour with white; t = 0 keeps it, t = 1 is white. */
const tint = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
};

/** A small L-shaped corner flourish. sx and sy are +1 or -1 to point the corner inward. */
const corner = (doc: PDFKit.PDFDocument, x: number, y: number, sx: number, sy: number, color: string, len = 34) => {
  doc.moveTo(x, y + sy * len).lineTo(x, y).lineTo(x + sx * len, y).lineWidth(2.2).stroke(color);
  doc.moveTo(x + sx * 6, y + sy * (len - 10)).lineTo(x + sx * 6, y + sy * 6).lineTo(x + sx * (len - 10), y + sy * 6).lineWidth(0.8).stroke(color);
  doc.circle(x + sx * 12, y + sy * 12, 2.2).fill(color);
};

type Box = { left: number; right: number; top: number; bottom: number; center: number };

/** Draws the background and frame of a layout and returns the content box. */
const drawFrame = (doc: PDFKit.PDFDocument, layout: CertificateLayout, main: string): Box => {
  if (layout === 'royal') {
    doc.rect(0, 0, W, H).fill('#fdfaf2');
    doc.rect(16, 16, W - 32, H - 32).lineWidth(10).stroke(main);
    doc.rect(30, 30, W - 60, H - 60).lineWidth(1.4).stroke(GOLD);
    doc.rect(35, 35, W - 70, H - 70).lineWidth(0.5).stroke(GOLD);
    for (const [x, y, sx, sy] of [[44, 44, 1, 1], [W - 44, 44, -1, 1], [44, H - 44, 1, -1], [W - 44, H - 44, -1, -1]] as const) corner(doc, x, y, sx, sy, GOLD);
    return { left: 80, right: W - 80, top: 52, bottom: H - 52, center: W / 2 };
  }
  if (layout === 'classic') {
    doc.rect(22, 22, W - 44, H - 44).lineWidth(2.5).stroke(main);
    doc.rect(29, 29, W - 58, H - 58).lineWidth(0.7).stroke(main);
    for (const [x, y, sx, sy] of [[38, 38, 1, 1], [W - 38, 38, -1, 1], [38, H - 38, 1, -1], [W - 38, H - 38, -1, -1]] as const) corner(doc, x, y, sx, sy, main, 28);
    return { left: 76, right: W - 76, top: 48, bottom: H - 48, center: W / 2 };
  }
  if (layout === 'modern') {
    doc.rect(0, 0, 200, H).fill(main);
    doc.rect(200, 0, 6, H).fill(tint(main, 0.55));
    doc.rect(206, 0, W - 206, H).fill('#ffffff');
    doc.rect(206, H - 10, W - 206, 10).fill(tint(main, 0.85));
    return { left: 246, right: W - 48, top: 44, bottom: H - 40, center: (246 + W - 48) / 2 };
  }
  doc.rect(24, 24, W - 48, H - 48).lineWidth(0.8).stroke('#222222');
  return { left: 70, right: W - 70, top: 50, bottom: H - 50, center: W / 2 };
};

/** A round seal with a star, printed near the signatures on the decorative layouts. */
const seal = (doc: PDFKit.PDFDocument, cx: number, cy: number, color: string, label: string) => {
  doc.circle(cx, cy, 34).fill(color);
  doc.circle(cx, cy, 29).lineWidth(0.8).stroke('#ffffff');
  doc.circle(cx, cy, 25).lineWidth(0.4).stroke('#ffffff');
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 11 : 4.6;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy - 6 + r * Math.sin(a)]);
  }
  doc.polygon(...(pts as [number, number][])).fill('#ffffff');
  doc.fillColor('#ffffff').font('bold').fontSize(7.5).text(label, cx - 28, cy + 9, { width: 56, align: 'center', lineBreak: false });
};

export const renderPdf = async (records: any[], q: { layout?: CertificateLayout; locale?: Locale }) => {
  const [cfg, tenant] = await Promise.all([getConfig(), Tenant.findById(requireTenantId()).select('name nameBn slug logoUrl eiin contact.address').lean()]);
  const ten: any = tenant ?? {};
  const locale = q.locale ?? cfg.language;
  const layout = q.layout ?? cfg.layout;
  const main = layout === 'minimal' ? '#111111' : cfg.themeColor;
  const t = TITLE[locale];
  const school = (locale === 'bn' && ten.nameBn) || ten.name || '';
  const [crest, signature] = await Promise.all([
    cfg.show.crest ? loadPng(ten.logoUrl, 220) : Promise.resolve(null),
    cfg.show.sigRight ? loadPng(cfg.signatureUrl, 300) : Promise.resolve(null),
  ]);
  const photos = await Promise.all(
    records.map(async (r) => (cfg.show.photo && r.studentId ? loadPhoto(((await Student.findById(r.studentId).select('photoUrl').lean()) as any)?.photoUrl) : null)),
  );
  const doc = createPdf({ margin: 0, layout: 'landscape' });
  const img = (buf: Buffer | null | undefined, x: number, y: number, opts: PDFKit.Mixins.ImageOption) => {
    if (!buf) return;
    try {
      doc.image(buf, x, y, opts);
    } catch {
      /* an unreadable image leaves the space */
    }
  };

  records.forEach((r, i) => {
    if (i > 0) doc.addPage();
    const b = drawFrame(doc, layout, main);
    const width = b.right - b.left;
    const onDark = layout === 'modern';

    // Header: crest, school, address and EIIN
    let y = b.top + 4;
    if (onDark) {
      // School identity sits in the coloured band on the modern layout.
      if (crest) {
        doc.circle(100, 112, 46).fill('#ffffff');
        img(crest, 66, 78, { fit: [68, 68], align: 'center', valign: 'center' });
      }
      doc.fillColor('#ffffff').font('bold').fontSize(15).text(school, 22, crest ? 176 : 90, { width: 156, align: 'center' });
      const sub = [ten.contact?.address, ten.eiin ? `EIIN ${ten.eiin}` : ''].filter(Boolean).join('\n');
      if (sub) doc.font('regular').fontSize(8.5).fillColor(tint(main, 0.7)).text(sub, 22, doc.y + 6, { width: 156, align: 'center' });
      if (cfg.show.qr) {
        doc.rect(52, H - 150, 96, 96).fill('#ffffff');
        drawQr(doc, `${r.serial} | ${school} | ${ten.slug ?? ''}`, 58, H - 144, 84, '#111111');
        doc.fillColor('#ffffff').font('regular').fontSize(8).text(`${t.verify}: ${r.serial}`, 22, H - 48, { width: 156, align: 'center', lineBreak: false });
      }
    } else {
      if (crest) {
        img(crest, b.center - 28, y, { fit: [56, 56], align: 'center' });
        y += 62;
      }
      doc.fillColor('#111111').font('bold').fontSize(19).text(school, b.left, y, { width, align: 'center' });
      y = doc.y + 1;
      const sub = [ten.contact?.address, ten.eiin ? `EIIN: ${ten.eiin}` : ''].filter(Boolean).join('  |  ');
      if (sub) {
        doc.font('regular').fontSize(9).fillColor('#555555').text(sub, b.left, y, { width, align: 'center', height: 12, ellipsis: true });
        y = doc.y;
      }
    }

    // Title
    const titleTop = onDark ? b.top + 26 : y + 14;
    const align = onDark ? 'left' : 'center';
    doc.fillColor(main).font('bold').fontSize(onDark ? 34 : 30).text(cfg.title || t.title, b.left, titleTop, { width, align });
    let ty = doc.y + 2;
    if (onDark) {
      doc.rect(b.left, ty + 2, 64, 3).fill(tint(main, 0.4));
      ty += 12;
    } else {
      const ornament = layout === 'minimal' ? '#111111' : layout === 'royal' ? GOLD : main;
      doc.moveTo(b.center - 110, ty + 4).lineTo(b.center - 12, ty + 4).lineWidth(0.8).stroke(ornament);
      doc.moveTo(b.center + 12, ty + 4).lineTo(b.center + 110, ty + 4).lineWidth(0.8).stroke(ornament);
      doc.circle(b.center, ty + 4, 3).fill(ornament);
      ty += 12;
    }
    doc.fillColor('#444444').font('regular').fontSize(12).text(cfg.subTitle || t.sub, b.left, ty, { width, align });
    ty = doc.y + 6;

    // Serial and date line
    doc.font('regular').fontSize(10).fillColor('#333333');
    if (cfg.show.serial) doc.text(`${t.no}: ${r.serial}`, b.left, ty, { width: 260, lineBreak: false });
    doc.text(`${t.date}: ${locale === 'bn' ? bnDigits(r.issueDate) : r.issueDate}`, b.right - 220, ty, { width: 220, align: 'right', lineBreak: false });

    // Student name, large, then the body, centred in the space above the signatures
    const lineY = b.bottom - 34;
    const name = (locale === 'bn' && r.nameBn) || r.name;
    const photoW = photos[i] ? 78 : 0;
    const textW = b.right - (photoW ? photoW + 18 : 0) - b.left;
    const body = renderBody(r, cfg, locale, school);
    const bodyOpts = { width: textW, align: onDark ? ('left' as const) : ('center' as const), lineGap: 7 };
    const nameH = doc.font('bold').fontSize(26).heightOfString(name, { width: textW });
    const bodyH = doc.font('regular').fontSize(13).heightOfString(body, bodyOpts);
    const blockH = nameH + 10 + bodyH;
    const spaceTop = ty + 20;
    const spaceBottom = lineY - 70;
    const blockTop = Math.max(spaceTop, spaceTop + (spaceBottom - spaceTop - blockH) / 2);
    if (photos[i]) {
      img(photos[i], b.right - photoW, blockTop, { fit: [photoW, 96] });
      doc.rect(b.right - photoW, blockTop, photoW, 96).lineWidth(0.6).stroke('#bbbbbb');
    }
    doc.fillColor(layout === 'minimal' ? '#111111' : main).font('bold').fontSize(26).text(name, b.left, blockTop, { width: textW, align });
    doc.fillColor('#1f1f1f').font('regular').fontSize(13).text(body, b.left, doc.y + 10, bodyOpts);

    // Signatures, seal and QR along the bottom
    const sig = (x: number, label: string, image?: Buffer | null) => {
      img(image, x + 25, lineY - 40, { fit: [110, 36] });
      doc.moveTo(x, lineY).lineTo(x + 160, lineY).lineWidth(0.7).stroke('#555555');
      doc.fillColor('#111111').font('regular').fontSize(10).text(label, x, lineY + 5, { width: 160, align: 'center', lineBreak: false });
    };
    if (cfg.show.sigLeft) sig(b.left + 8, cfg.sigLeftLabel);
    if (cfg.show.sigRight) sig(b.right - 168, cfg.sigRightLabel, signature);
    if (layout === 'royal' || layout === 'classic') seal(doc, b.center, lineY - 14, layout === 'royal' ? GOLD : main, locale === 'bn' ? 'সনদ' : 'CERTIFIED');
    if (cfg.show.qr && !onDark) {
      const qx = layout === 'minimal' ? b.center - 26 : b.center + 52;
      drawQr(doc, `${r.serial} | ${school} | ${ten.slug ?? ''}`, qx, lineY - 46, 52, '#111111');
    }
  });
  return pdfToBuffer(doc);
};

export const printRecords = async (ids: string[], q: { layout?: CertificateLayout; locale?: Locale }) => {
  const rows: any[] = await Certificate.find({ _id: { $in: ids } }).lean();
  if (rows.length === 0) throw AppError.notFound('Certificate not found');
  if (rows.some((r) => r.status === 'cancelled')) throw AppError.badRequest('A cancelled certificate cannot be printed', undefined, 'CANCELLED');
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  const pdf = await renderPdf(rows, q);
  await writeAudit({ action: 'certificate.print', entityType: 'Certificate', entityId: requireTenantId(), after: { count: rows.length, serials: rows.map((r) => r.serial) } });
  return { pdf, count: rows.length };
};

export const printSample = async (q: { layout?: CertificateLayout; locale?: Locale }) => ({ pdf: await renderPdf([SAMPLE], q), count: 1 });
