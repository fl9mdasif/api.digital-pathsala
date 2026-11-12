import { AppError } from '../../errors/AppError';
import { env } from '../../config/env';
import { fillTemplate } from '../../lib/fillTemplate';
import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { drawQr } from '../../lib/qr';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { ClassModel } from '../class/class.model';
import { Enrolment } from '../enrolment/enrolment.model';
import { currentSession } from '../enrolment/enrolment.service';
import { Guardian } from '../guardian/guardian.model';
import { Section } from '../section/section.model';
import { Student } from '../student/student.model';
import { Tenant } from '../tenant/tenant.model';
import { IdCardConfig, normalizeIdCardConfig, type IdCardConfigData, type IdCardDesign } from './idCard.model';
import { MAX_CARDS } from './idCard.validation';

type Locale = 'bn' | 'en';

const L = {
  en: { title: 'Student ID Card', id: 'ID', cls: 'Class', section: 'Section', group: 'Group', roll: 'Roll', session: 'Session', mobile: 'Mobile', blood: 'Blood', father: 'Father', mother: 'Mother', dob: 'DOB', valid: 'Valid until', issued: 'Issued', rules: 'If found, please return to the school.' },
  bn: { title: 'শিক্ষার্থী পরিচয়পত্র', id: 'আইডি', cls: 'শ্রেণি', section: 'শাখা', group: 'বিভাগ', roll: 'রোল', session: 'সেশন', mobile: 'মোবাইল', blood: 'রক্ত', father: 'পিতা', mother: 'মাতা', dob: 'জন্ম', valid: 'মেয়াদ', issued: 'ইস্যু', rules: 'কার্ডটি পেলে অনুগ্রহ করে বিদ্যালয়ে জমা দিন।' },
} as const;
const GROUP_NAME: Record<string, { en: string; bn: string }> = {
  science: { en: 'Science', bn: 'বিজ্ঞান' },
  commerce: { en: 'Commerce', bn: 'ব্যবসায় শিক্ষা' },
  arts: { en: 'Arts', bn: 'মানবিক' },
};

export const getConfig = async (): Promise<IdCardConfigData> => normalizeIdCardConfig(await IdCardConfig.findOne().lean());

export const saveConfig = async (input: IdCardConfigData) => {
  const before = await getConfig();
  await IdCardConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'idCard.config', entityType: 'IdCardConfig', entityId: requireTenantId(), before, after: input });
  return getConfig();
};

export interface CardData {
  studentObjectId: string;
  classId: string;
  sectionId?: string;
  name: string;
  studentId: string;
  className: string;
  sectionName?: string;
  groupName?: string;
  sessionName?: string;
  roll: number;
  dob: string;
  bloodGroup?: string;
  fatherName?: string;
  motherName?: string;
  /** First guardian's phone. */
  mobile?: string;
  guardianPhone?: string;
  photoUrl?: string;
}

export const SAMPLE_CARD: CardData = {
  studentObjectId: 'sample',
  classId: 'sample',
  name: 'Sample Student',
  studentId: '26-0001',
  className: 'Class Six',
  sectionName: 'A',
  groupName: 'Science',
  sessionName: '2026',
  roll: 12,
  dob: '2012-05-14',
  bloodGroup: 'O+',
  fatherName: 'Sample Father',
  motherName: 'Sample Mother',
  mobile: '01700000000',
  guardianPhone: '01700000000',
};

