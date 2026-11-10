import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './admitCard.service';
import * as v from './admitCard.validation';

const router = Router();
router.use(authenticate(), roleGuard(ROLE.ADMIN));

router.get('/config', catchAsync(async (_req, res) => ok(res, await svc.getConfig())));

router.put(
  '/config',
  validateRequest({ body: v.configBody }),
  catchAsync(async (req, res) => ok(res, await svc.saveConfig(req.body))),
);

router.get(
  '/eligibility',
  validateRequest({ query: v.eligibilityQuery }),
  catchAsync(async (req, res) => ok(res, await svc.eligibility(req.query as any))),
);

/** Print-ready admit cards: /admit-cards/students.pdf?examId=...&sectionId=... (or &studentIds=a,b,c) */
router.get(
  '/students.pdf',
  validateRequest({ query: v.printQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const { pdf, count, blocked } = await svc.renderAdmitCards(q, q.locale);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="admit-cards.pdf"');
    res.setHeader('x-card-count', String(count));
    res.setHeader('x-blocked-count', String(blocked));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

export const admitCardRoutes = router;
