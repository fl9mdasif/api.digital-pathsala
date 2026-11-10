import { AppError } from '../../errors/AppError';
import { writeAudit } from '../auditLog/auditLog.model';
import { ClassSubject } from '../classSubject/classSubject.model';
import { Exam } from '../exam/exam.model';
import { Section } from '../section/section.model';
import { ExamRoutineEntry } from './examRoutine.model';

type EntryInput = {
  examId: string;
  classId: string;
  sectionId?: string;
  subjectId: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
};

const view = (e: any) => ({
  _id: e._id,
  classId: e.classId?._id ?? e.classId,
  className: e.classId?.name,
  sectionId: e.sectionId?._id ?? e.sectionId ?? null,
  sectionName: e.sectionId?.name ?? null,
  subject: e.subjectId ? { _id: e.subjectId._id, name: e.subjectId.name, nameBn: e.subjectId.nameBn } : null,
  date: e.date,
  startTime: e.startTime,
  endTime: e.endTime,
  room: e.room ?? null,
});

const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  a.startTime < b.endTime && b.startTime < a.endTime;

export const list = async (q: { examId: string; classId?: string; sectionId?: string }) => {
  const exam = await Exam.findById(q.examId).select('name startDate endDate classIds status').lean();
  if (!exam) throw AppError.notFound('Exam not found');
  const filter: Record<string, unknown> = { examId: q.examId };
  if (q.classId) filter.classId = q.classId;
  if (q.sectionId) filter.$or = [{ sectionId: null }, { sectionId: q.sectionId }];

  const rows = await ExamRoutineEntry.find(filter)
    .sort({ date: 1, startTime: 1 })
    .populate('classId', 'name')
    .populate('sectionId', 'name')
    .populate('subjectId', 'name nameBn')
    .lean();

  // For one section, a section entry replaces the class-wide entry of the same subject.
  const entries = q.sectionId
    ? rows.filter(
        (r: any) =>
          r.sectionId ||
          !rows.some((o: any) => o.sectionId && String(o.subjectId?._id) === String(r.subjectId?._id) && String(o.classId?._id) === String(r.classId?._id)),
      )
    : rows;
  return { exam: { _id: exam._id, name: exam.name, startDate: exam.startDate, endDate: exam.endDate }, entries: entries.map(view) };
};

export const save = async (input: EntryInput) => {
  if (input.endTime <= input.startTime) throw AppError.badRequest('End time must be after start time');

  const exam = await Exam.findById(input.examId).lean();
  if (!exam) throw AppError.notFound('Exam not found');
  if (exam.classIds?.length && !exam.classIds.some((c: any) => String(c) === input.classId))
    throw AppError.badRequest('This class is not part of the exam', undefined, 'CLASS_NOT_IN_EXAM');
  if ((exam.startDate && input.date < exam.startDate) || (exam.endDate && input.date > exam.endDate))
    throw AppError.badRequest(
      `The date must fall within the exam period (${exam.startDate ?? '…'} to ${exam.endDate ?? '…'})`,
      undefined,
      'OUTSIDE_EXAM_DATES',
    );

  if (input.sectionId && !(await Section.exists({ _id: input.sectionId, classId: input.classId })))
    throw AppError.badRequest('The section does not belong to this class', undefined, 'SECTION_NOT_IN_CLASS');
  if (!(await ClassSubject.exists({ sessionId: exam.sessionId, classId: input.classId, subjectId: input.subjectId })))
    throw AppError.badRequest('This subject is not taught in the class', undefined, 'SUBJECT_NOT_IN_CLASS');

  const sectionKey = input.sectionId ?? null;
  const sameDay: any[] = await ExamRoutineEntry.find({ examId: input.examId, date: input.date }).lean();
  const others = sameDay.filter(
    (e) =>
      !(
        String(e.classId) === input.classId &&
        String(e.sectionId ?? null) === String(sectionKey) &&
        String(e.subjectId) === input.subjectId
      ) && overlaps(e, input),
  );

  const sameClassAudience = (e: any) =>
    String(e.classId) === input.classId &&
    (!e.sectionId || !sectionKey || String(e.sectionId) === String(sectionKey));
  if (others.some(sameClassAudience))
    throw AppError.conflict('Students of this class already have another paper at that time', 'TIME_CLASH');
  if (input.room && others.some((e) => e.room && e.room.toLowerCase() === input.room!.toLowerCase()))
    throw AppError.conflict('That room is already used by another paper at that time', 'ROOM_CLASH');

  const entry = await ExamRoutineEntry.findOneAndUpdate(
    { examId: input.examId, classId: input.classId, sectionId: sectionKey, subjectId: input.subjectId },
    { $set: { date: input.date, startTime: input.startTime, endTime: input.endTime, room: input.room ?? null } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  await writeAudit({ action: 'examRoutine.save', entityType: 'ExamRoutineEntry', entityId: entry._id, after: input });
  return entry;
};

export const remove = async (id: string) => {
  const entry = await ExamRoutineEntry.findByIdAndDelete(id);
  if (!entry) throw AppError.notFound('Routine entry not found');
  await writeAudit({ action: 'examRoutine.remove', entityType: 'ExamRoutineEntry', entityId: entry._id });
  return { deleted: true };
};
