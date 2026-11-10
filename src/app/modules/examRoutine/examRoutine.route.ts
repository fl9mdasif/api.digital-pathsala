import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { idParams } from '../../lib/objectId';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './examRoutine.service';
import * as v from './examRoutine.validation';

const router = Router();
router.use(authenticate());

router.get(
  '/',
  roleGuard(ROLE.ADMIN, ROLE.TEACHER, ROLE.ACCOUNTANT),
  validateRequest({ query: v.listQuery }),
  catchAsync(async (req, res) => ok(res, await svc.list(req.query as any))),
);

router.put(
  '/entry',
  roleGuard(ROLE.ADMIN),
  validateRequest({ body: v.entryBody }),
  catchAsync(async (req, res) => ok(res, await svc.save(req.body))),
);

router.delete(
  '/entry/:id',
  roleGuard(ROLE.ADMIN),
  validateRequest({ params: idParams }),
  catchAsync(async (req, res) => ok(res, await svc.remove(req.params.id as string))),
);

export const examRoutineRoutes = router;
