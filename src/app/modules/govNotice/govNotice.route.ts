import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { buildMeta } from '../../lib/pagination';
import { created, ok } from '../../lib/sendResponse';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './govNotice.service';
import * as v from './govNotice.validation';

/** Platform owner console: mounted under /platform (already behind platformGuard). */
export const govNoticeAdminRoutes = Router();
govNoticeAdminRoutes.get(
  '/',
  validateRequest({ query: v.listGovNoticesQuery }),
  catchAsync(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { rows, total } = await svc.list({ page, limit });
    ok(res, rows, buildMeta({ page, limit }, total));
  }),
);
govNoticeAdminRoutes.post(
  '/',
  validateRequest({ body: v.createGovNoticeBody }),
  catchAsync(async (req, res) => created(res, await svc.create(req.body))),
);
govNoticeAdminRoutes.patch(
  '/:id',
  validateRequest({ params: v.govNoticeIdParams, body: v.updateGovNoticeBody }),
  catchAsync(async (req, res) => ok(res, await svc.update(String(req.params.id), req.body))),
);
govNoticeAdminRoutes.delete(
  '/:id',
  validateRequest({ params: v.govNoticeIdParams }),
  catchAsync(async (req, res) => ok(res, await svc.remove(String(req.params.id)))),
);

/** Public: mounted under /public/gov-notices (behind publicLimiter). */
export const publicGovNoticeRoutes = Router();
publicGovNoticeRoutes.get(
  '/',
  validateRequest({ query: v.publicGovNoticesQuery }),
  catchAsync(async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    ok(res, await svc.latest((req.query as unknown as { limit: number }).limit));
  }),
);
