import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { todayLocal } from '../../lib/localDate';
import { escapeRegex, toSkip, type PageParams } from '../../lib/pagination';
import { hashPassword } from '../../lib/password';
import { generateTempPassword } from '../../lib/tempPassword';
import { withTransaction } from '../../lib/transaction';
import { writeAudit } from '../auditLog/auditLog.model';
import { nextSeq } from '../counter/counter.model';
import { currentSession, nextRoll, resolveSection } from '../enrolment/enrolment.service';
import { Enrolment } from '../enrolment/enrolment.model';
import { Guardian } from '../guardian/guardian.model';
import { upsertGuardian, type GuardianInput } from '../guardian/guardian.service';
import { Tenant } from '../tenant/tenant.model';
import { requireTenantId } from '../../lib/tenantContext';
import { User } from '../user/user.model';
import { scopeFor, teacherEnrolmentFilter, assertCanSeeStudent } from './student.access';
import { Student } from './student.model';

const yy = () => todayLocal().slice(2, 4);

export const assertUnderCap = async () => {
  const tenant = await Tenant.findById(requireTenantId()).select('studentCap').lean();
  const active = await Student.countDocuments({ status: 'active' });
  if (tenant && active >= tenant.studentCap) {
    throw new AppError(
      403,
      'PLAN_LIMIT_REACHED',
      `Your plan allows ${tenant.studentCap} active students. Upgrade the plan to add more.`,
    );
  }
};

export interface CreateStudentInput {
  admissionNo?: string;
  name: string;
  nameBn?: string;
  gender: 'male' | 'female' | 'other';
  dob: string;
  photoUrl?: string;
  religion?: string;
  bloodGroup?: 'A+' | 'A-' | 'AB+' | 'AB-' | 'B+' | 'B-' | 'O+' | 'O-';
  address?: string;
  birthRegistrationNo?: string;
  admittedOn?: string;
  enrolment: {
    sessionId?: string;
    classId: string;
    sectionId?: string;
    roll?: number;
    group?: 'science' | 'commerce' | 'arts' | null;
    optionalSubjectIds?: string[];
    fourthSubjectId?: string;
  };
  guardians: GuardianInput[];
}

/** Public shape of a student. Birth registration number is never returned. */
export const studentView = (s: any) => {
  const o = s.toObject ? s.toObject() : s;
  delete o.birthRegistrationNo;
  return o;
};

/** Creates the student, enrolment and guardians together; used by the API and by CSV import. */
export const createStudentRecord = async (
  input: CreateStudentInput,
  session: import('mongoose').ClientSession,
) => {
  const sess = await currentSession(input.enrolment.sessionId);
  const { section } = await resolveSection(input.enrolment.classId, input.enrolment.sectionId, session);
  const year = yy();
  const seq = await nextSeq(`student-${year}`, session);
  const studentId = `${year}-${String(seq).padStart(4, '0')}`;
  const _id = new Types.ObjectId();

  let guardiansReused = 0;
  const guardianIds: Types.ObjectId[] = [];
  for (const g of input.guardians) {
    const { guardian, reused } = await upsertGuardian(g, _id, session);
    guardianIds.push(guardian._id);
    if (reused) guardiansReused += 1;
  }

  const roll = input.enrolment.roll ?? (await nextRoll(sess._id, section.classId, section._id, session));
  const [enrolment] = await Enrolment.create(
    [
      {
        studentId: _id,
        sessionId: sess._id,
        classId: section.classId,
        sectionId: section._id,
        roll,
        group: input.enrolment.group ?? null,
        optionalSubjectIds: input.enrolment.optionalSubjectIds ?? [],
        fourthSubjectId: input.enrolment.fourthSubjectId,
      },
    ],
    { session },
  );

  const { enrolment: _e, guardians: _g, ...profile } = input;
  const [student] = await Student.create(
    [
      {
        ...profile,
        _id,
        studentId,
        admittedOn: input.admittedOn ?? todayLocal(),
        guardianIds,
        currentEnrolmentId: enrolment._id,
      },
    ],
    { session },
  );
  return { student, enrolment, guardiansReused };
};

export const createStudent = async (input: CreateStudentInput) => {
  await assertUnderCap();
  const result = await withTransaction((session) => createStudentRecord(input, session));
  await writeAudit({
    action: 'student.create',
    entityType: 'Student',
    entityId: result.student._id,
    after: { studentId: result.student.studentId },
  });
  return { ...studentView(result.student), enrolment: result.enrolment };
};

