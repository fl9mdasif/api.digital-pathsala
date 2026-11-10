import { Router, type Response } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { requireAuth } from '../../lib/requireAuth';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { teacherPrintScope } from '../../middlewares/printScope';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './admitCard.service';
import * as v from './admitCard.validation';

const sendPdf = (res: Response, pdf: Buffer, name: string, count: number, blocked = 0) => {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="${name}"`);
  res.setHeader('x-card-count', String(count));
  res.setHeader('x-blocked-count', String(blocked));
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
};

const router = Router();
router.use(authenticate());
const admin = roleGuard(ROLE.ADMIN);
const staff = roleGuard(ROLE.ADMIN, ROLE.TEACHER);

router.get('/config', admin, catchAsync(async (_req, res) => ok(res, await svc.getConfig())));

router.put('/config', admin, validateRequest({ body: v.configBody }), catchAsync(async (req, res) => ok(res, await svc.saveConfig(req.body))));

/** Fee lockdown, one optional rule per exam. */
router.get('/lock-rules', admin, catchAsync(async (_req, res) => ok(res, await svc.listLockRules())));
router.put(
  '/lock-rules/:examId',
  admin,
  validateRequest({ params: v.lockRuleParams, body: v.lockRuleBody }),
  catchAsync(async (req, res) => ok(res, await svc.saveLockRule(req.params.examId as string, req.body))),
);
router.delete(
  '/lock-rules/:examId',
  admin,
  validateRequest({ params: v.lockRuleParams }),
  catchAsync(async (req, res) => {
    await svc.deleteLockRule(req.params.examId as string);
    ok(res, { deleted: true });
  }),
);

router.get('/eligibility', staff, teacherPrintScope, validateRequest({ query: v.eligibilityQuery }), catchAsync(async (req, res) => ok(res, await svc.eligibility(req.query as any))));

/**
 * Print-ready admit cards: /admit-cards/students.pdf?examId=...&sectionId=... (or &studentIds=a,b,c)
 * [&design=classic][&perPage=2]. `sample=true` prints one made-up card for the settings preview.
 */
router.get(
  '/students.pdf',
  staff,
  teacherPrintScope,
  validateRequest({ query: v.printQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const { pdf, count, blocked } = await svc.renderAdmitCards(q, q.locale);
    sendPdf(res, pdf, 'admit-cards.pdf', count, blocked);
  }),
);

export const admitCardRoutes = router;

/** Student and guardian: /me/admit-cards and /me/admit-cards/:examId/:studentId.pdf. The fee lockdown always applies. */
const me = Router();
me.use(authenticate(), roleGuard(ROLE.STUDENT, ROLE.GUARDIAN));
me.get('/admit-cards', catchAsync(async (req, res) => ok(res, await svc.myAdmitCards(requireAuth(req)))));
me.get(
  '/admit-cards/:examId/:studentId.pdf',
  validateRequest({ params: v.meParams, query: v.meQuery }),
  catchAsync(async (req, res) => {
    const { pdf, count } = await svc.myAdmitCardPdf(requireAuth(req), req.params.examId as string, req.params.studentId as string, (req.query as any).locale);
    sendPdf(res, pdf, 'admit-card.pdf', count);
  }),
);
export const admitCardMeRoutes = me;
