import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './teacherIdCard.service';
import * as v from './teacherIdCard.validation';

const router = Router();
router.use(authenticate(), roleGuard(ROLE.ADMIN));

router.get('/config', catchAsync(async (_req, res) => ok(res, { config: await svc.getConfig(), placeholders: svc.TEACHER_PLACEHOLDERS })));

router.put('/config', validateRequest({ body: v.configBody }), catchAsync(async (req, res) => ok(res, await svc.saveConfig(req.body))));

/** /teacher-id-cards/staff.pdf[?employeeIds=a,b][&departmentId=...][&part=...][&design=...][&sample=true] */
router.get(
  '/staff.pdf',
  validateRequest({ query: v.printQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const { pdf, count } = await svc.renderCards(
      { employeeIds: q.employeeIds, departmentId: q.departmentId, part: q.part, design: q.design, sample: q.sample },
      q.locale,
    );
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="staff-id-cards.pdf"');
    res.setHeader('x-card-count', String(count));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

export const teacherIdCardRoutes = router;
