import { AppError } from '../../errors/AppError';
import { escapeRegex, toSkip, type PageParams } from '../../lib/pagination';
import { todayLocal } from '../../lib/localDate';
import { normalizeBdPhone } from '../../lib/phone';
import { requireTenantId } from '../../lib/tenantContext';
import { ClassModel } from '../class/class.model';
import { forSection } from '../classRoutine/classRoutine.service';
import { Guardian } from '../guardian/guardian.model';
import { Invoice } from '../invoice/invoice.model';
import { Payment } from '../payment/payment.model';
import { Section } from '../section/section.model';
import { Student } from '../student/student.model';
import { User } from '../user/user.model';
import { Inquiry } from '../inquiry/inquiry.model';
import { Notice } from '../notice/notice.model';
import { Plan } from '../plan/plan.model';
import { PublicSite } from '../publicSite/publicSite.model';
import { StaffProfile } from '../staffProfile/staffProfile.model';
import { Tenant } from '../tenant/tenant.model';

/** An unpublished site does not exist as far as the public is concerned. */
const publishedSite = async () => {
  const site = await PublicSite.findOne({ isPublished: true }).lean();
  if (!site) throw AppError.notFound('School website not found', 'SCHOOL_NOT_FOUND');
  return site;
};

export const getSite = async () => {
  const site = await publishedSite();
  const tenant = await Tenant.findById(requireTenantId())
    .select('name nameBn slug institutionType logoUrl contact.district contact.upazila settings.resultLookupMode')
    .lean();
  const v = site.sectionsVisible ?? {};
  return {
    school: {
      name: tenant?.name,
      nameBn: tenant?.nameBn,
      slug: tenant?.slug,
      type: tenant?.institutionType,
      logoUrl: tenant?.logoUrl,
      district: tenant?.contact?.district,
      upazila: tenant?.contact?.upazila,
    },
    theme: site.theme,
    hero: site.hero,
    about: v.about === false ? undefined : site.about,
    mission: v.about === false ? undefined : site.mission,
    headMessage: site.headMessage,
    secondMessage: site.secondMessage,
    establishedYear: site.establishedYear,
    eiin: site.eiin,
    quickTiles: site.quickTiles ?? [],
    importantLinks: site.importantLinks ?? [],
    display: { showStats: site.display?.showStats !== false, showTicker: site.display?.showTicker !== false },
    admissionInfo: v.admission === false ? undefined : site.admissionInfo,
    contact: site.contact,
    gallery: v.gallery === false ? [] : site.gallery,
    social: site.social,
    seo: site.seo,
    sectionsVisible: site.sectionsVisible,
    resultLookupMode: (tenant as any)?.settings?.resultLookupMode ?? 'roll_dob',
  };
};

export const listPublicNotices = async (page: PageParams) => {
  await publishedSite();
  const now = new Date();
  const filter = {
    isPublic: true,
    status: 'published',
    publishAt: { $lte: now },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
  };
  const [rows, total] = await Promise.all([
    Notice.find(filter)
      .select('title body attachments publishAt')
      .sort({ publishAt: -1 })
      .skip(toSkip(page))
      .limit(page.limit)
      .lean(),
    Notice.countDocuments(filter),
  ]);
  return { rows, total };
};

export const listPublicStaff = async () => {
  await publishedSite();
  return StaffProfile.find({ showOnPublicSite: true })
    .select('name designation photoUrl bio order')
    .sort({ order: 1, name: 1 })
    .lean();
};

export const submitInquiry = async (input: {
  name: string;
  phone: string;
  message?: string;
  classInterest?: string;
  website?: string;
}) => {
  await publishedSite();
  // Honeypot: real visitors never see this field. Bots that fill it get a normal-looking reply and nothing is stored.
  if (input.website) return { received: true };
  await Inquiry.create({
    name: input.name,
    phone: input.phone,
    message: input.message,
    classInterest: input.classInterest,
  });
  return { received: true };
};


