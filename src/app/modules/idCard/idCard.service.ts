import { AppError } from '../../errors/AppError';
import { env } from '../../config/env';
import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { ClassModel } from '../class/class.model';
import { Enrolment } from '../enrolment/enrolment.model';
import { currentSession } from '../enrolment/enrolment.service';
import { Guardian } from '../guardian/guardian.model';
import { Section } from '../section/section.model';
import { Student } from '../student/student.model';
import { Tenant } from '../tenant/tenant.model';
import { DEFAULT_ID_CARD_CONFIG, IdCardConfig } from './idCard.model';
import { MAX_CARDS } from './idCard.validation';

type Config = typeof DEFAULT_ID_CARD_CONFIG;
type Locale = 'bn' | 'en';

const L = {
  en: { title: 'Student ID Card', id: 'ID', cls: 'Class', roll: 'Roll', dob: 'DOB', guardian: 'Guardian', valid: 'Valid until' },
  bn: { title: 'শিক্ষার্থী পরিচয়পত্র', id: 'আইডি', cls: 'শ্রেণি', roll: 'রোল', dob: 'জন্ম তারিখ', guardian: 'অভিভাবক', valid: 'মেয়াদ' },
} as const;

export const getConfig = async (): Promise<Config> => {
  const c = await IdCardConfig.findOne().lean();
  return c
    ? {
        themeColor: c.themeColor,
        validityYears: c.validityYears,
        signatureTitle: c.signatureTitle,
        showGuardianPhone: c.showGuardianPhone,
        footerNote: c.footerNote ?? '',
      }
    : { ...DEFAULT_ID_CARD_CONFIG };
};

export const saveConfig = async (input: Config) => {
  const before = await getConfig();
  await IdCardConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'idCard.config', entityType: 'IdCardConfig', entityId: requireTenantId(), before, after: input });
  return input;
};

export interface CardData {
  studentObjectId: string;
  classId: string;
  sectionId?: string;
  name: string;
  studentId: string;
  className: string;
  sectionName?: string;
  roll: number;
  dob: string;
  guardianPhone?: string;
  photoUrl?: string;
}

/** Cards for one section, or for a list of students, in class then roll order. */
export const collect = async (q: { sectionId?: string; studentIds?: string[] }, locale: Locale): Promise<CardData[]> => {
  const session = await currentSession();
  const filter: Record<string, unknown> = { sessionId: session._id, status: 'active' };
  if (q.sectionId) filter.sectionId = q.sectionId;
  else filter.studentId = { $in: q.studentIds };
  const enrolments: any[] = await Enrolment.find(filter).sort({ classId: 1, sectionId: 1, roll: 1 }).limit(MAX_CARDS).lean();
  if (enrolments.length === 0) throw AppError.notFound('No students found for the ID cards', 'NO_STUDENTS');

  const [students, classes, sections] = await Promise.all([
    Student.find({ _id: { $in: enrolments.map((e) => e.studentId) }, status: 'active' })
      .select('name nameBn studentId dob photoUrl guardianIds')
      .lean(),
    ClassModel.find({ _id: { $in: enrolments.map((e) => e.classId) } }).select('name nameBn').lean(),
    Section.find({ _id: { $in: enrolments.map((e) => e.sectionId).filter(Boolean) } }).select('name isDefault').lean(),
  ]);
  const guardians: any[] = await Guardian.find({ _id: { $in: students.flatMap((s: any) => s.guardianIds ?? []) } })
    .select('phone')
    .lean();

  const byStudent = new Map(students.map((s: any) => [String(s._id), s]));
  const byClass = new Map(classes.map((c: any) => [String(c._id), c]));
  const bySection = new Map(sections.map((s: any) => [String(s._id), s]));
  const guardianPhone = new Map(guardians.map((g) => [String(g._id), g.phone]));

  return enrolments
    .filter((e) => byStudent.has(String(e.studentId)))
    .map((e) => {
      const s: any = byStudent.get(String(e.studentId));
      const c: any = byClass.get(String(e.classId));
      const sec: any = e.sectionId ? bySection.get(String(e.sectionId)) : undefined;
      return {
        studentObjectId: String(s._id),
        classId: String(e.classId),
        sectionId: e.sectionId ? String(e.sectionId) : undefined,
        name: locale === 'bn' && s.nameBn ? s.nameBn : s.name,
        studentId: s.studentId,
        className: (locale === 'bn' ? c?.nameBn : undefined) ?? c?.name ?? '-',
        sectionName: sec && !sec.isDefault ? sec.name : undefined,
        roll: e.roll,
        dob: s.dob,
        guardianPhone: (s.guardianIds ?? []).map((g: any) => guardianPhone.get(String(g))).find(Boolean),
        photoUrl: s.photoUrl,
      };
    });
};

