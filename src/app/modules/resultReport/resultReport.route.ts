import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { requireAuth } from '../../lib/requireAuth';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import { examParams } from '../exam/exam.validation';
import * as svc from './resultReport.service';
import * as v from './resultReport.validation';

const router = Router();
router.use(authenticate(), roleGuard(ROLE.ADMIN, ROLE.TEACHER));
const id = (req: any) => req.params.id as string;

router.get(
  '/:id/fail-list',
  validateRequest({ params: examParams, query: v.failListQuery }),
  catchAsync(async (req, res) => ok(res, await svc.failList(requireAuth(req), id(req), req.query as any))),
);

router.get(
  '/:id/tabulation',
  validateRequest({ params: examParams, query: v.tabulationQuery }),
  catchAsync(async (req, res) => ok(res, await svc.tabulation(requireAuth(req), id(req), req.query as any))),
);

router.get(
  '/:id/tabulation.pdf',
  validateRequest({ params: examParams, query: v.tabulationQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const pdf = await svc.tabulationPdf(requireAuth(req), id(req), q, q.locale);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="tabulation-sheet.pdf"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

export const resultReportRoutes = router;
