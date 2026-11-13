import { AppError } from '../../errors/AppError';
import { sanitizeRichText } from '../../lib/sanitizeHtml';
import { writeAudit } from '../auditLog/auditLog.model';
import { PublicSite } from '../publicSite/publicSite.model';
import { SitePage, type TSitePageKey } from './sitePage.model';

type TInput = { title: string; titleEn?: string; body: string; attachments: { url: string; name: string }[]; isPublished: boolean };

const toDto = (d: any) => ({
  key: d.key,
  title: d.title,
  titleEn: d.titleEn ?? '',
  body: d.body ?? '',
  attachments: d.attachments ?? [],
  isPublished: !!d.isPublished,
  updatedAt: d.updatedAt,
});

/** Admin list: every page the school has started, published or not. */
export const list = async () => (await SitePage.find().sort({ key: 1 }).lean()).map(toDto);

export const get = async (key: TSitePageKey) => {
  const doc = await SitePage.findOne({ key }).lean();
  return doc ? toDto(doc) : null;
};

export const save = async (key: TSitePageKey, input: TInput) => {
  const doc = await SitePage.findOneAndUpdate(
    { key },
    { $set: { ...input, key, body: sanitizeRichText(input.body) } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  await writeAudit({ action: 'sitePage.save', entityType: 'sitePage', entityId: (doc as any)._id, after: { key, isPublished: input.isPublished } });
  return toDto(doc);
};

export const remove = async (key: TSitePageKey) => {
  const doc = await SitePage.findOneAndDelete({ key }).lean();
  if (!doc) throw AppError.notFound('Page not found');
  await writeAudit({ action: 'sitePage.delete', entityType: 'sitePage', entityId: (doc as any)._id });
  return { deleted: true };
};

const requirePublishedSite = async () => {
  if (!(await PublicSite.exists({ isPublished: true }))) throw AppError.notFound('School website not found', 'SCHOOL_NOT_FOUND');
};

/** Public: the menu needs only the published keys and their titles. */
export const publishedIndex = async () => {
  await requirePublishedSite();
  return (await SitePage.find({ isPublished: true }).select('key title titleEn').lean()).map((d: any) => ({ key: d.key, title: d.title, titleEn: d.titleEn ?? '' }));
};

export const publishedPage = async (key: TSitePageKey) => {
  await requirePublishedSite();
  const doc = await SitePage.findOne({ key, isPublished: true }).lean();
  if (!doc) throw AppError.notFound('Page not found');
  return toDto(doc);
};