/** Photos come from Cloudinary only, resized and converted to JPEG there. Anything else shows an empty frame. */
export const loadPhoto = async (url?: string): Promise<Buffer | null> => {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  if (!url || !cloud || !url.startsWith(`https://res.cloudinary.com/${cloud}/`) || !url.includes('/upload/')) return null;
  try {
    const res = await fetch(url.replace('/upload/', '/upload/f_jpg,w_240,h_300,c_fill,g_face/'), {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= 2 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
};

const CARD_W = 242.6; // CR80, 85.6 mm
const CARD_H = 153; // 54 mm
const COLS = 2;
const ROWS = 4;
const GAP_X = 20;
const GAP_Y = 14;

export const renderCards = async (q: { sectionId?: string; studentIds?: string[] }, locale: Locale) => {
  const [cards, cfg, tenant] = await Promise.all([
    collect(q, locale),
    getConfig(),
    Tenant.findById(requireTenantId()).select('name nameBn').lean(),
  ]);
  const t = L[locale];
  const photos = await Promise.all(cards.map((c) => loadPhoto(c.photoUrl)));
  const schoolName = (locale === 'bn' && (tenant as any)?.nameBn) || (tenant as any)?.name || '';
  const validUntil = `31 Dec ${new Date().getFullYear() + cfg.validityYears - 1}`;

  const doc = createPdf({ margin: 0 });
  const left = (doc.page.width - (COLS * CARD_W + (COLS - 1) * GAP_X)) / 2;
  const top = 40;

  cards.forEach((c, i) => {
    const slot = i % (COLS * ROWS);
    if (i > 0 && slot === 0) doc.addPage();
    const x = left + (slot % COLS) * (CARD_W + GAP_X);
    const y = top + Math.floor(slot / COLS) * (CARD_H + GAP_Y);

    doc.roundedRect(x, y, CARD_W, CARD_H, 6).lineWidth(0.6).stroke('#999999');
    doc.save().roundedRect(x, y, CARD_W, 36, 6).clip().rect(x, y, CARD_W, 36).fill(cfg.themeColor).restore();
    doc.fillColor('#ffffff').font('bold').fontSize(9.5).text(schoolName, x + 6, y + 6, { width: CARD_W - 12, align: 'center', height: 12, ellipsis: true });
    doc.font('regular').fontSize(7).text(t.title, x + 6, y + 22, { width: CARD_W - 12, align: 'center' });

    const px = x + 10;
    const py = y + 44;
    doc.rect(px, py, 54, 66).lineWidth(0.5).stroke('#bbbbbb');
    const photo = photos[i];
    if (photo) {
      try {
        doc.image(photo, px + 1, py + 1, { fit: [52, 64], align: 'center', valign: 'center' });
      } catch {
        /* an unreadable image leaves the empty frame */
      }
    }

    const tx = x + 72;
    const tw = CARD_W - 80;
    doc.fillColor('#111111').font('bold').fontSize(10).text(c.name, tx, py, { width: tw, height: 13, ellipsis: true });
    doc.font('regular').fontSize(7.5).fillColor('#222222');
    const lines = [
      `${t.id}: ${c.studentId}`,
      `${t.cls}: ${c.className}${c.sectionName ? ` - ${c.sectionName}` : ''}   ${t.roll}: ${c.roll}`,
      `${t.dob}: ${c.dob}`,
      cfg.showGuardianPhone && c.guardianPhone ? `${t.guardian}: ${c.guardianPhone}` : '',
    ].filter(Boolean);
    let ly = py + 16;
    for (const line of lines) {
      doc.text(line, tx, ly, { width: tw, height: 10, ellipsis: true });
      ly += 11;
    }

    const fy = y + CARD_H - 24;
    doc.fillColor('#555555').fontSize(6.5).text(`${t.valid}: ${validUntil}`, x + 10, fy + 12, { width: 120 });
    if (cfg.footerNote) doc.text(cfg.footerNote, x + 10, fy + 2, { width: 130, height: 9, ellipsis: true });
    doc.moveTo(x + CARD_W - 84, fy + 10).lineTo(x + CARD_W - 10, fy + 10).lineWidth(0.5).stroke('#555555');
    doc.text(cfg.signatureTitle, x + CARD_W - 84, fy + 12, { width: 74, align: 'center' });
  });

  await writeAudit({ action: 'idCard.print', entityType: 'IdCard', entityId: requireTenantId(), after: { count: cards.length } });
  return { pdf: await pdfToBuffer(doc), count: cards.length };
};
