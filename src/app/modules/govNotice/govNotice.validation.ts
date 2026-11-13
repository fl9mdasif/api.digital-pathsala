import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination';
import { GOV_SOURCES } from './govNotice.model';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), 'Use a web address');

export const createGovNoticeBody = z.strictObject({
  title: z.string().trim().min(3).max(200),
  source: z.enum(GOV_SOURCES),
  url: httpsUrl,
  publishedOn: date,
  pinned: z.boolean().optional(),
});
export const updateGovNoticeBody = createGovNoticeBody.partial();
export const govNoticeIdParams = z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/i) });
export const listGovNoticesQuery = z.strictObject({ ...paginationQuery });
export const publicGovNoticesQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(20).default(8) });
