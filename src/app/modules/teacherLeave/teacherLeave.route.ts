import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { idParams } from '../../lib/objectId';
import { requireAuth } from '../../lib/requireAuth';
import { ROLE } from '../../lib/roles';
import { created, ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './teacherLeave.service';
import * as v from './teacherLeave.validation';

const router = Router();
router.use(authenticate());

const admin = roleGuard(ROLE.ADMIN);
const staff = roleGuard(ROLE.ADMIN, ROLE.TEACHER, ROLE.ACCOUNTANT);

router.get('/config', admin, catchAsync(async (_req, res) => ok(res, await svc.getAllowances())));
router.put(
  '/config',
  admin,
  validateRequest({ body: v.configBody }),
  catchAsync(async (req, res) => ok(res, await svc.saveAllowances(req.body))),
);

router.get(
  '/',
  admin,
  validateRequest({ query: v.listQuery }),
  catchAsync(async (req, res) => {
    const r = await svc.list(req.query as any);
    ok(res, r.rows, r.meta);
  }),
);

router.get(
  '/balance',
  admin,
  validateRequest({ query: v.balanceQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    ok(res, await svc.balance(q.employeeId, q.year));
  }),
);

router.get(
  '/me',
  roleGuard(ROLE.TEACHER, ROLE.ACCOUNTANT),
  catchAsync(async (req, res) => ok(res, await svc.mine(requireAuth(req)))),
);

router.post(
  '/',
  staff,
  validateRequest({ body: v.applyBody }),
  catchAsync(async (req, res) => created(res, await svc.apply(requireAuth(req), req.body))),
);

router.patch(
  '/:id/decision',
  admin,
  validateRequest({ params: idParams, body: v.decisionBody }),
  catchAsync(async (req, res) => ok(res, await svc.decide(requireAuth(req), req.params.id as string, req.body))),
);

router.patch(
  '/:id/cancel',
  staff,
  validateRequest({ params: idParams }),
  catchAsync(async (req, res) => ok(res, await svc.cancel(requireAuth(req), req.params.id as string))),
);

export const teacherLeaveRoutes = router;
