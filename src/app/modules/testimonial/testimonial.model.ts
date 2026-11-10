import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

export const TESTIMONIAL_LAYOUTS = ['classic', 'modern', 'ornate', 'minimal'] as const;
export type TestimonialLayout = (typeof TESTIMONIAL_LAYOUTS)[number];

export const TESTIMONIAL_SHOW_KEYS = ['crest', 'photo', 'serial', 'issueDate', 'sigLeft', 'sigRight'] as const;
export type TestimonialShowKey = (typeof TESTIMONIAL_SHOW_KEYS)[number];

/** The words a body template may use. The settings page offers them as click-to-insert badges. */
export const TESTIMONIAL_PLACEHOLDERS = [
  'name',
  'father_name',
  'mother_name',
  'student_id',
  'class_name',
  'section_name',
  'roll',
  'session',
  'exam',
  'passing_year',
  'gpa',
  'board_roll',
  'board_reg',
  'conduct',
  'village',
  'post_office',
  'upazila',
  'district',
  'issue_date',
  'serial',
  'he_she',
  'his_her',
  'him_her',
  'son_daughter',
] as const;

export const DEFAULT_TESTIMONIAL_CONFIG = {
  language: 'bn' as 'bn' | 'en',
  headerTitle: '',
  subTitle: '',
  /** Empty means the standard wording for the chosen language. */
  bodyTemplate: '',
  layout: 'classic' as TestimonialLayout,
  themeColor: '#1b4b8a',
  show: { crest: true, photo: false, serial: true, issueDate: true, sigLeft: true, sigRight: true } as Record<TestimonialShowKey, boolean>,
  sigLeftLabel: 'Class teacher',
  sigRightLabel: 'Principal',
  signatureUrl: '',
};
export type TestimonialConfigData = typeof DEFAULT_TESTIMONIAL_CONFIG;

const d = DEFAULT_TESTIMONIAL_CONFIG;
const show = Object.fromEntries(TESTIMONIAL_SHOW_KEYS.map((k) => [k, { type: Boolean, default: d.show[k] }]));

const configSchema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true },
  language: { type: String, enum: ['bn', 'en'], default: d.language },
  headerTitle: { type: String, default: '', maxlength: 80 },
  subTitle: { type: String, default: '', maxlength: 120 },
  bodyTemplate: { type: String, default: '', maxlength: 2000 },
  layout: { type: String, enum: TESTIMONIAL_LAYOUTS, default: d.layout },
  themeColor: { type: String, default: d.themeColor },
  show,
  sigLeftLabel: { type: String, default: d.sigLeftLabel, maxlength: 40 },
  sigRightLabel: { type: String, default: d.sigRightLabel, maxlength: 40 },
  signatureUrl: { type: String, default: '' },
});
configSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const TestimonialConfig = mongoose.model('TestimonialConfig', configSchema) as unknown as mongoose.Model<any>;

export const normalizeTestimonialConfig = (row: any): TestimonialConfigData => {
  const r = row ?? {};
  return {
    language: r.language ?? d.language,
    headerTitle: r.headerTitle ?? '',
    subTitle: r.subTitle ?? '',
    bodyTemplate: r.bodyTemplate ?? '',
    layout: r.layout ?? d.layout,
    themeColor: r.themeColor ?? d.themeColor,
    show: Object.fromEntries(TESTIMONIAL_SHOW_KEYS.map((k) => [k, r.show?.[k] ?? d.show[k]])) as Record<TestimonialShowKey, boolean>,
    sigLeftLabel: r.sigLeftLabel ?? d.sigLeftLabel,
    sigRightLabel: r.sigRightLabel ?? d.sigRightLabel,
    signatureUrl: r.signatureUrl ?? '',
  };
};

/** One issued testimonial. The student's details are copied in so the record never changes when the student does. */
const recordSchema = createTenantSchema({
  serial: { type: String, required: true },
  year: { type: Number, required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  studentCode: String,
  name: { type: String, required: true },
  nameBn: String,
  gender: { type: String, enum: ['male', 'female', 'other'] },
  fatherName: String,
  motherName: String,
  className: String,
  sectionName: String,
  sessionName: String,
  roll: Number,
  exam: { type: String, default: '', maxlength: 80 },
  passingYear: { type: String, default: '', maxlength: 10 },
  gpa: { type: String, default: '', maxlength: 10 },
  boardRoll: { type: String, default: '', maxlength: 30 },
  boardReg: { type: String, default: '', maxlength: 30 },
  conduct: { type: String, default: '', maxlength: 60 },
  village: { type: String, default: '', maxlength: 80 },
  postOffice: { type: String, default: '', maxlength: 80 },
  upazila: { type: String, default: '', maxlength: 80 },
  district: { type: String, default: '', maxlength: 80 },
  issueDate: { type: String, required: true },
  status: { type: String, enum: ['issued', 'cancelled'], default: 'issued' },
});
recordSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
recordSchema.index({ tenantId: 1, studentId: 1 });
recordSchema.index({ tenantId: 1, year: 1, createdAt: -1 });
export const Testimonial = mongoose.model('Testimonial', recordSchema) as unknown as mongoose.Model<any>;
