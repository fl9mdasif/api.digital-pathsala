import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { fillTemplate } from '../../lib/fillTemplate';
import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { buildMeta, escapeRegex, toSkip } from '../../lib/pagination';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { nextSeq } from '../counter/counter.model';
import { collect, loadPhoto, loadPng } from '../idCard/idCard.service';
import { Student } from '../student/student.model';
import { Tenant } from '../tenant/tenant.model';
import {
  DEFAULT_TESTIMONIAL_CONFIG,
  Testimonial,
  TestimonialConfig,
  normalizeTestimonialConfig,
  type TestimonialConfigData,
  type TestimonialLayout,
} from './testimonial.model';

type Locale = 'bn' | 'en';

export const getConfig = async (): Promise<TestimonialConfigData> => normalizeTestimonialConfig(await TestimonialConfig.findOne().lean());

export const saveConfig = async (input: TestimonialConfigData) => {
  const before = await getConfig();
  await TestimonialConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'testimonial.config', entityType: 'TestimonialConfig', entityId: requireTenantId(), before, after: input });
  return getConfig();
};

export const DEFAULT_BODY: Record<Locale, string> = {
  en: 'This is to certify that {name}, {son_daughter} of {father_name} and {mother_name}, of village {village}, post office {post_office}, upazila {upazila}, district {district}, was a student of this institution in {class_name}, Roll {roll}. {he_she} passed the {exam} examination in {passing_year} with GPA {gpa} (Board Roll {board_roll}, Registration {board_reg}). To the best of my knowledge, {his_her} character and conduct are {conduct}. I wish {him_her} every success in life.',
  bn: 'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {name}, পিতা: {father_name}, মাতা: {mother_name}, গ্রাম: {village}, ডাকঘর: {post_office}, উপজেলা: {upazila}, জেলা: {district}, এই প্রতিষ্ঠানের {class_name} শ্রেণির শিক্ষার্থী ছিল (রোল: {roll})। {passing_year} সালে {exam} পরীক্ষায় জিপিএ {gpa} পেয়ে উত্তীর্ণ হয়েছে (বোর্ড রোল: {board_roll}, রেজিস্ট্রেশন: {board_reg})। আমার জানামতে তার আচরণ ও চরিত্র {conduct}। আমি তার সর্বাঙ্গীণ সাফল্য কামনা করি।',
};
const TITLE: Record<Locale, { header: string; no: string; date: string }> = {
  en: { header: 'Testimonial', no: 'No', date: 'Date' },
  bn: { header: 'প্রশংসাপত্র', no: 'নং', date: 'তারিখ' },
};

/** The pronoun words for a body template, by the student's gender and the certificate's language. */
const words = (gender: string | undefined, locale: Locale) => {
  if (locale === 'bn') return { he_she: 'সে', his_her: 'তার', him_her: 'তাকে', son_daughter: 'সন্তান' };
  if (gender === 'male') return { he_she: 'He', his_her: 'his', him_her: 'him', son_daughter: 'son' };
  if (gender === 'female') return { he_she: 'She', his_her: 'her', him_her: 'her', son_daughter: 'daughter' };
  return { he_she: 'They', his_her: 'their', him_her: 'them', son_daughter: 'child' };
};

export const renderBody = (r: any, cfg: TestimonialConfigData, locale: Locale): string =>
  fillTemplate(cfg.bodyTemplate || DEFAULT_BODY[locale], {
    name: (locale === 'bn' && r.nameBn) || r.name,
    father_name: r.fatherName,
    mother_name: r.motherName,
    student_id: r.studentCode,
    class_name: r.className,
    section_name: r.sectionName,
    roll: r.roll,
    session: r.sessionName,
    exam: r.exam,
    passing_year: r.passingYear,
    gpa: r.gpa,
    board_roll: r.boardRoll,
    board_reg: r.boardReg,
    conduct: r.conduct,
    village: r.village,
    post_office: r.postOffice,
    upazila: r.upazila,
    district: r.district,
    issue_date: r.issueDate,
    serial: r.serial,
    ...words(r.gender, locale),
  });

// ---------------------------------------------------------------- generate

/** The students of a section, with how many testimonials each already has. */
export const candidates = async (sectionId: string) => {
  const cards = await collect({ sectionId }, 'en');
  const counts = await Testimonial.aggregate([
    { $match: { studentId: { $in: cards.map((c) => c.studentObjectId).map((id) => new Types.ObjectId(id)) }, status: 'issued' } },
    { $group: { _id: '$studentId', n: { $sum: 1 } } },
  ]);
  const issued = new Map<string, number>(counts.map((c: any) => [String(c._id), c.n]));
  return cards.map((c) => ({
    studentId: c.studentObjectId,
    studentCode: c.studentId,
    name: c.name,
    roll: c.roll,
    className: c.className,
    sectionName: c.sectionName ?? null,
    fatherName: c.fatherName ?? null,
    issuedCount: issued.get(c.studentObjectId) ?? 0,
  }));
};

type Detail = { exam: string; passingYear: string; gpa: string; boardRoll: string; boardReg: string; conduct: string; village: string; postOffice: string; upazila: string; district: string };

