import { Router } from 'express';
import { z } from 'zod';
import { catchAsync } from '../../lib/catchAsync';
import { buildMeta, paginationQuery } from '../../lib/pagination';
import { normalizeBdPhone } from '../../lib/phone';
import { ok } from '../../lib/sendResponse';
import { inquiryLimiter, publicLimiter, resultLookupHourLimiter, resultLookupMinuteLimiter } from '../../middlewares/rateLimit';
import { objectIdSchema } from '../../lib/objectId';
import { tenantResolver } from '../../middlewares/tenantResolver';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './publicApi.service';
import { publicResultRoutes } from '../publicResult/publicResult.route';
import { publishedExams } from '../publicResult/publicResult.service';

const router = Router();
router.use(publicLimiter);

const inquiryBody = z.strictObject({
  name: z.string().trim().min(2).max(100),
  phone: z.string().transform((v, ctx) => {
    const n = normalizeBdPhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid Bangladesh mobile number' });
    return n ?? v;
  }),
  message: z.string().trim().max(1000).optional(),
  classInterest: z.string().trim().max(60).optional(),
  website: z.string().max(200).optional(), // honeypot
});

const cacheShort = (res: any) => res.setHeader('Cache-Control', 'public, max-age=60');

// Platform level (no tenant)
router.get(
  '/platform/plans',
  catchAsync(async (_req, res) => ok(res, await svc.publicPlans())),
);
router.get(
  '/platform/find-school',
  validateRequest({ query: z.strictObject({ q: z.string().trim().min(2).max(60) }) }),
  catchAsync(async (req, res) => ok(res, await svc.findSchools((req.query as any).q))),
);

// Tenant level, resolved from the slug in the path
const school = Router({ mergeParams: true });
school.use(tenantResolver);
school.get(
  '/',
  catchAsync(async (_req, res) => {
    cacheShort(res);
    ok(res, await svc.getSite());
  }),
);
school.get(
  '/notices',
  validateRequest({ query: z.strictObject(paginationQuery) }),
  catchAsync(async (req, res) => {
    const { page, limit } = req.query as any;
    const { rows, total } = await svc.listPublicNotices({ page, limit });
    cacheShort(res);
    ok(res, rows, buildMeta({ page, limit }, total));
  }),
);
school.get(
  '/staff',
  catchAsync(async (_req, res) => {
    cacheShort(res);
    ok(res, await svc.listPublicStaff());
  }),
);
school.get(
  '/stats',
  catchAsync(async (_req, res) => {
    cacheShort(res);
    ok(res, await svc.publicStats());
  }),
);
school.get(
  '/classes',
  catchAsync(async (_req, res) => {
    cacheShort(res);
    ok(res, await svc.publicClasses());
  }),
);
school.get(
  '/routine',
  validateRequest({ query: z.strictObject({ sectionId: objectIdSchema }) }),
  catchAsync(async (req, res) => {
    cacheShort(res);
    ok(res, await svc.publicRoutine((req.query as any).sectionId));
  }),
);
school.post(
  '/fees/lookup',
  resultLookupMinuteLimiter,
  resultLookupHourLimiter,
  validateRequest({ body: z.strictObject({ studentId: z.string().trim().min(1).max(30), phone: z.string().trim().min(5).max(20) }) }),
  catchAsync(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await svc.publicFeeLookup(req.body));
  }),
);
school.post(
  '/inquiries',
  inquiryLimiter,
  validateRequest({ body: inquiryBody }),
  catchAsync(async (req, res) => ok(res, await svc.submitInquiry(req.body), undefined, 201)),
);
school.get(
  '/exams',
  catchAsync(async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=30');
    ok(res, await publishedExams());
  }),
);
school.use('/results', publicResultRoutes);
router.use('/schools/:slug', school);

export const publicRoutes = router;
export { school as publicSchoolRouter };