export const listStudents = async (
  auth: { userId: Types.ObjectId; role: string },
  page: PageParams,
  f: { q?: string; classId?: string; sectionId?: string; sessionId?: string; status?: string },
) => {
  const scope = await scopeFor(auth);
  const filter: Record<string, any> = {};
  if (f.status) filter.status = f.status;
  if (f.q) {
    const re = new RegExp(escapeRegex(f.q), 'i');
    const or: Record<string, any>[] = [{ name: re }, { studentId: re }, { admissionNo: re }];
    // A guardian's phone, so the accountant can find a student by who is paying.
    const guardianIds = await Guardian.find({ phone: re }).distinct('_id');
    if (guardianIds.length) or.push({ guardianIds: { $in: guardianIds } });
    // A roll number, so the accountant can find a student by roll in the current session.
    if (/^\d{1,3}$/.test(f.q)) {
      const sess = await currentSession().catch(() => null);
      if (sess) {
        const ids = await Enrolment.find({ sessionId: sess._id, roll: Number(f.q), status: 'active' }).distinct(
          'studentId',
        );
        if (ids.length) or.push({ _id: { $in: ids } });
      }
    }
    filter.$or = or;
  }
  if (scope.kind === 'own') filter._id = { $in: scope.studentIds };

  const enrolFilter: Record<string, any> = {};
  if (f.classId) enrolFilter.classId = f.classId;
  if (f.sectionId) enrolFilter.sectionId = f.sectionId;
  if (f.sessionId) enrolFilter.sessionId = f.sessionId;
  const needsEnrol = Object.keys(enrolFilter).length > 0 || scope.kind === 'teacher';
  if (needsEnrol) {
    const sess = f.sessionId ? undefined : await currentSession().catch(() => null);
    const q: Record<string, any> = {
      ...enrolFilter,
      ...(sess ? { sessionId: sess._id } : {}),
      ...(scope.kind === 'teacher' ? teacherEnrolmentFilter(scope.pairs) : {}),
    };
    const ids = await Enrolment.find(q).distinct('studentId');
    filter._id = filter._id
      ? {
          $in: ids.filter((id: Types.ObjectId) =>
            (filter._id.$in as Types.ObjectId[]).some((x) => x.equals(id)),
          ),
        }
      : { $in: ids };
  }

  const [rows, total] = await Promise.all([
    Student.find(filter)
      .sort({ name: 1 })
      .skip(toSkip(page))
      .limit(page.limit)
      .populate('currentEnrolmentId', 'classId sectionId roll sessionId')
      .lean(),
    Student.countDocuments(filter),
  ]);
  return { rows, total };
};

export const getStudent = async (auth: { userId: Types.ObjectId; role: string }, id: string) => {
  const student = await Student.findById(id);
  if (!student) throw AppError.notFound('Student not found');
  await assertCanSeeStudent(auth, student);
  const enrolments = await Enrolment.find({ studentId: student._id }).sort({ createdAt: -1 }).lean();
  const guardians =
    auth.role === 'student'
      ? []
      : await Guardian.find({ _id: { $in: student.guardianIds } })
          .select('name phone relation')
          .lean();
  return { ...studentView(student), enrolments, guardians };
};

export const updateStudent = async (id: string, patch: Record<string, any>) => {
  const student = await Student.findById(id).select('+birthRegistrationNo');
  if (!student) throw AppError.notFound('Student not found');
  const before = { name: student.name, dob: student.dob, gender: student.gender };
  student.set(patch);
  await student.save();
  await writeAudit({
    action: 'student.update',
    entityType: 'Student',
    entityId: student._id,
    before,
    after: { name: student.name, dob: student.dob, gender: student.gender },
  });
  return studentView(student);
};

export const setStudentStatus = async (id: string, status: string) => {
  const student = await Student.findById(id);
  if (!student) throw AppError.notFound('Student not found');
  if (status === 'active' && student.status !== 'active') await assertUnderCap();
  const before = student.status;
  student.status = status as any;
  await student.save();
  if (status !== 'active') {
    await User.updateMany({ linkedStudentId: student._id }, { $set: { status: 'inactive' } });
  }
  await writeAudit({
    action: 'student.status_change',
    entityType: 'Student',
    entityId: student._id,
    before: { status: before },
    after: { status },
  });
  return studentView(student);
};

