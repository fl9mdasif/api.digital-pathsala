import type { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { writeAudit } from '../auditLog/auditLog.model';
import { Section } from '../section/section.model';
import { RoutinePeriod } from '../routinePeriod/routinePeriod.model';
import { Subject } from '../subject/subject.model';
import { User } from '../user/user.model';
import { ClassRoutineSlot } from './classRoutine.model';

interface Auth {
  userId: Types.ObjectId;
  role: string;
}

const periods = () => RoutinePeriod.find().sort({ order: 1, startTime: 1 }).lean();

const loadSection = async (sectionId: string) => {
  const section = await Section.findById(sectionId).populate('classId', 'name nameBn').lean();
  if (!section) throw AppError.notFound('Section not found');
  return section as any;
};

const slotView = (s: any) => ({
  _id: s._id,
  day: s.day,
  periodId: s.periodId,
  room: s.room,
  subject: s.subjectId ? { _id: s.subjectId._id, name: s.subjectId.name, nameBn: s.subjectId.nameBn } : null,
  teacher: s.teacherId ? { _id: s.teacherId._id, name: s.teacherId.name } : null,
});

export const forSection = async (sectionId: string) => {
  const section = await loadSection(sectionId);
  const slots = await ClassRoutineSlot.find({ sectionId })
    .populate('subjectId', 'name nameBn')
    .populate('teacherId', 'name')
    .lean();
  return {
    section: { _id: section._id, name: section.name, class: section.classId },
    periods: await periods(),
    slots: slots.map(slotView),
  };
};

/** A teacher's own timetable across every section they teach. */
export const forTeacher = async (auth: Auth) => {
  const slots = await ClassRoutineSlot.find({ teacherId: auth.userId })
    .populate('subjectId', 'name nameBn')
    .populate('sectionId', 'name')
    .populate('classId', 'name nameBn')
    .lean();
  return {
    periods: await periods(),
    slots: slots.map((s: any) => ({
      ...slotView(s),
      section: s.sectionId ? { _id: s.sectionId._id, name: s.sectionId.name } : null,
      class: s.classId ? { _id: s.classId._id, name: s.classId.name, nameBn: s.classId.nameBn } : null,
    })),
  };
};

export const saveSlot = async (input: {
  sectionId: string;
  day: number;
  periodId: string;
  subjectId: string;
  teacherId?: string;
  room?: string;
}) => {
  const section = await loadSection(input.sectionId);
  const period = await RoutinePeriod.findById(input.periodId).lean();
  if (!period) throw AppError.notFound('Period not found');
  if (period.isBreak) throw AppError.badRequest('A break period cannot hold a class', undefined, 'BREAK_PERIOD');
  if (!(await Subject.exists({ _id: input.subjectId }))) throw AppError.notFound('Subject not found');

  if (input.teacherId) {
    if (!(await User.exists({ _id: input.teacherId, role: 'teacher', status: 'active' })))
      throw AppError.badRequest('Teacher must be an active teacher', undefined, 'INVALID_TEACHER');
    const busy = await ClassRoutineSlot.findOne({
      teacherId: input.teacherId,
      day: input.day,
      periodId: input.periodId,
      sectionId: { $ne: input.sectionId },
    })
      .populate('sectionId', 'name')
      .populate('classId', 'name')
      .lean();
    if (busy) {
      const where = `${(busy as any).classId?.name ?? ''} ${(busy as any).sectionId?.name ?? ''}`.trim();
      throw AppError.conflict(`This teacher already teaches ${where} in that period`, 'TEACHER_CONFLICT');
    }
  }

  const slot = await ClassRoutineSlot.findOneAndUpdate(
    { sectionId: input.sectionId, day: input.day, periodId: input.periodId },
    {
      $set: {
        classId: section.classId._id,
        subjectId: input.subjectId,
        teacherId: input.teacherId ?? null,
        room: input.room ?? null,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  await writeAudit({ action: 'classRoutine.save', entityType: 'ClassRoutineSlot', entityId: slot._id, after: input });
  return slot;
};

export const removeSlot = async (key: { sectionId: string; day: number; periodId: string }) => {
  const slot = await ClassRoutineSlot.findOneAndDelete(key);
  if (!slot) throw AppError.notFound('No class is scheduled in that slot');
  await writeAudit({ action: 'classRoutine.remove', entityType: 'ClassRoutineSlot', entityId: slot._id, before: key });
  return { deleted: true };
};
