import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

/**
 * Pages a school writes for its website menu (about, MPO information, land, campus map, syllabus, tender and more).
 * The keys are a fixed catalogue so every school's menu has the same shape; a page shows only once published.
 * Keep in step with client/lib/siteMenu.ts.
 */
export const SITE_PAGE_KEYS = [
  // institution
  'about', 'permission-recognition', 'mpo-nationalisation', 'land', 'buildings', 'campus-map', 'achievements', 'annual-report', 'honour-board', 'founders',
  // administration
  'head-teachers', 'former-teachers', 'welfare-fund', 'teachers-council', 'managing-committee',
  // academic
  'stipend-list', 'seats', 'facilities', 'academic-calendar', 'holidays', 'annual-plan', 'syllabus', 'rules', 'public-results',
  // information
  'cleanliness', 'sanitation', 'sports-culture', 'departments', 'stipend', 'income-expense', 'hostel', 'scouts', 'bncc', 'red-crescent', 'tender',
  // downloads
  'manuals', 'ebooks', 'tutorials', 'lecture-sheets', 'lesson-plans', 'suggestions', 'forms', 'book-list',
  // digital campus
  'multimedia-class', 'computer-lab', 'science-lab', 'library',
] as const;
export type TSitePageKey = (typeof SITE_PAGE_KEYS)[number];

const schema = createTenantSchema({
  key: { type: String, enum: SITE_PAGE_KEYS, required: true },
  title: { type: String, required: true, trim: true, maxlength: 150 },
  titleEn: { type: String, trim: true, maxlength: 150 },
  body: { type: String, default: '', maxlength: 30000 },
  attachments: {
    type: [new Schema({ url: { type: String, required: true }, name: { type: String, required: true } }, { _id: false })],
    default: [],
  },
  isPublished: { type: Boolean, default: false },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const SitePage = mongoose.model('SitePage', schema) as unknown as mongoose.Model<any>;
