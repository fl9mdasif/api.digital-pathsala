import type { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { createPdf, pdfToBuffer } from '../../lib/pdf';
import { requireTenantId } from '../../lib/tenantContext';
import { ClassModel } from '../class/class.model';
import { loadExam } from '../exam/exam.service';
import { Result } from '../result/result.model';
import { teacherFilter } from '../result/result.service';
import { Section } from '../section/section.model';
import { Student } from '../student/student.model';
import { Tenant } from '../tenant/tenant.model';

interface Auth {
  userId: Types.ObjectId;
  role: string;
}

const studentInfo = async (rows: any[]) =>
  new Map(
    (
      await Student.find({ _id: { $in: rows.map((r) => r.studentId) } })
        .select('name nameBn studentId')
        .lean()
    ).map((s: any) => [String(s._id), s]),
  );

/** Students who failed the exam, with the papers they failed. */
export const failList = async (auth: Auth, examId: string, f: { classId?: string; sectionId?: string }) => {
  const exam = await loadExam(examId);
  const scope: Record<string, any> = { examId: exam._id, ...(await teacherFilter(auth)) };
  if (f.classId) scope.classId = f.classId;
  if (f.sectionId) scope.sectionId = f.sectionId;
  const [rows, students_total]: [any[], number] = await Promise.all([
    Result.find({ ...scope, passed: false }).sort({ classId: 1, sectionId: 1, roll: 1 }).lean(),
    Result.countDocuments(scope),
  ]);
  const [students, classes, sections] = await Promise.all([
    studentInfo(rows),
    ClassModel.find({ _id: { $in: rows.map((r) => r.classId) } }).select('name').lean(),
    Section.find({ _id: { $in: rows.map((r) => r.sectionId).filter(Boolean) } }).select('name isDefault').lean(),
  ]);
  const className = new Map(classes.map((c: any) => [String(c._id), c.name]));
  const sectionName = new Map(sections.map((s: any) => [String(s._id), s.isDefault ? undefined : s.name]));

  return {
    exam: { id: exam._id, name: exam.name, status: exam.status },
    summary: {
      students: students_total,
      failed: rows.length,
      failRate: students_total ? Math.round((rows.length / students_total) * 10000) / 100 : null,
    },
    rows: rows.map((r) => {
      const s: any = students.get(String(r.studentId));
      const failed = (r.subjects ?? []).filter((x: any) => x.passed === false);
      return {
        studentId: r.studentId,
        studentCode: s?.studentId,
        name: s?.name,
        className: className.get(String(r.classId)),
        sectionName: r.sectionId ? sectionName.get(String(r.sectionId)) : undefined,
        roll: r.roll,
        totalMarks: r.totalMarks,
        gpa: r.gpa,
        failedSubjects: failed.map((x: any) => ({ subjectId: x.subjectId, name: x.name, total: x.total, fullMarks: x.fullMarks })),
      };
    }),
  };
};

/** One row per student, one column per subject, for a class or a single section. */
export const tabulation = async (auth: Auth, examId: string, f: { classId: string; sectionId?: string }) => {
  const exam = await loadExam(examId);
  const filter: Record<string, any> = { examId: exam._id, classId: f.classId, ...(await teacherFilter(auth)) };
  if (f.sectionId) filter.sectionId = f.sectionId;
  const rows: any[] = await Result.find(filter).sort({ positionInClass: 1, roll: 1 }).lean();
  if (rows.length === 0)
    throw AppError.notFound('No results yet. Calculate the exam results first.', 'NO_RESULTS');

  const [students, cls, section] = await Promise.all([
    studentInfo(rows),
    ClassModel.findById(f.classId).select('name nameBn').lean(),
    f.sectionId ? Section.findById(f.sectionId).select('name isDefault').lean() : null,
  ]);

  const subjects = new Map<string, { subjectId: string; name: string; fullMarks: number }>();
  for (const r of rows)
    for (const s of r.subjects ?? [])
      if (!subjects.has(String(s.subjectId)))
        subjects.set(String(s.subjectId), { subjectId: String(s.subjectId), name: s.name, fullMarks: s.fullMarks });

  return {
    exam: { id: exam._id, name: exam.name, status: exam.status },
    class: cls ? { name: (cls as any).name, nameBn: (cls as any).nameBn } : null,
    section: section && !(section as any).isDefault ? { name: (section as any).name } : null,
    subjects: [...subjects.values()],
    rows: rows.map((r) => {
      const s: any = students.get(String(r.studentId));
      const marks: Record<string, { total: number; letter: string; passed: boolean }> = {};
      for (const x of r.subjects ?? []) marks[String(x.subjectId)] = { total: x.total, letter: x.letter, passed: x.passed };
      return {
        position: r.positionInClass,
        roll: r.roll,
        name: s?.name,
        nameBn: s?.nameBn,
        studentCode: s?.studentId,
        marks,
        totalMarks: r.totalMarks,
        fullMarks: r.fullMarks,
        percent: r.percent,
        gpa: r.gpa,
        letter: r.letter,
        passed: r.passed,
      };
    }),
  };
};

const T = {
  en: { title: 'Tabulation Sheet', pos: 'Pos', roll: 'Roll', name: 'Name', total: 'Total', gpa: 'GPA', grade: 'Grade', result: 'Result', pass: 'Pass', fail: 'Fail', cls: 'Class', section: 'Section' },
  bn: { title: 'টেবুলেশন শিট', pos: 'মেধা', roll: 'রোল', name: 'নাম', total: 'মোট', gpa: 'জিপিএ', grade: 'গ্রেড', result: 'ফল', pass: 'পাস', fail: 'ফেল', cls: 'শ্রেণি', section: 'শাখা' },
} as const;

export const tabulationPdf = async (auth: Auth, examId: string, f: { classId: string; sectionId?: string }, locale: 'bn' | 'en') => {
  const [data, tenant] = await Promise.all([
    tabulation(auth, examId, f),
    Tenant.findById(requireTenantId()).select('name nameBn').lean(),
  ]);
  const t = T[locale];
  const doc = createPdf({ margin: 24, layout: 'landscape' });
  const X = 24;
  const W = doc.page.width - 48;
  const bottom = doc.page.height - 24;
  const fixed = [28, 28, 112, 40, 34, 34, 36]; // pos, roll, name, total, gpa, grade, result
  const subjectW = Math.min(56, (W - fixed.reduce((a, b) => a + b, 0)) / Math.max(data.subjects.length, 1));
  const colX: number[] = [];
  let cx = X;
  for (const w of fixed.slice(0, 3)) {
    colX.push(cx);
    cx += w;
  }
  const subjX = cx;
  cx += subjectW * data.subjects.length;
  for (const w of fixed.slice(3)) {
    colX.push(cx);
    cx += w;
  }
  const rowH = 14;

  const title = (locale === 'bn' && (tenant as any)?.nameBn) || (tenant as any)?.name || '';
  const header = () => {
    doc.fillColor('#111111').font('bold').fontSize(13).text(title, X, 22, { width: W, align: 'center' });
    const cls = locale === 'bn' ? (data.class?.nameBn ?? data.class?.name) : data.class?.name;
    doc.fontSize(10).text(`${t.title} - ${data.exam.name} - ${t.cls}: ${cls ?? ''}${data.section ? `   ${t.section}: ${data.section.name}` : ''}`, X, 40, { width: W, align: 'center' });
    const hy = 62;
    doc.rect(X, hy, W, 26).fill('#e9edf3');
    doc.fillColor('#111111').font('bold').fontSize(7);
    [t.pos, t.roll, t.name].forEach((h, k) => doc.text(h, colX[k] + 2, hy + 9, { width: fixed[k] - 4 }));
    data.subjects.forEach((s, k) => doc.text(s.name, subjX + k * subjectW + 1, hy + 3, { width: subjectW - 2, height: 20, align: 'center', ellipsis: true }));
    [t.total, t.gpa, t.grade, t.result].forEach((h, k) => doc.text(h, colX[3 + k] + 2, hy + 9, { width: fixed[3 + k] - 4 }));
    return hy + 30;
  };

  let y = header();
  doc.font('regular').fontSize(7);
  for (const r of data.rows) {
    if (y + rowH > bottom) {
      doc.addPage();
      y = header();
      doc.font('regular').fontSize(7);
    }
    doc.fillColor(r.passed ? '#111111' : '#b00020');
    doc.text(String(r.position ?? ''), colX[0] + 2, y, { width: fixed[0] - 4 });
    doc.text(String(r.roll), colX[1] + 2, y, { width: fixed[1] - 4 });
    doc.text((locale === 'bn' && r.nameBn) || r.name || '', colX[2] + 2, y, { width: fixed[2] - 4, height: 10, ellipsis: true });
    data.subjects.forEach((s, k) => {
      const m = r.marks[s.subjectId];
      doc.fillColor(m && m.passed === false ? '#b00020' : '#111111');
      doc.text(m ? String(m.total) : '-', subjX + k * subjectW, y, { width: subjectW, align: 'center' });
    });
    doc.fillColor(r.passed ? '#111111' : '#b00020');
    doc.text(String(r.totalMarks), colX[3] + 2, y, { width: fixed[3] - 4 });
    doc.text(r.gpa !== undefined && r.gpa !== null ? Number(r.gpa).toFixed(2) : '-', colX[4] + 2, y, { width: fixed[4] - 4 });
    doc.text(String(r.letter ?? ''), colX[5] + 2, y, { width: fixed[5] - 4 });
    doc.text(r.passed ? t.pass : t.fail, colX[6] + 2, y, { width: fixed[6] - 4 });
    doc.moveTo(X, y + rowH - 3).lineTo(X + W, y + rowH - 3).lineWidth(0.3).stroke('#cccccc');
    y += rowH;
  }
  return pdfToBuffer(doc);
};
