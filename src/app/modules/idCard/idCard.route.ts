import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { STUDENT_PLACEHOLDERS } from '../../lib/fillTemplate';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { teacherPrintScope } from '../../middlewares/printScope';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './idCard.service';
import * as v from './idCard.validation';

const router = Router();
router.use(authenticate());

/** Settings are for admins. */
router.get('/config', roleGuard(ROLE.ADMIN), catchAsync(async (_req, res) => ok(res, { config: await svc.getConfig(), placeholders: STUDENT_PLACEHOLDERS })));

router.put(
  '/config',
  roleGuard(ROLE.ADMIN),
  validateRequest({ body: v.configBody }),
  catchAsync(async (req, res) => ok(res, await svc.saveConfig(req.body))),
);

/**
 * Print-ready A4 sheets, 8 cards per page:
 * /id-cards/students.pdf?sectionId=...[&group=science][&part=front|back|both][&design=classic] or ?studentIds=a,b,c.
 * `sample=true` prints one made-up card for the settings preview.
 */
router.get(
  '/students.pdf',
  roleGuard(ROLE.ADMIN, ROLE.TEACHER),
  teacherPrintScope,
  validateRequest({ query: v.printQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const { pdf, count } = await svc.renderCards(
      { sectionId: q.sectionId, studentIds: q.studentIds, group: q.group, part: q.part, design: q.design, sample: q.sample },
      q.locale,
    );
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="id-cards.pdf"');
    res.setHeader('x-card-count', String(count));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

export const idCardRoutes = router;
