import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { requireAuth } from '../../lib/requireAuth';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './classRoutine.service';
import * as v from './classRoutine.validation';

const router = Router();
router.use(authenticate());

router.get(
  '/',
  roleGuard(ROLE.ADMIN, ROLE.TEACHER, ROLE.ACCOUNTANT),
  validateRequest({ query: v.sectionQuery }),
  catchAsync(async (req, res) => ok(res, await svc.forSection((req.query as any).sectionId))),
);

router.get(
  '/me',
  roleGuard(ROLE.TEACHER),
  catchAsync(async (req, res) => ok(res, await svc.forTeacher(requireAuth(req)))),
);

router.put(
  '/slot',
  roleGuard(ROLE.ADMIN),
  validateRequest({ body: v.slotBody }),
  catchAsync(async (req, res) => ok(res, await svc.saveSlot(req.body))),
);

router.delete(
  '/slot',
  roleGuard(ROLE.ADMIN),
  validateRequest({ query: v.slotKey }),
  catchAsync(async (req, res) => ok(res, await svc.removeSlot(req.query as any))),
);

export const classRoutineRoutes = router;
