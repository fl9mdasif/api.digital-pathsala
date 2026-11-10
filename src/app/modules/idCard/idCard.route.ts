import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './idCard.service';
import * as v from './idCard.validation';

const router = Router();
router.use(authenticate(), roleGuard(ROLE.ADMIN));

router.get('/config', catchAsync(async (_req, res) => ok(res, await svc.getConfig())));

router.put(
  '/config',
  validateRequest({ body: v.configBody }),
  catchAsync(async (req, res) => ok(res, await svc.saveConfig(req.body))),
);

/** Print-ready A4 sheets, 8 cards per page: /id-cards/students.pdf?sectionId=... or ?studentIds=a,b,c */
router.get(
  '/students.pdf',
  validateRequest({ query: v.printQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const { pdf, count } = await svc.renderCards({ sectionId: q.sectionId, studentIds: q.studentIds }, q.locale);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="id-cards.pdf"');
    res.setHeader('x-card-count', String(count));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

export const idCardRoutes = router;