/** Issues one numbered testimonial per student: TST-YYYY-NNNN, numbered per year. */
export const issue = async (input: { issueDate: string; items: ({ studentId: string } & Detail)[] }) => {
  const ids = [...new Set(input.items.map((i) => i.studentId))];
  if (ids.length !== input.items.length) throw AppError.badRequest('A student appears twice in this batch', undefined, 'DUPLICATE_STUDENT');
  const [cards, students] = await Promise.all([collect({ studentIds: ids }, 'en'), Student.find({ _id: { $in: ids } }).select('name nameBn gender').lean()]);
  const card = new Map(cards.map((c) => [c.studentObjectId, c]));
  const stu = new Map(students.map((s: any) => [String(s._id), s]));
  if (ids.some((id) => !card.has(id))) throw AppError.badRequest('Some students are not active in the current session', undefined, 'STUDENT_NOT_FOUND');

  const year = Number(input.issueDate.slice(0, 4));
  const created: any[] = [];
  for (const item of input.items) {
    const c = card.get(item.studentId)!;
    const s: any = stu.get(item.studentId);
    const serial = `TST-${year}-${String(await nextSeq(`testimonial-${year}`)).padStart(4, '0')}`;
    const { studentId, ...detail } = item;
    const doc = await Testimonial.create({
      serial,
      year,
      studentId,
      studentCode: c.studentId,
      name: s?.name ?? c.name,
      nameBn: s?.nameBn,
      gender: s?.gender,
      fatherName: c.fatherName,
      motherName: c.motherName,
      className: c.className,
      sectionName: c.sectionName,
      sessionName: c.sessionName,
      roll: c.roll,
      issueDate: input.issueDate,
      ...detail,
    });
    created.push(doc.toObject());
  }
  await writeAudit({ action: 'testimonial.issue', entityType: 'Testimonial', entityId: requireTenantId(), after: { count: created.length, serials: created.map((d) => d.serial), issueDate: input.issueDate } });
  return created;
};

// ---------------------------------------------------------------- history

export const list = async (q: { page: number; limit: number; search?: string; year?: number; exam?: string; status?: string }) => {
  const filter: Record<string, unknown> = {};
  if (q.year) filter.year = q.year;
  if (q.status) filter.status = q.status;
  if (q.exam) filter.exam = new RegExp(escapeRegex(q.exam), 'i');
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: re }, { serial: re }, { studentCode: re }];
  }
  const [rows, total] = await Promise.all([
    Testimonial.find(filter).sort({ createdAt: -1 }).skip(toSkip(q)).limit(q.limit).lean(),
    Testimonial.countDocuments(filter),
  ]);
  return { rows, meta: buildMeta(q, total) };
};

export const update = async (id: string, patch: Record<string, unknown>) => {
  const before: any = await Testimonial.findById(id).lean();
  if (!before) throw AppError.notFound('Testimonial not found');
  const after = await Testimonial.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  await writeAudit({ action: patch.status === 'cancelled' ? 'testimonial.cancel' : 'testimonial.update', entityType: 'Testimonial', entityId: before._id, before, after });
  return after;
};

// ---------------------------------------------------------------- PDF

