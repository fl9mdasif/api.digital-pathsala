import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { requireAuth } from '../../lib/requireAuth';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './teacherAttendance.service';
import * as v from './teacherAttendance.validation';

const router = Router();
router.use(authenticate());

const admin = roleGuard(ROLE.ADMIN);

router.get('/config', admin, catchAsync(async (_req, res) => ok(res, await svc.getConfig())));

router.put(
  '/config',
  admin,
  validateRequest({ body: v.configBody }),
  catchAsync(async (req, res) => ok(res, await svc.saveConfig(req.body))),
);

router.get(
  '/sheet',
  admin,
  validateRequest({ query: v.sheetQuery }),
  catchAsync(async (req, res) => ok(res, await svc.getSheet((req.query as any).date))),
);

router.post(
  '/',
  admin,
  validateRequest({ body: v.submitBody }),
  catchAsync(async (req, res) => ok(res, await svc.submitSheet(requireAuth(req), req.body))),
);

router.get(
  '/report',
  admin,
  validateRequest({ query: v.reportQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    ok(res, await svc.report(q.from, q.to, q.employeeId));
  }),
);

router.get(
  '/me',
  roleGuard(ROLE.TEACHER, ROLE.ACCOUNTANT),
  validateRequest({ query: v.meQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    ok(res, await svc.myReport(requireAuth(req), q.from, q.to));
  }),
);

export const teacherAttendanceRoutes = router;