/** Cards for one section, or for a list of students, in class then roll order. */
export const collect = async (
  q: { sectionId?: string; studentIds?: string[]; group?: string },
  locale: Locale,
): Promise<CardData[]> => {
  const session = await currentSession();
  const filter: Record<string, unknown> = { sessionId: session._id, status: 'active' };
  if (q.sectionId) filter.sectionId = q.sectionId;
  else filter.studentId = { $in: q.studentIds };
  if (q.group) filter.group = q.group;
  const enrolments: any[] = await Enrolment.find(filter).sort({ classId: 1, sectionId: 1, roll: 1 }).limit(MAX_CARDS).lean();
  if (enrolments.length === 0) throw AppError.notFound('No students found for the ID cards', 'NO_STUDENTS');

  const [students, classes, sections] = await Promise.all([
    Student.find({ _id: { $in: enrolments.map((e) => e.studentId) }, status: 'active' })
      .select('name nameBn studentId dob photoUrl bloodGroup guardianIds')
      .lean(),
    ClassModel.find({ _id: { $in: enrolments.map((e) => e.classId) } }).select('name nameBn').lean(),
    Section.find({ _id: { $in: enrolments.map((e) => e.sectionId).filter(Boolean) } }).select('name isDefault').lean(),
  ]);
  const guardians: any[] = await Guardian.find({ _id: { $in: students.flatMap((s: any) => s.guardianIds ?? []) } })
    .select('phone name relation')
    .lean();

  const byStudent = new Map(students.map((s: any) => [String(s._id), s]));
  const byClass = new Map(classes.map((c: any) => [String(c._id), c]));
  const bySection = new Map(sections.map((s: any) => [String(s._id), s]));
  const byGuardian = new Map(guardians.map((g) => [String(g._id), g]));

  return enrolments
    .filter((e) => byStudent.has(String(e.studentId)))
    .map((e) => {
      const s: any = byStudent.get(String(e.studentId));
      const c: any = byClass.get(String(e.classId));
      const sec: any = e.sectionId ? bySection.get(String(e.sectionId)) : undefined;
      const gs = (s.guardianIds ?? []).map((g: any) => byGuardian.get(String(g))).filter(Boolean);
      const mobile = gs.find((g: any) => g.phone)?.phone;
      return {
        studentObjectId: String(s._id),
        classId: String(e.classId),
        sectionId: e.sectionId ? String(e.sectionId) : undefined,
        name: locale === 'bn' && s.nameBn ? s.nameBn : s.name,
        studentId: s.studentId,
        className: (locale === 'bn' ? c?.nameBn : undefined) ?? c?.name ?? '-',
        sectionName: sec && !sec.isDefault ? sec.name : undefined,
        groupName: e.group ? GROUP_NAME[e.group]?.[locale] : undefined,
        sessionName: session.name,
        roll: e.roll,
        dob: s.dob,
        bloodGroup: s.bloodGroup,
        fatherName: gs.find((g: any) => g.relation === 'father')?.name,
        motherName: gs.find((g: any) => g.relation === 'mother')?.name,
        mobile,
        guardianPhone: mobile,
        photoUrl: s.photoUrl,
      };
    });
};

