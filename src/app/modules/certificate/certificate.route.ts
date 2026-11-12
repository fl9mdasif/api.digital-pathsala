import { Router } from 'express';
import { catchAsync } from '../../lib/catchAsync';
import { ROLE } from '../../lib/roles';
import { created, ok } from '../../lib/sendResponse';
import { authenticate, roleGuard } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validateRequest';
import { CERTIFICATE_PLACEHOLDERS } from './certificate.model';
import * as svc from './certificate.service';
import * as v from './certificate.validation';

const router = Router();
router.use(authenticate(), roleGuard(ROLE.ADMIN));

router.get('/config', catchAsync(async (_req, res) => ok(res, { config: await svc.getConfig(), placeholders: CERTIFICATE_PLACEHOLDERS, defaults: svc.DEFAULT_BODY })));
router.put('/config', validateRequest({ body: v.configBody }), catchAsync(async (req, res) => ok(res, await svc.saveConfig(req.body))));

/** Students who completed a class in a session, for the Generate page. */
router.get('/candidates', validateRequest({ query: v.candidatesQuery }), catchAsync(async (req, res) => ok(res, await svc.candidates(req.query as any))));

/** /certificates/print.pdf?ids=a,b[&layout=royal][&locale=en], or ?sample=true for the settings preview. */
router.get(
  '/print.pdf',
  validateRequest({ query: v.printQuery }),
  catchAsync(async (req, res) => {
    const q = req.query as any;
    const { pdf, count } = q.sample ? await svc.printSample(q) : await svc.printRecords(q.ids, q);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="certificate.pdf"');
    res.setHeader('x-card-count', String(count));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

router.post('/', validateRequest({ body: v.issueBody }), catchAsync(async (req, res) => created(res, await svc.issue(req.body))));

router.get(
  '/',
  validateRequest({ query: v.listQuery }),
  catchAsync(async (req, res) => {
    const { rows, meta } = await svc.list(req.query as any);
    ok(res, rows, meta);
  }),
);

router.patch('/:id', validateRequest({ params: v.idParams, body: v.updateBody }), catchAsync(async (req, res) => ok(res, await svc.update(req.params.id as string, req.body))));

export const certificateRoutes = router;
