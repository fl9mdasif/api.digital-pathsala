import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { teacherPrintScope } from '../../middlewares/printScope';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './seatPlan.service';
import * as v from './seatPlan.validation';

const router = Router();
router.use(authenticate(), roleGuard(ROLE.ADMIN, ROLE.TEACHER), teacherPrintScope);

/** The seat list as data: /seat-plans/assign?examId=...&sectionId=...[&room=Hall&seatsPerRoom=30&startSeat=1] */
router.get('/assign', validateRequest({ query: v.assignQuery }), catchAsync(async (req, res) => ok(res, await svc.assign(req.query as any))));

/** Print-ready seat cards, 12 to an A4 page: the same query plus [&design=band|framed|mono][&color=#1b4b8a][&photo=true]. */
router.get(
  '/students.pdf',
  validateRequest({ query: v.printQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const { pdf, count } = await svc.renderSeatPlan(q, q.locale);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="seat-plan.pdf"');
    res.setHeader('x-card-count', String(count));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

export const seatPlanRoutes = router;
