import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

/** Yearly completion certificate: one per student per completed academic year (a promoted enrolment). */
export const CERTIFICATE_LAYOUTS = ['classic', 'royal', 'modern', 'minimal'] as const;
export type CertificateLayout = (typeof CERTIFICATE_LAYOUTS)[number];

export const CERTIFICATE_SHOW_KEYS = ['crest', 'photo', 'serial', 'qr', 'gpa', 'sigLeft', 'sigRight'] as const;
export type CertificateShowKey = (typeof CERTIFICATE_SHOW_KEYS)[number];

export const CERTIFICATE_PLACEHOLDERS = [
  'name',
  'father_name',
  'mother_name',
  'student_id',
  'class_name',
  'section_name',
  'roll',
  'session',
  'gpa',
  'letter',
  'exam',
  'school',
  'issue_date',
  'serial',
  'he_she',
  'his_her',
  'him_her',
] as const;

export const DEFAULT_CERTIFICATE_CONFIG = {
  language: 'bn' as 'bn' | 'en',
  title: '',
  subTitle: '',
  /** Empty means the standard wording for the chosen language. */
  bodyTemplate: '',
  layout: 'royal' as CertificateLayout,
  themeColor: '#14532d',
  show: { crest: true, photo: false, serial: true, qr: true, gpa: true, sigLeft: true, sigRight: true } as Record<CertificateShowKey, boolean>,
  sigLeftLabel: 'শ্রেণি শিক্ষক',
  sigRightLabel: 'প্রধান শিক্ষক',
  signatureUrl: '',
};
export type CertificateConfigData = typeof DEFAULT_CERTIFICATE_CONFIG;

const d = DEFAULT_CERTIFICATE_CONFIG;
const show = Object.fromEntries(CERTIFICATE_SHOW_KEYS.map((k) => [k, { type: Boolean, default: d.show[k] }]));

const configSchema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true },
  language: { type: String, enum: ['bn', 'en'], default: d.language },
  title: { type: String, default: '', maxlength: 80 },
  subTitle: { type: String, default: '', maxlength: 120 },
  bodyTemplate: { type: String, default: '', maxlength: 2000 },
  layout: { type: String, enum: CERTIFICATE_LAYOUTS, default: d.layout },
  themeColor: { type: String, default: d.themeColor },
  show,
  sigLeftLabel: { type: String, default: d.sigLeftLabel, maxlength: 40 },
  sigRightLabel: { type: String, default: d.sigRightLabel, maxlength: 40 },
  signatureUrl: { type: String, default: '' },
});
configSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const CertificateConfig = mongoose.model('CertificateConfig', configSchema) as unknown as mongoose.Model<any>;

export const normalizeCertificateConfig = (row: any): CertificateConfigData => {
  const r = row ?? {};
  return {
    language: r.language ?? d.language,
    title: r.title ?? '',
    subTitle: r.subTitle ?? '',
    bodyTemplate: r.bodyTemplate ?? '',
    layout: r.layout ?? d.layout,
    themeColor: r.themeColor ?? d.themeColor,
    show: Object.fromEntries(CERTIFICATE_SHOW_KEYS.map((k) => [k, r.show?.[k] ?? d.show[k]])) as Record<CertificateShowKey, boolean>,
    sigLeftLabel: r.sigLeftLabel ?? d.sigLeftLabel,
    sigRightLabel: r.sigRightLabel ?? d.sigRightLabel,
    signatureUrl: r.signatureUrl ?? '',
  };
};

/** One issued certificate. Details are copied in so the record never changes when the student does. */
const recordSchema = createTenantSchema({
  serial: { type: String, required: true },
  year: { type: Number, required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  enrolmentId: { type: Schema.Types.ObjectId, ref: 'Enrolment', required: true },
  studentCode: String,
  name: { type: String, required: true },
  nameBn: String,
  gender: { type: String, enum: ['male', 'female', 'other'] },
  fatherName: String,
  motherName: String,
  className: String,
  classNameBn: String,
  sectionName: String,
  sessionName: String,
  roll: Number,
  examName: { type: String, default: '', maxlength: 80 },
  gpa: { type: String, default: '', maxlength: 10 },
  letter: { type: String, default: '', maxlength: 10 },
  issueDate: { type: String, required: true },
  status: { type: String, enum: ['issued', 'cancelled'], default: 'issued' },
});
recordSchema.index({ tenantId: 1, serial: 1 }, { unique: true });
recordSchema.index({ tenantId: 1, enrolmentId: 1 }, { unique: true, partialFilterExpression: { status: 'issued' } });
recordSchema.index({ tenantId: 1, year: 1, createdAt: -1 });
export const Certificate = mongoose.model('Certificate', recordSchema) as unknown as mongoose.Model<any>;