const SAMPLE: any = {
  serial: 'TST-2026-0001',
  name: 'Sample Student',
  nameBn: 'নমুনা শিক্ষার্থী',
  gender: 'male',
  studentCode: '26-0001',
  fatherName: 'Sample Father',
  motherName: 'Sample Mother',
  className: 'Class Ten',
  sectionName: 'A',
  sessionName: '2026',
  roll: 12,
  exam: 'SSC',
  passingYear: '2026',
  gpa: '5.00',
  boardRoll: '123456',
  boardReg: '1234567890',
  conduct: 'good',
  village: 'Rampur',
  postOffice: 'Rampur',
  upazila: 'Sadar',
  district: 'Chuadanga',
  issueDate: '2026-12-31',
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 34;

const drawFrame = (doc: PDFKit.PDFDocument, layout: TestimonialLayout, main: string) => {
  const w = PAGE_W - 2 * M;
  const h = PAGE_H - 2 * M;
  if (layout === 'classic') {
    doc.rect(M, M, w, h).lineWidth(2).stroke(main);
    doc.rect(M + 6, M + 6, w - 12, h - 12).lineWidth(0.6).stroke(main);
  } else if (layout === 'modern') {
    doc.rect(M, M, w, h).lineWidth(0.6).stroke('#999999');
    doc.rect(M, M, 20, h).fill(main);
    doc.rect(M + 20, M, w - 20, 6).fill(main);
  } else if (layout === 'ornate') {
    doc.rect(M, M, w, h).lineWidth(5).stroke(main);
    doc.rect(M + 10, M + 10, w - 20, h - 20).lineWidth(1).stroke(main);
    for (const [cx, cy] of [[M + 10, M + 10], [M + w - 10, M + 10], [M + 10, M + h - 10], [M + w - 10, M + h - 10]]) doc.rect(cx - 7, cy - 7, 14, 14).fill(main);
  } else {
    doc.rect(M, M, w, h).lineWidth(0.6).stroke('#888888');
  }
};

export const renderPdf = async (records: any[], q: { layout?: TestimonialLayout; locale?: Locale }) => {
  const [cfg, tenant] = await Promise.all([getConfig(), Tenant.findById(requireTenantId()).select('name nameBn logoUrl contact.address').lean()]);
  const locale = q.locale ?? cfg.language;
  const layout = q.layout ?? cfg.layout;
  const main = layout === 'minimal' ? '#111111' : cfg.themeColor;
  const t = TITLE[locale];
  const school = (locale === 'bn' && (tenant as any)?.nameBn) || (tenant as any)?.name || '';
  const [crest, signature] = await Promise.all([cfg.show.crest ? loadPng((tenant as any)?.logoUrl, 200) : Promise.resolve(null), cfg.show.sigRight ? loadPng(cfg.signatureUrl, 300) : Promise.resolve(null)]);
  const photos = await Promise.all(records.map(async (r) => (cfg.show.photo && r.studentId ? loadPhoto(((await Student.findById(r.studentId).select('photoUrl').lean()) as any)?.photoUrl) : null)));

  const doc = createPdf({ margin: 0 });
  records.forEach((r, i) => {
    if (i > 0) doc.addPage();
    drawFrame(doc, layout, main);
    const inset = layout === 'modern' ? 44 : 30;
    const left = M + inset;
    const right = PAGE_W - M - 30;
    const mid = (left + right) / 2;

    if (crest) {
      try {
        doc.image(crest, mid - 28, 62, { fit: [56, 56], align: 'center' });
      } catch {
        /* an unreadable crest leaves the space */
      }
    }
    if (photos[i]) {
      try {
        doc.image(photos[i]!, right - 70, 62, { fit: [70, 86] });
        doc.rect(right - 70, 62, 70, 86).lineWidth(0.5).stroke('#bbbbbb');
      } catch {
        /* an unreadable photo leaves the space */
      }
    }
    doc.fillColor('#111111').font('bold').fontSize(20).text(school, left, 126, { width: right - left, align: 'center' });
    const address = (tenant as any)?.contact?.address;
    if (address) doc.font('regular').fontSize(9.5).fillColor('#555555').text(address, left, 150, { width: right - left, align: 'center', height: 12, ellipsis: true });
    doc.fillColor(main).font('bold').fontSize(26).text(cfg.headerTitle || t.header, left, 186, { width: right - left, align: 'center' });
    if (layout === 'classic') doc.moveTo(mid - 70, 220).lineTo(mid + 70, 220).lineWidth(1).stroke(main);
    if (cfg.subTitle) doc.fillColor('#333333').font('regular').fontSize(12).text(cfg.subTitle, left, 228, { width: right - left, align: 'center' });

    doc.fillColor('#111111').font('regular').fontSize(11);
    if (cfg.show.serial) doc.text(`${t.no}: ${r.serial}`, left, 266, { width: 200, lineBreak: false });
    if (cfg.show.issueDate) doc.text(`${t.date}: ${r.issueDate}`, right - 200, 266, { width: 200, align: 'right', lineBreak: false });

    doc.fillColor('#111111').font('regular').fontSize(13).text(renderBody(r, cfg, locale), left, 310, { width: right - left, lineGap: 8, align: 'left' });

    const lineY = PAGE_H - 130;
    const sig = (x: number, label: string, image?: Buffer | null) => {
      if (image) {
        try {
          doc.image(image, x + 20, lineY - 40, { fit: [110, 36] });
        } catch {
          /* an unreadable signature leaves the line */
        }
      }
      doc.moveTo(x, lineY).lineTo(x + 150, lineY).lineWidth(0.6).stroke('#555555');
      doc.fillColor('#111111').font('regular').fontSize(10).text(label, x, lineY + 5, { width: 150, align: 'center', lineBreak: false });
    };
    if (cfg.show.sigLeft) sig(left, cfg.sigLeftLabel);
    if (cfg.show.sigRight) sig(right - 150, cfg.sigRightLabel, signature);
  });
  return pdfToBuffer(doc);
};

export const printRecords = async (ids: string[], q: { layout?: TestimonialLayout; locale?: Locale }) => {
  const rows: any[] = await Testimonial.find({ _id: { $in: ids } }).lean();
  if (rows.length === 0) throw AppError.notFound('Testimonial not found');
  if (rows.some((r) => r.status === 'cancelled')) throw AppError.badRequest('A cancelled testimonial cannot be printed', undefined, 'CANCELLED');
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  const pdf = await renderPdf(rows, q);
  await writeAudit({ action: 'testimonial.print', entityType: 'Testimonial', entityId: requireTenantId(), after: { count: rows.length, serials: rows.map((r) => r.serial) } });
  return { pdf, count: rows.length };
};

export const printSample = async (q: { layout?: TestimonialLayout; locale?: Locale }) => ({ pdf: await renderPdf([SAMPLE], q), count: 1 });

export { DEFAULT_TESTIMONIAL_CONFIG };
