import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { requireAuth } from '../lib/requireAuth';
import { Enrolment } from '../modules/enrolment/enrolment.model';
import { currentSession } from '../modules/enrolment/enrolment.service';
import { Section } from '../modules/section/section.model';
import { teacherPairs } from '../modules/student/student.access';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);

/**
 * Lets a teacher print cards only for their own classes (the classes and sections they teach or are class teacher of,
 * worked out on the server). Admins pass straight through. A teacher cannot print samples or override a fee hold.
 * Malformed ids fall through so the route's own validation answers 400.
 */
export const teacherPrintScope = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const auth = requireAuth(req);
    if (auth.role !== 'teacher') return next();
    const q = req.query as Record<string, unknown>;
    const forbidden = () => AppError.forbidden('You can only print for your own classes');
    if (q.sample === 'true' || q.includeBlocked === 'true') throw forbidden();

    const sectionId = q.sectionId ? String(q.sectionId) : '';
    const studentIds = q.studentIds ? ids(q.studentIds) : [];
    if (!sectionId && studentIds.length === 0) throw forbidden();
    if ((sectionId && !OBJECT_ID.test(sectionId)) || studentIds.some((i) => !OBJECT_ID.test(i))) return next();

    const pairs = await teacherPairs(auth.userId);
    const allowed = (classId: unknown, secId: unknown) => pairs.some((p) => String(p.classId) === String(classId) && (!p.sectionId || String(p.sectionId) === String(secId ?? '')));

    if (sectionId) {
      const section: any = await Section.findById(sectionId).select('classId').lean();
      if (!section || !allowed(section.classId, sectionId)) throw forbidden();
    }
    if (studentIds.length > 0) {
      const session = await currentSession();
      const rows: any[] = await Enrolment.find({ sessionId: session._id, studentId: { $in: studentIds }, status: 'active' }).select('studentId classId sectionId').lean();
      if (rows.length !== new Set(studentIds).size || rows.some((r) => !allowed(r.classId, r.sectionId))) throw forbidden();
    }
    next();
  } catch (err) {
    next(err);
  }
};