export const deleteStudent = async (id: string, actorId: Types.ObjectId) => {
  const student = await Student.findById(id);
  if (!student) throw AppError.notFound('Student not found');
  await (student as any).softDelete(actorId);
  await User.updateMany({ linkedStudentId: student._id }, { $set: { status: 'inactive' } });
  await writeAudit({ action: 'student.delete', entityType: 'Student', entityId: student._id });
};

export const changeEnrolment = async (id: string, patch: { sectionId?: string; roll?: number }) => {
  const student = await Student.findById(id);
  if (!student?.currentEnrolmentId) throw AppError.notFound('Student not found');
  const enrol = await Enrolment.findById(student.currentEnrolmentId);
  if (!enrol) throw AppError.notFound('Enrolment not found');
  const before = { sectionId: enrol.sectionId, roll: enrol.roll };
  if (patch.sectionId) {
    const { section } = await resolveSection(enrol.classId, patch.sectionId);
    enrol.sectionId = section._id;
    if (!patch.roll) enrol.roll = await nextRoll(enrol.sessionId, enrol.classId, section._id);
  }
  if (patch.roll) enrol.roll = patch.roll;
  await enrol.save();
  await writeAudit({
    action: 'student.enrolment_change',
    entityType: 'Student',
    entityId: student._id,
    before,
    after: { sectionId: enrol.sectionId, roll: enrol.roll },
  });
  return enrol;
};

export const attachGuardian = async (id: string, input: GuardianInput) => {
  const student = await Student.findById(id);
  if (!student) throw AppError.notFound('Student not found');
  const result = await withTransaction(async (session) => {
    const { guardian, reused } = await upsertGuardian(input, student._id, session);
    if (!student.guardianIds.some((g) => g.equals(guardian._id))) {
      student.guardianIds.push(guardian._id);
      await student.save({ session });
    }
    return { guardian, reused };
  });
  return { guardianId: result.guardian._id, reused: result.reused };
};

/** Creates student and/or guardian logins with temporary passwords (shown once). */
export const createLogins = async (id: string, opts: { student: boolean; guardianIds: string[] }) => {
  const student = await Student.findById(id);
  if (!student) throw AppError.notFound('Student not found');
  const out: {
    student?: { loginId: string; temporaryPassword: string };
    guardians: { guardianId: Types.ObjectId; phone: string; temporaryPassword: string }[];
  } = { guardians: [] };

  if (opts.student) {
    if (await User.exists({ role: 'student', linkedStudentId: student._id }))
      throw AppError.conflict('Student login already exists', 'LOGIN_EXISTS');
    const temp = generateTempPassword();
    await User.create({
      role: 'student',
      name: student.name,
      studentLoginId: student.studentId,
      linkedStudentId: student._id,
      passwordHash: await hashPassword(temp),
      mustChangePassword: true,
    });
    out.student = { loginId: student.studentId, temporaryPassword: temp };
  }

  for (const gid of opts.guardianIds) {
    if (!student.guardianIds.some((g) => g.equals(gid)))
      throw AppError.badRequest('Guardian is not linked to this student');
    const guardian = await Guardian.findById(gid);
    if (!guardian) throw AppError.badRequest('Guardian not found');
    // One guardian login per guardian (phone), shared across all their children.
    if (await User.exists({ role: 'guardian', linkedGuardianId: guardian._id })) continue;
    const temp = generateTempPassword();
    await User.create({
      role: 'guardian',
      name: guardian.name,
      phone: guardian.phone,
      linkedGuardianId: guardian._id,
      passwordHash: await hashPassword(temp),
      mustChangePassword: true,
    });
    out.guardians.push({ guardianId: guardian._id, phone: guardian.phone, temporaryPassword: temp });
  }
  await writeAudit({ action: 'student.create_login', entityType: 'Student', entityId: student._id });
  return out;
};

export const myStudents = async (auth: { userId: Types.ObjectId; role: string }) => {
  const scope = await scopeFor(auth);
  const ids = scope.kind === 'own' ? scope.studentIds : [];
  return Student.find({ _id: { $in: ids } })
    .populate('currentEnrolmentId', 'classId sectionId roll sessionId')
    .lean();
};
