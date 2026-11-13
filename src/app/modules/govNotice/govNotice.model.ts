import mongoose from 'mongoose';
import { createPlatformSchema } from '../../plugins/createTenantSchema';

/** Government bodies whose notices the platform owner relays to every school site. */
export const GOV_SOURCES = ['moedu', 'mopme', 'shed', 'dshe', 'dpe', 'nctb', 'board', 'banbeis', 'other'] as const;
export type TGovSource = (typeof GOV_SOURCES)[number];

export interface IGovNotice {
  title: string;
  source: TGovSource;
  url: string;
  publishedOn: string;
  pinned: boolean;
}

const schema = createPlatformSchema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  source: { type: String, enum: GOV_SOURCES, required: true },
  url: { type: String, required: true, trim: true, maxlength: 500 },
  publishedOn: { type: String, required: true }, // YYYY-MM-DD, the date on the government notice
  pinned: { type: Boolean, default: false },
});
schema.index({ pinned: -1, publishedOn: -1 });

export const GovNotice = mongoose.model<IGovNotice>('GovNotice', schema);
