import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { toCsv } from '../../lib/csv';
import { loadExam } from '../exam/exam.service';
import { scopeFor, teacherEnrolmentFilter, linkedStudentIds } from '../student/student.access';
import { Student } from '../student/student.model';
import { Exam } from '../exam/exam.model';
import { Result } from './result.model';
import { ClassModel } from '../class/class.model';

interface Auth {
  userId: Types.ObjectId;
  role: string;
}

export const teacherFilter = async (auth: Auth) => {
  const scope = await scopeFor(auth);
  return scope.kind === 'teacher' ? teacherEnrolmentFilter(scope.pairs) : {};
};

const distribution = (rows: any[]) => {
  const dist: Record<string, number> = {};
  for (const r of rows) {
    const k = r.passed ? (r.gpa !== undefined && r.gpa !== null ? r.letter : r.letter) : 'Fail';
    dist[k] = (dist[k] ?? 0) + 1;
  }
  return dist;
};

export const listResults = async (
  auth: Auth,
  examId: string,
  f: { classId?: string; sectionId?: string },
) => {
  const exam = await loadExam(examId);
  const filter: Record<string, any> = { examId: exam._id, ...(await teacherFilter(auth)) };
  if (f.classId) filter.classId = f.classId;
  if (f.sectionId) filter.sectionId = f.sectionId;
  const rows = await Result.find(filter).sort({ classId: 1, positionInClass: 1, roll: 1 }).lean();
  const names = new Map(
    (
      await Student.find({ _id: { $in: rows.map((r: any) => r.studentId) } })
        .select('name studentId')
        .lean()
    ).map((s: any) => [String(s._id), s]),
  );
  const passed = rows.filter((r: any) => r.passed).length;
  return {
    exam: { id: exam._id, name: exam.name, status: exam.status, resultVersion: exam.resultVersion },
    summary: {
      students: rows.length,
      passed,
      failed: rows.length - passed,
      passRate: rows.length ? Math.round((passed / rows.length) * 10000) / 100 : null,
      distribution: distribution(rows),
    },
    results: rows.map((r: any) => ({
      ...r,
      name: (names.get(String(r.studentId)) as any)?.name,
      studentCode: (names.get(String(r.studentId)) as any)?.studentId,
    })),
  };
};

export const meritList = async (auth: Auth, examId: string, classId: string, csv: boolean) => {
  const exam = await loadExam(examId);
  const rows = await Result.find({ examId: exam._id, classId, ...(await teacherFilter(auth)) })
    .sort({ positionInClass: 1, roll: 1 })
    .lean();
  const names = new Map(
    (
      await Student.find({ _id: { $in: rows.map((r: any) => r.studentId) } })
        .select('name studentId')
        .lean()
    ).map((s: any) => [String(s._id), s]),
  );
  const list = rows.map((r: any) => ({
    position: r.positionInClass,
    roll: r.roll,
    name: (names.get(String(r.studentId)) as any)?.name,
    studentCode: (names.get(String(r.studentId)) as any)?.studentId,
    total: r.totalMarks,
    percent: r.percent,
    gpa: r.gpa,
    letter: r.letter,
    passed: r.passed,
  }));
  if (!csv) return { list };
  const cls = (await ClassModel.findById(classId).select('name').lean()) as any;
  return {
    csv: toCsv(
      ['position', 'roll', 'name', 'studentId', 'totalMarks', 'percent', 'gpa', 'grade', 'result'],
      list.map((l) => [
        l.position,
        l.roll,
        l.name,
        l.studentCode,
        l.total,
        l.percent,
        l.gpa ?? '',
        l.letter,
        l.passed ? 'Passed' : 'Failed',
      ]),
    ),
    filename: `merit-${(cls?.name ?? 'class').replace(/\W+/g, '-')}.csv`,
  };
};

/** Published results of the linked students only. Drafts never leave the staff side. */
export const myResults = async (auth: Auth) => {
  const ids = await linkedStudentIds(auth);
  const rows = await Result.find({ studentId: { $in: ids }, status: 'published' })
    .sort({ publishedAt: -1 })
    .lean();
  const exams = new Map(
    (
      await Exam.find({ _id: { $in: rows.map((r: any) => r.examId) } })
        .select('name')
        .lean()
    ).map((e: any) => [String(e._id), e.name]),
  );
  return rows.map((r: any) => ({ ...r, examName: exams.get(String(r.examId)) }));
};

export const getPublishedResultFor = async (auth: Auth, examId: string, studentId: string) => {
  const ids = await linkedStudentIds(auth);
  if (!ids.some((id) => id.equals(studentId))) throw AppError.notFound('Result not found');
  const r = await Result.findOne({ examId, studentId, status: 'published' }).lean();
  if (!r) throw AppError.notFound('Result not found');
  return r;
};

/** Every result of one student for staff screens (admin sees drafts too, marked by status). */
export const resultsOfStudent = async (studentId: string) => {
  const rows = await Result.find({ studentId }).sort({ createdAt: -1 }).lean();
  const exams = new Map(
    (
      await Exam.find({ _id: { $in: rows.map((r: any) => r.examId) } })
        .select('name')
        .lean()
    ).map((e: any) => [String(e._id), e.name]),
  );
  return rows.map((r: any) => ({ ...r, examName: exams.get(String(r.examId)) }));
};
