import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { idParams } from '../../lib/objectId';
import { buildMeta } from '../../lib/pagination';
import { ROLE } from '../../lib/roles';
import { ok } from '../../lib/sendResponse';
import {
  admissionApplyLimiter,
  admissionLookupLimiter,
  admissionUploadLimiter,
  resultLookupHourLimiter,
  resultLookupMinuteLimiter,
} from '../../middlewares/rateLimit';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import * as svc from './admission.service';
import * as v from './admission.validation';

// ---------- admin: /api/v1/admissions ----------
const router = Router();
router.use(authenticate(), roleGuard(ROLE.ADMIN));

router.get(
  '/',
  validateRequest({ query: v.listQuery }),
  catchAsync(async (req, res) => {
    const { page, limit, status, classId, q } = req.query as any;
    const { rows, total, byStatus } = await svc.list({ page, limit }, { status, classId, q });
    ok(res, rows, { ...buildMeta({ page, limit }, total), counts: byStatus } as ReturnType<typeof buildMeta>);
  }),
);
router.get('/:id', validateRequest({ params: idParams }), catchAsync(async (req, res) => ok(res, await svc.get(req.params.id as string))));
router.patch(
  '/:id/status',
  validateRequest({ params: idParams, body: v.decisionBody }),
  catchAsync(async (req, res) => ok(res, await svc.decide(req.params.id as string, req.auth!.userId, req.body))),
);
router.patch('/:id', validateRequest({ params: idParams, body: v.updateBody }), catchAsync(async (req, res) => ok(res, await svc.update(req.params.id as string, req.body))));
router.post('/:id/photo/approve', validateRequest({ params: idParams }), catchAsync(async (req, res) => ok(res, await svc.decidePhoto(req.params.id as string, true))));
router.post('/:id/photo/reject', validateRequest({ params: idParams }), catchAsync(async (req, res) => ok(res, await svc.decidePhoto(req.params.id as string, false))));
router.post(
  '/:id/confirm',
  validateRequest({ params: idParams, body: v.confirmBody }),
  catchAsync(async (req, res) => ok(res, await svc.confirm(req.params.id as string, req.auth!.userId, req.body), undefined, 201)),
);

export const admissionRoutes = router;

// ---------- public: /api/v1/public/schools/:slug/admissions (tenant already resolved) ----------
const pub = Router({ mergeParams: true });
const noStore = (res: any) => res.setHeader('Cache-Control', 'no-store');

pub.get('/classes', catchAsync(async (_req, res) => ok(res, await svc.admissionClasses())));
pub.post('/', admissionApplyLimiter, validateRequest({ body: v.applyBody }), catchAsync(async (req, res) => ok(res, await svc.apply(req.body), undefined, 201)));
pub.post(
  '/status',
  resultLookupMinuteLimiter,
  resultLookupHourLimiter,
  admissionLookupLimiter,
  validateRequest({ body: v.lookupBody }),
  catchAsync(async (req, res) => {
    noStore(res);
    ok(res, await svc.lookup(req.body));
  }),
);
pub.post(
  '/photo',
  resultLookupMinuteLimiter,
  admissionLookupLimiter,
  validateRequest({ body: v.photoChangeBody }),
  catchAsync(async (req, res) => {
    noStore(res);
    ok(res, await svc.requestPhotoChange(req.body));
  }),
);
pub.post(
  '/upload-sign',
  admissionUploadLimiter,
  catchAsync(async (_req, res) => {
    noStore(res);
    ok(res, await svc.signPhotoUpload());
  }),
);

export const publicAdmissionRoutes = pub;
