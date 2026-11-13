import { AppError } from '../../errors/AppError';
import { ttlCache, clearPublicCaches } from '../../lib/publicCache';
import { GovNotice, type IGovNotice } from './govNotice.model';

const latestCache = ttlCache<unknown[]>();

const toDto = (d: any) => ({ _id: String(d._id), title: d.title, source: d.source, url: d.url, publishedOn: d.publishedOn, pinned: !!d.pinned });

export const list = async ({ page, limit }: { page: number; limit: number }) => {
  const [rows, total] = await Promise.all([
    GovNotice.find().sort({ pinned: -1, publishedOn: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    GovNotice.countDocuments(),
  ]);
  return { rows: rows.map(toDto), total };
};

/** Latest notices for every school site and the marketing home. Cached per process; writers clear it. */
export const latest = (limit: number) =>
  latestCache.getOrLoad(String(limit), async () =>
    (await GovNotice.find().sort({ pinned: -1, publishedOn: -1, createdAt: -1 }).limit(limit).lean()).map(toDto),
  );

export const create = async (input: Partial<IGovNotice>) => {
  const doc = await GovNotice.create(input);
  clearPublicCaches();
  return toDto(doc);
};

export const update = async (id: string, input: Partial<IGovNotice>) => {
  const doc = await GovNotice.findByIdAndUpdate(id, input, { new: true, runValidators: true }).lean();
  if (!doc) throw AppError.notFound('Notice not found');
  clearPublicCaches();
  return toDto(doc);
};

export const remove = async (id: string) => {
  const doc = await GovNotice.findByIdAndDelete(id).lean();
  if (!doc) throw AppError.notFound('Notice not found');
  clearPublicCaches();
  return { deleted: true };
};