/** Headline counts for the home page. Numbers only, nothing about any person. */
export const publicStats = async () => {
  const site = await publishedSite();
  if (site.display?.showStats === false) return { students: null, teachers: null, staff: null };
  const [students, teachers, staff] = await Promise.all([
    Student.countDocuments({ status: 'active' }),
    User.countDocuments({ role: 'teacher', status: 'active' }),
    User.countDocuments({ role: { $in: ['admin', 'accountant'] }, status: 'active' }),
  ]);
  return { students, teachers, staff };
};

/** Classes with their sections, so a visitor can pick a routine. */
export const publicClasses = async () => {
  const site = await publishedSite();
  if (site.sectionsVisible?.routine === false) throw AppError.notFound('Not available', 'NOT_AVAILABLE');
  const [classes, sections] = await Promise.all([
    ClassModel.find().select('name nameBn order').sort({ order: 1, name: 1 }).lean(),
    Section.find().select('name classId isDefault').sort({ name: 1 }).lean(),
  ]);
  return (classes as any[]).map((c) => ({
    _id: String(c._id),
    name: c.name,
    nameBn: c.nameBn,
    sections: (sections as any[]).filter((s) => String(s.classId) === String(c._id)).map((s) => ({ _id: String(s._id), name: s.name, isDefault: !!s.isDefault })),
  }));
};

/** The weekly class routine of one section. */
export const publicRoutine = async (sectionId: string) => {
  const site = await publishedSite();
  if (site.sectionsVisible?.routine === false) throw AppError.notFound('Not available', 'NOT_AVAILABLE');
  return forSection(sectionId);
};

/** One answer for every failure, so a wrong ID cannot be told from a wrong number. */
const FEE_NOT_FOUND = () => new AppError(404, 'FEE_NOT_FOUND', 'No student found for the details provided');

/** A student's dues and last payments, for a parent who gives the student ID and the guardian's mobile number. Read only. */
export const publicFeeLookup = async (input: { studentId: string; phone: string }) => {
  const site = await publishedSite();
  if (site.sectionsVisible?.feeLookup === false) throw AppError.notFound('Not available', 'NOT_AVAILABLE');
  const phone = normalizeBdPhone(input.phone);
  if (!phone) throw FEE_NOT_FOUND();
  const student: any = await Student.findOne({ studentId: input.studentId.trim(), status: 'active' }).select('name studentId guardianIds').lean();
  if (!student) throw FEE_NOT_FOUND();
  const guardian = await Guardian.exists({ _id: { $in: student.guardianIds ?? [] }, phone });
  if (!guardian) throw FEE_NOT_FOUND();

  const [invoices, payments] = await Promise.all([
    Invoice.find({ studentId: student._id, status: { $in: ['unpaid', 'partial'] } }).select('periodLabel dueAmount dueDate status').sort({ dueDate: 1 }).limit(60).lean(),
    Payment.find({ studentId: student._id, status: 'succeeded' }).select('receiptNo amount method receivedAt').sort({ receivedAt: -1 }).limit(5).lean(),
  ]);
  const today = todayLocal();
  const totalDue = (invoices as any[]).reduce((s, i) => s + i.dueAmount, 0);
  const overdue = (invoices as any[]).filter((i) => i.dueDate < today).reduce((s, i) => s + i.dueAmount, 0);
  return {
    student: { name: student.name, studentId: student.studentId },
    totalDue,
    overdue,
    invoices: (invoices as any[]).map((i) => ({ periodLabel: i.periodLabel, dueAmount: i.dueAmount, dueDate: i.dueDate, status: i.status })),
    payments: (payments as any[]).map((p) => ({ receiptNo: p.receiptNo, amount: p.amount, method: p.method, receivedAt: p.receivedAt })),
  };
};

export const publicPlans = () =>
  Plan.find({ isActive: true })
    .select('slug name monthlyPrice yearlyPrice yearlyDiscount trialDays isPopular features notIncluded')
    .sort({ monthlyPrice: 1 })
    .lean();

export const findSchools = async (q: string) => {
  const re = new RegExp(escapeRegex(q), 'i');
  const rows = await Tenant.find({ status: { $in: ['trial', 'active'] }, $or: [{ name: re }, { slug: re }] })
    .select('name slug contact.district')
    .limit(10)
    .lean();
  return rows.map((t: any) => ({ name: t.name, slug: t.slug, district: t.contact?.district }));
};