/** Images come from Cloudinary only, resized and converted there. Anything else shows an empty frame. */
const fetchImage = async (url: string | undefined, transform: string): Promise<Buffer | null> => {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  if (!url || !cloud || !url.startsWith(`https://res.cloudinary.com/${cloud}/`) || !url.includes('/upload/')) return null;
  try {
    const res = await fetch(url.replace('/upload/', `/upload/${transform}/`), { signal: AbortSignal.timeout(4000), redirect: 'error' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= 2 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
};
export const loadPhoto = (url?: string) => fetchImage(url, 'f_jpg,w_240,h_300,c_fill,g_face');
export const loadPng = (url: string | undefined, width: number) => fetchImage(url, `f_png,w_${width}`);

export const CARD_W = 242.6; // CR80, 85.6 mm
export const CARD_H = 153; // 54 mm
const COLS = 2;
const ROWS = 4;
const GAP_X = 20;
const GAP_Y = 14;

/** The look shared by student and teacher cards; the sheet renderer needs nothing else from a config. */
export type VisualCfg = Omit<IdCardConfigData, 'show' | 'classDisplay' | 'sessionLabel' | 'qrMode' | 'qrData'> & {
  show: { watermark: boolean; signatureFront: boolean; signatureBack: boolean };
};

/** One card ready to draw: the lines under the name and the QR text are worked out by the caller. */
export interface SheetCard {
  name: string;
  lines: string[];
  qr: string;
  photoUrl?: string;
}

interface Ctx {
  doc: PDFKit.PDFDocument;
  cfg: VisualCfg;
  title: string;
  design: IdCardDesign;
  locale: Locale;
  schoolName: string;
  address: string;
  watermark: Buffer | null;
  signature: Buffer | null;
  validUntil: string;
}

const tone = (ctx: Ctx) =>
  ctx.design === 'mono'
    ? { main: '#000000', text: '#000000', name: '#000000', border: '#000000', soft: '#555555' }
    : { main: ctx.cfg.themeColor, text: ctx.cfg.textColor, name: ctx.cfg.nameColor, border: ctx.cfg.themeColor, soft: '#555555' };

const studentLines = (c: CardData, cfg: IdCardConfigData, locale: Locale): string[] => {
  const t = L[locale];
  const s = cfg.show;
  const out = [`${t.id}: ${c.studentId}`];
  if (s.class) out.push(`${t.cls}: ${c.className}${s.section && cfg.classDisplay === 'class_section' && c.sectionName ? ` - ${c.sectionName}` : ''}`);
  else if (s.section && c.sectionName) out.push(`${t.section}: ${c.sectionName}`);
  if (s.group && c.groupName) out.push(`${t.group}: ${c.groupName}`);
  const rollYear = [s.roll ? `${t.roll}: ${c.roll}` : '', s.year && c.sessionName ? `${cfg.sessionLabel || t.session}: ${c.sessionName}` : ''].filter(Boolean).join('   ');
  if (rollYear) out.push(rollYear);
  if (s.father && c.fatherName) out.push(`${t.father}: ${c.fatherName}`);
  if (s.mother && c.motherName) out.push(`${t.mother}: ${c.motherName}`);
  const dobBlood = [s.dob ? `${t.dob}: ${c.dob}` : '', s.bloodGroup && c.bloodGroup ? `${t.blood}: ${c.bloodGroup}` : ''].filter(Boolean).join('   ');
  if (dobBlood) out.push(dobBlood);
  if (s.mobile && c.mobile) out.push(`${t.mobile}: ${c.mobile}`);
  return out;
};

const frame = (doc: PDFKit.PDFDocument, shape: IdCardConfigData['photoShape'], x: number, y: number, w: number, h: number) => {
  if (shape === 'circle') return doc.circle(x + w / 2, y + w / 2, w / 2);
  if (shape === 'rounded') return doc.roundedRect(x, y, w, h, 8);
  return doc.rect(x, y, w, h);
};

const drawPhoto = (ctx: Ctx, photo: Buffer | null, x: number, y: number) => {
  const { doc, cfg } = ctx;
  const w = 54;
  const h = cfg.photoShape === 'circle' ? 54 : 66;
  if (photo) {
    try {
      doc.save();
      frame(doc, cfg.photoShape, x, y, w, h).clip();
      doc.image(photo, x, y, { cover: [w, h] });
      doc.restore();
    } catch {
      doc.restore();
    }
  }
  frame(doc, cfg.photoShape, x, y, w, h).lineWidth(0.6).stroke(tone(ctx).border);
};

const drawWatermark = (ctx: Ctx, x: number, y: number) => {
  if (!ctx.cfg.show.watermark || !ctx.watermark) return;
  try {
    ctx.doc.save().opacity(0.08).image(ctx.watermark, x + CARD_W / 2 - 45, y + CARD_H / 2 - 45, { fit: [90, 90] }).restore();
  } catch {
    ctx.doc.restore();
  }
};

const drawSignature = (ctx: Ctx, x: number, y: number) => {
  const { doc, cfg } = ctx;
  const c = tone(ctx);
  const lineY = y + CARD_H - 14;
  if (ctx.signature) {
    try {
      doc.image(ctx.signature, x + CARD_W - 78, lineY - 17, { fit: [64, 16] });
    } catch {
      /* an unreadable signature leaves the line */
    }
  }
  doc.moveTo(x + CARD_W - 84, lineY).lineTo(x + CARD_W - 10, lineY).lineWidth(0.5).stroke(c.soft);
  doc.fillColor(c.soft).font('regular').fontSize(6.5).text(cfg.signatureTitle, x + CARD_W - 84, lineY + 2, { width: 74, align: 'center', lineBreak: false });
};

const drawFront = (ctx: Ctx, c: SheetCard, photo: Buffer | null, x: number, y: number) => {
  const { doc, cfg, design } = ctx;
  const t = L[ctx.locale];
  const col = tone(ctx);

  doc.roundedRect(x, y, CARD_W, CARD_H, 6).lineWidth(design === 'classic' ? 1.4 : 0.6).stroke(design === 'classic' || design === 'mono' ? col.border : '#999999');
  if (design === 'classic') doc.roundedRect(x + 3, y + 3, CARD_W - 6, CARD_H - 6, 4).lineWidth(0.4).stroke(col.border);
  drawWatermark(ctx, x, y);

  // header
  if (design === 'modern') {
    doc.save().roundedRect(x, y, CARD_W, 38, 6).clip().rect(x, y, CARD_W, 38).fill(col.main).restore();
    doc.fillColor('#ffffff').font('bold').fontSize(cfg.fontSchool).text(ctx.schoolName, x + 6, y + 6, { width: CARD_W - 12, align: 'center', height: cfg.fontSchool + 3, ellipsis: true });
    doc.font('regular').fontSize(cfg.fontAddress).text(ctx.address || ctx.title, x + 6, y + 8 + cfg.fontSchool + 2, { width: CARD_W - 12, align: 'center', height: cfg.fontAddress + 2, ellipsis: true });
  } else {
    doc.fillColor(col.main).font('bold').fontSize(cfg.fontSchool).text(ctx.schoolName, x + 8, y + 9, { width: CARD_W - 16, align: 'center', height: cfg.fontSchool + 3, ellipsis: true });
    doc.fillColor(col.soft).font('regular').fontSize(cfg.fontAddress).text(ctx.address || ctx.title, x + 8, y + 11 + cfg.fontSchool + 2, { width: CARD_W - 16, align: 'center', height: cfg.fontAddress + 2, ellipsis: true });
    doc.moveTo(x + 10, y + 36).lineTo(x + CARD_W - 10, y + 36).lineWidth(design === 'mono' ? 1 : 0.6).stroke(col.border);
  }

  // photo and details
  const top = y + 44;
  const photoX = design === 'classic' ? x + CARD_W - 64 : x + 10;
  drawPhoto(ctx, photo, photoX, top);
  const textX = design === 'classic' ? x + 12 : x + 72;
  const textW = design === 'classic' ? CARD_W - 84 : CARD_W - 80;
  doc.fillColor(col.name).font('bold').fontSize(cfg.fontDetails + 2).text(c.name, textX, top, { width: textW, height: cfg.fontDetails + 4, ellipsis: true });
  const lines = c.lines;
  const lineH = Math.min(cfg.fontDetails + 3, 70 / Math.max(lines.length, 1));
  doc.fillColor(col.text).font('regular').fontSize(cfg.fontDetails);
  lines.forEach((line, i) => doc.text(line, textX, top + cfg.fontDetails + 6 + i * lineH, { width: textW, height: lineH, ellipsis: true, lineBreak: false }));

  // footer
  doc.fillColor(col.soft).fontSize(6.5).text(`${t.valid}: ${ctx.validUntil}${cfg.issueDate ? `   ${t.issued}: ${cfg.issueDate}` : ''}`, x + 10, y + CARD_H - 12, { width: 130, lineBreak: false });
  if (cfg.show.signatureFront) drawSignature(ctx, x, y);
};

const studentQr = (c: CardData, cfg: IdCardConfigData) => {
  if (cfg.qrMode === 'off') return '';
  const fallback = cfg.qrMode === 'dynamic' ? '{student_id}' : '';
  return fillTemplate(cfg.qrData || fallback, {
    student_id: c.studentId,
    name: c.name,
    roll: c.roll,
    class_name: c.className,
    section_name: c.sectionName,
    group_name: c.groupName,
    session: c.sessionName,
    father_name: c.fatherName,
    mother_name: c.motherName,
    mobile: c.mobile,
    blood_group: c.bloodGroup,
    dob: c.dob,
  });
};

const drawBack = (ctx: Ctx, c: SheetCard, x: number, y: number) => {
  const { doc, cfg, design } = ctx;
  const t = L[ctx.locale];
  const col = tone(ctx);
  doc.roundedRect(x, y, CARD_W, CARD_H, 6).lineWidth(design === 'classic' ? 1.4 : 0.6).stroke(design === 'classic' || design === 'mono' ? col.border : '#999999');
  drawWatermark(ctx, x, y);

  if (design === 'modern') {
    doc.save().roundedRect(x, y, CARD_W, 22, 6).clip().rect(x, y, CARD_W, 22).fill(col.main).restore();
    doc.fillColor('#ffffff').font('bold').fontSize(8.5).text(ctx.schoolName, x + 6, y + 7, { width: CARD_W - 12, align: 'center', height: 12, ellipsis: true, lineBreak: false });
  } else {
    doc.fillColor(col.main).font('bold').fontSize(8.5).text(ctx.schoolName, x + 6, y + 7, { width: CARD_W - 12, align: 'center', height: 12, ellipsis: true, lineBreak: false });
    doc.moveTo(x + 10, y + 22).lineTo(x + CARD_W - 10, y + 22).lineWidth(0.5).stroke(col.border);
  }

  const qr = c.qr;
  const textW = qr ? CARD_W - 84 : CARD_W - 24;
  doc.fillColor(col.text).font('regular').fontSize(cfg.fontDetails - 0.5).text(cfg.backTop || t.rules, x + 12, y + 30, { width: textW, height: 74, ellipsis: true });
  if (qr) drawQr(doc, qr, x + CARD_W - 66, y + 32, 54, col.text);
  if (cfg.backBottom) doc.fillColor(col.soft).fontSize(6.5).text(cfg.backBottom, x + 10, y + CARD_H - 24, { width: CARD_W - 20, height: 10, align: 'center', ellipsis: true, lineBreak: false });
  if (cfg.show.signatureBack) drawSignature(ctx, x, y);
};

export interface RenderOptions {
  sectionId?: string;
  studentIds?: string[];
  group?: string;
  part: 'front' | 'back' | 'both';
  design?: IdCardDesign;
  sample?: boolean;
}

/** Lays cards out 8 to an A4 page, fronts then backs (backs mirrored for a two-sided printer). */
export const renderSheet = async (
  cards: SheetCard[],
  cfg: VisualCfg,
  o: { part: 'front' | 'back' | 'both'; design?: IdCardDesign; locale: Locale; title: string },
): Promise<Buffer> => {
  const tenant = await Tenant.findById(requireTenantId()).select('name nameBn contact.address').lean();
  const [photos, watermark, signature] = await Promise.all([
    Promise.all(cards.map((c) => loadPhoto(c.photoUrl))),
    cfg.show.watermark ? loadPng(cfg.watermarkUrl, 400) : Promise.resolve(null),
    cfg.show.signatureFront || cfg.show.signatureBack ? loadPng(cfg.signatureUrl, 300) : Promise.resolve(null),
  ]);
  const doc = createPdf({ margin: 0 });
  const ctx: Ctx = {
    doc,
    cfg,
    title: o.title,
    design: o.design ?? cfg.design,
    locale: o.locale,
    schoolName: (o.locale === 'bn' && (tenant as any)?.nameBn) || (tenant as any)?.name || '',
    address: (tenant as any)?.contact?.address ?? '',
    watermark,
    signature,
    validUntil: cfg.validUntil || `31 Dec ${new Date().getFullYear() + cfg.validityYears - 1}`,
  };

  const left = (doc.page.width - (COLS * CARD_W + (COLS - 1) * GAP_X)) / 2;
  const top = 40;
  const perPage = COLS * ROWS;
  const pos = (i: number, mirror: boolean) => {
    const col = i % COLS;
    return { x: left + (mirror ? COLS - 1 - col : col) * (CARD_W + GAP_X), y: top + Math.floor(i / COLS) * (CARD_H + GAP_Y) };
  };

  let first = true;
  const newPage = () => {
    if (!first) doc.addPage();
    first = false;
  };
  for (let start = 0; start < cards.length; start += perPage) {
    const chunk = cards.slice(start, start + perPage);
    if (o.part !== 'back') {
      newPage();
      chunk.forEach((c, i) => {
        const p = pos(i, false);
        drawFront(ctx, c, photos[start + i], p.x, p.y);
      });
    }
    if (o.part !== 'front') {
      newPage();
      chunk.forEach((c, i) => {
        const p = pos(i, o.part === 'both');
        drawBack(ctx, c, p.x, p.y);
      });
    }
  }
  return pdfToBuffer(doc);
};

export const renderCards = async (q: RenderOptions, locale: Locale) => {
  const [cards, cfg] = await Promise.all([q.sample ? Promise.resolve([SAMPLE_CARD]) : collect(q, locale), getConfig()]);
  const sheet: SheetCard[] = cards.map((c) => ({ name: c.name, lines: studentLines(c, cfg, locale), qr: studentQr(c, cfg), photoUrl: c.photoUrl }));
  const pdf = await renderSheet(sheet, cfg, { part: q.part, design: q.design, locale, title: L[locale].title });
  await writeAudit({ action: 'idCard.print', entityType: 'IdCard', entityId: requireTenantId(), after: { count: cards.length, part: q.part, sample: !!q.sample } });
  return { pdf, count: cards.length };
};
