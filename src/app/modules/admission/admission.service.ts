import type { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { todayLocal } from '../../lib/localDate';
import { escapeRegex, toSkip, type PageParams } from '../../lib/pagination';
import { normalizeBdPhone } from '../../lib/phone';
import { requireTenantId } from '../../lib/tenantContext';
import { withTransaction } from '../../lib/transaction';
import { getUploadProvider } from '../../lib/uploadProvider';
import { writeAudit } from '../auditLog/auditLog.model';
import { AcademicSession } from '../academicSession/academicSession.model';
import { ClassModel } from '../class/class.model';
import { nextSeq } from '../counter/counter.model';
import { PublicSite } from '../publicSite/publicSite.model';
import { assertUnderCap, createStudentRecord, type CreateStudentInput } from '../student/student.service';
import { Admission, type AdmissionStatus } from './admission.model';

type Profile = {
  classId: string;
  group?: 'science' | 'commerce' | 'arts' | null;
  name: string;
  nameBn?: string;
  gender: 'male' | 'female' | 'other';
  dob: string;
  religion?: string;
  bloodGroup?: CreateStudentInput['bloodGroup'];
  address?: string;
  birthRegistrationNo?: string;
  previousSchool?: string;
  guardians: { name: string; phone: string; relation: 'father' | 'mother' | 'other'; occupation?: string }[];
  photoUrl?: string;
};

const notFound = () => AppError.notFound('No application matches these details', 'APPLICATION_NOT_FOUND');

/** The site must be published and admission must be open for anything public to work. */
const openAdmission = async () => {
  const site = await PublicSite.findOne({ isPublished: true }).select('admissionInfo').lean();
  if (!site) throw AppError.notFound('School website not found', 'SCHOOL_NOT_FOUND');
  if (!(site as any).admissionInfo?.isOpen) throw AppError.conflict('Admission is closed right now', 'ADMISSION_CLOSED');
};

const assertClass = async (classId: string) => {
  if (!(await ClassModel.exists({ _id: classId }))) throw AppError.badRequest('Class not found', undefined, 'CLASS_NOT_FOUND');
};

/** Finds an application by number and a guardian phone. Any mismatch looks exactly like "not found". */
const findForApplicant = async (applicationNo: string, phone: string) => {
  const n = normalizeBdPhone(phone);
  if (!n) throw notFound();
  const row = await Admission.findOne({ applicationNo: applicationNo.trim().toUpperCase() });
  if (!row || !row.guardians.some((g: any) => g.phone === n)) throw notFound();
  return row;
};

/** What an applicant may see about their own application. */
const publicView = async (row: any) => {
  const cls = await ClassModel.findById(row.classId).select('name nameBn').lean();
  return {
    applicationNo: row.applicationNo,
    name: row.name,
    className: (cls as any)?.name,
    classNameBn: (cls as any)?.nameBn,
    status: row.status as AdmissionStatus,
    appliedAt: row.createdAt,
    updatedAt: row.updatedAt,
    note: row.status === 'applied' ? undefined : row.note,
    photo: { hasPhoto: !!row.photoUrl, pendingApproval: !!row.pendingPhotoUrl },
  };
};

// ---------- public ----------

export const apply = async (input: Profile & { website?: string }) => {
  await openAdmission();
  // Honeypot: bots that fill the hidden field get a normal-looking reply and nothing is stored.
  if (input.website) return { applicationNo: 'ADM-RECEIVED' };
  await assertClass(input.classId);
  const { website: _w, ...profile } = input;
  const session = await AcademicSession.findOne({ isCurrent: true }).select('_id').lean();
  const year = todayLocal().slice(0, 4);
  const seq = await nextSeq(`admission-${year}`);
  const applicationNo = `ADM-${year}-${String(seq).padStart(4, '0')}`;
  await Admission.create({
    ...profile,
    applicationNo,
    sessionId: (session as any)?._id,
    status: 'applied',
    history: [{ status: 'applied' }],
  });
  return { applicationNo };
};

export const lookup = async (input: { applicationNo: string; phone: string }) =>
  publicView(await findForApplicant(input.applicationNo, input.phone));

/** An applicant sends a new photo. It waits for an admin before it is used. */
export const requestPhotoChange = async (input: { applicationNo: string; phone: string; photoUrl: string }) => {
  const row = await findForApplicant(input.applicationNo, input.phone);
  if (row.status === 'confirmed' || row.status === 'rejected')
    throw AppError.conflict('This application can no longer be changed', 'APPLICATION_LOCKED');
  row.pendingPhotoUrl = input.photoUrl;
  await row.save();
  return publicView(row);
};

/** Classes an applicant can choose, only while admission is open (independent of the routine page switch). */
export const admissionClasses = async () => {
  await openAdmission();
  const rows = await ClassModel.find().select('name nameBn order').sort({ order: 1, name: 1 }).lean();
  return (rows as any[]).map((c) => ({ _id: String(c._id), name: c.name, nameBn: c.nameBn }));
};

/** Signed upload for an applicant photo. Images only, into the school's own admissions folder. */
export const signPhotoUpload = async () => {
  await openAdmission();
  return getUploadProvider().sign({ tenantId: String(requireTenantId()), kind: 'image', folder: 'admissions' });
};

// ---------- admin ----------

export const list = async (page: PageParams, f: { status?: AdmissionStatus; classId?: string; q?: string }) => {
  const filter: Record<string, any> = {};
  if (f.status) filter.status = f.status;
  if (f.classId) filter.classId = f.classId;
  if (f.q) {
    const re = new RegExp(escapeRegex(f.q), 'i');
    filter.$or = [{ name: re }, { nameBn: re }, { applicationNo: re }, { 'guardians.phone': re }];
  }
  const [rows, total, counts] = await Promise.all([
    Admission.find(filter)
      .select('-history -birthRegistrationNo')
      .populate('classId', 'name nameBn')
      .sort({ createdAt: -1 })
      .skip(toSkip(page))
      .limit(page.limit)
      .lean(),
    Admission.countDocuments(filter),
    Admission.aggregate([{ $match: { tenantId: requireTenantId() } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const byStatus = Object.fromEntries(counts.map((c: any) => [c._id, c.n]));
  return { rows, total, byStatus };
};

const mustFind = async (id: string) => {
  const row = await Admission.findById(id);
  if (!row) throw AppError.notFound('Application not found');
  return row;
};

export const get = async (id: string) => {
  const row = await Admission.findById(id).populate('classId', 'name nameBn').lean();
  if (!row) throw AppError.notFound('Application not found');
  return row;
};

const assertNotConfirmed = (row: any) => {
  if (row.status === 'confirmed') throw AppError.conflict('This application is already confirmed', 'APPLICATION_LOCKED');
};

export const decide = async (id: string, actorId: Types.ObjectId, input: { status: 'admitted' | 'rejected'; note?: string }) => {
  const row = await mustFind(id);
  assertNotConfirmed(row);
  const before = row.status;
  row.status = input.status;
  if (input.note !== undefined) row.note = input.note;
  row.history.push({ status: input.status, by: actorId, note: input.note });
  await row.save();
  await writeAudit({ action: `admission.${input.status}`, entityType: 'Admission', entityId: row._id, before: { status: before }, after: { status: row.status } });
  return row.toObject();
};

export const update = async (id: string, input: Partial<Profile> & { photoUrl?: string | null }) => {
  const row = await mustFind(id);
  assertNotConfirmed(row);
  if (input.classId) await assertClass(input.classId);
  const { photoUrl, ...rest } = input;
  row.set(rest);
  if (photoUrl === null) row.photoUrl = undefined;
  else if (photoUrl !== undefined) row.photoUrl = photoUrl;
  await row.save();
  await writeAudit({ action: 'admission.update', entityType: 'Admission', entityId: row._id, after: { fields: Object.keys(input) } });
  return row.toObject();
};

export const decidePhoto = async (id: string, approve: boolean) => {
  const row = await mustFind(id);
  if (!row.pendingPhotoUrl) throw AppError.badRequest('There is no photo waiting for approval', undefined, 'NO_PENDING_PHOTO');
  if (approve) row.photoUrl = row.pendingPhotoUrl;
  row.pendingPhotoUrl = undefined;
  await row.save();
  await writeAudit({ action: approve ? 'admission.photo_approve' : 'admission.photo_reject', entityType: 'Admission', entityId: row._id });
  return row.toObject();
};

/** Turns an admitted applicant into a real student (with enrolment and guardians) in one transaction. */
export const confirm = async (id: string, actorId: Types.ObjectId, input: { sectionId?: string; roll?: number }) => {
  const row = await mustFind(id);
  if (row.status !== 'admitted') throw AppError.conflict('Only an admitted application can be confirmed', 'NOT_ADMITTED');
  await assertUnderCap();
  const studentInput: CreateStudentInput = {
    admissionNo: row.applicationNo,
    name: row.name,
    nameBn: row.nameBn,
    gender: row.gender,
    dob: row.dob,
    photoUrl: row.photoUrl,
    religion: row.religion,
    bloodGroup: row.bloodGroup,
    address: row.address,
    birthRegistrationNo: row.birthRegistrationNo,
    enrolment: {
      sessionId: row.sessionId ? String(row.sessionId) : undefined,
      classId: String(row.classId),
      sectionId: input.sectionId,
      roll: input.roll,
      group: row.group ?? null,
    },
    guardians: row.guardians.map((g: any) => ({ name: g.name, phone: g.phone, relation: g.relation, occupation: g.occupation })),
  };
  const result = await withTransaction(async (session) => {
    const created = await createStudentRecord(studentInput, session);
    const upd = await Admission.updateOne(
      { _id: row._id, status: 'admitted' },
      {
        $set: { status: 'confirmed', studentId: created.student._id },
        $push: { history: { status: 'confirmed', at: new Date(), by: actorId } },
      },
      { session },
    );
    if (upd.modifiedCount !== 1) throw AppError.conflict('The application changed, reload and try again', 'CONFLICT');
    return created;
  });
  await writeAudit({ action: 'admission.confirm', entityType: 'Admission', entityId: row._id, after: { studentId: result.student.studentId } });
  return { applicationNo: row.applicationNo, studentId: result.student.studentId, student: result.student._id, enrolment: result.enrolment };
};
