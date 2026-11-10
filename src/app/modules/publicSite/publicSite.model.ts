import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

const schema = createTenantSchema({
  isPublished: { type: Boolean, default: false },
  theme: {
    primaryColor: { type: String, default: '#1d4ed8' },
    template: { type: String, enum: ['classic', 'modern'], default: 'classic' },
  },
  hero: { title: { type: String, default: '' }, subtitle: String, imageUrl: String },
  about: String,
  mission: String,
  headMessage: { name: String, designation: String, photoUrl: String, text: String },
  admissionInfo: {
    isOpen: { type: Boolean, default: false },
    text: String,
    classes: [String],
    lastDate: String,
  },
  /** The year the institution was founded, shown in the header and the stats strip. */
  establishedYear: { type: Number, min: 1000, max: 2100 },
  /** Education institution identification number. */
  eiin: { type: String, trim: true, maxlength: 20 },
  secondMessage: { name: String, designation: String, photoUrl: String, text: String },
  /** The quick-action tiles on the home page, in order. Empty means every tile the school's pages support. */
  quickTiles: { type: [String], default: [] },
  importantLinks: {
    type: [new Schema({ label: { type: String, required: true }, url: { type: String, required: true } }, { _id: false })],
    default: [],
  },
  display: {
    showStats: { type: Boolean, default: true },
    showTicker: { type: Boolean, default: true },
  },
  contact: { phone: String, email: String, address: String, mapUrl: String },
  gallery: {
    type: [new Schema({ url: { type: String, required: true }, caption: String }, { _id: false })],
    default: [],
  },
  social: { facebook: String, youtube: String },
  seo: { title: String, description: String },
  sectionsVisible: {
    about: { type: Boolean, default: true },
    teachers: { type: Boolean, default: true },
    notices: { type: Boolean, default: true },
    gallery: { type: Boolean, default: true },
    admission: { type: Boolean, default: true },
    results: { type: Boolean, default: true },
    routine: { type: Boolean, default: true },
    feeLookup: { type: Boolean, default: true },
  },
});
schema.path('tenantId').index(false);
schema.index({ tenantId: 1 }, { unique: true });

export const PublicSite = mongoose.model('PublicSite', schema) as unknown as mongoose.Model<any>;
