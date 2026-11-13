import { z } from 'zod';
import { mediaUrl } from '../../lib/mediaUrl';
import { SITE_PAGE_KEYS } from './sitePage.model';

export const sitePageKeyParams = z.strictObject({ key: z.enum(SITE_PAGE_KEYS) });
/** The public route sits under /schools/:slug, so its params carry the slug too. */
export const publicSitePageParams = z.strictObject({ slug: z.string(), key: z.enum(SITE_PAGE_KEYS) });

export const saveSitePageBody = z.strictObject({
  title: z.string().trim().min(2).max(150),
  titleEn: z.string().trim().max(150).optional(),
  body: z.string().max(30000).default(''),
  attachments: z.array(z.strictObject({ url: mediaUrl, name: z.string().trim().min(1).max(120) })).max(10).default([]),
  isPublished: z.boolean().default(false),
});
