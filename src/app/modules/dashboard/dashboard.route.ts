import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { requireAuth } from '../../lib/requireAuth';
import { ok } from '../../lib/sendResponse';
import { ROLE } from '../../lib/roles';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { adminOverview } from './dashboard.overview';
import { summaryFor } from './dashboard.service';

const router = Router();
router.use(authenticate());
router.get(
  '/summary',
  catchAsync(async (req, res) => ok(res, await summaryFor(requireAuth(req)))),
);

router.get(
  '/overview',
  roleGuard(ROLE.ADMIN),
  catchAsync(async (_req, res) => ok(res, await adminOverview())),
);

export const dashboardRoutes = router;
