import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import type { TSitePageKey } from './sitePage.model';
import * as svc from './sitePage.service';
import * as v from './sitePage.validation';

/** Admin: /site-pages */
export const sitePageRoutes = Router();
sitePageRoutes.use(authenticate(), roleGuard(ROLE.ADMIN));
sitePageRoutes.get('/', catchAsync(async (_req, res) => ok(res, await svc.list())));
sitePageRoutes.get(
  '/:key',
  validateRequest({ params: v.sitePageKeyParams }),
  catchAsync(async (req, res) => ok(res, await svc.get(req.params.key as TSitePageKey))),
);
sitePageRoutes.put(
  '/:key',
  validateRequest({ params: v.sitePageKeyParams, body: v.saveSitePageBody }),
  catchAsync(async (req, res) => ok(res, await svc.save(req.params.key as TSitePageKey, req.body))),
);
sitePageRoutes.delete(
  '/:key',
  validateRequest({ params: v.sitePageKeyParams }),
  catchAsync(async (req, res) => ok(res, await svc.remove(req.params.key as TSitePageKey))),
);

/** Public: mounted on the school router, /public/schools/:slug/pages */
export const publicSitePageRoutes = Router({ mergeParams: true });
publicSitePageRoutes.get(
  '/',
  catchAsync(async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    ok(res, await svc.publishedIndex());
  }),
);
publicSitePageRoutes.get(
  '/:key',
  validateRequest({ params: v.publicSitePageParams }),
  catchAsync(async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    ok(res, await svc.publishedPage(req.params.key as TSitePageKey));
  }),
);
