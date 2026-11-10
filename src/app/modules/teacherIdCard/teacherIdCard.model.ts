import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';
import { ID_CARD_DESIGNS } from '../idCard/idCard.model';

/** Which details a teacher or staff card shows. */
export const TEACHER_SHOW_KEYS = ['watermark', 'signatureFront', 'signatureBack', 'designation', 'department', 'mobile', 'bloodGroup', 'dob', 'joinDate'] as const;
export type TeacherShowKey = (typeof TEACHER_SHOW_KEYS)[number];

export const DEFAULT_TEACHER_CARD_CONFIG = {
  design: 'modern' as (typeof ID_CARD_DESIGNS)[number],
  themeColor: '#1b4b8a',
  textColor: '#222222',
  nameColor: '#0b2a4a',
  fontSchool: 10,
  fontAddress: 7,
  fontDetails: 8,
  photoShape: 'square' as 'square' | 'rounded' | 'circle',
  issueDate: '',
  validUntil: '',
  validityYears: 1,
  signatureTitle: 'Principal',
  show: {
    watermark: true,
    signatureFront: true,
    signatureBack: false,
    designation: true,
    department: true,
    mobile: true,
    bloodGroup: false,
    dob: false,
    joinDate: false,
  } as Record<TeacherShowKey, boolean>,
  backTop: '',
  backBottom: '',
  qrMode: 'off' as 'off' | 'static' | 'dynamic',
  qrData: '',
  watermarkUrl: '',
  signatureUrl: '',
};
export type TeacherCardConfigData = typeof DEFAULT_TEACHER_CARD_CONFIG;

const d = DEFAULT_TEACHER_CARD_CONFIG;
const show = Object.fromEntries(TEACHER_SHOW_KEYS.map((k) => [k, { type: Boolean, default: d.show[k] }]));

const schema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true },
  design: { type: String, enum: ID_CARD_DESIGNS, default: d.design },
  themeColor: { type: String, default: d.themeColor },
  textColor: { type: String, default: d.textColor },
  nameColor: { type: String, default: d.nameColor },
  fontSchool: { type: Number, default: d.fontSchool, min: 6, max: 16 },
  fontAddress: { type: Number, default: d.fontAddress, min: 5, max: 12 },
  fontDetails: { type: Number, default: d.fontDetails, min: 6, max: 12 },
  photoShape: { type: String, enum: ['square', 'rounded', 'circle'], default: d.photoShape },
  issueDate: { type: String, default: '' },
  validUntil: { type: String, default: '' },
  validityYears: { type: Number, default: d.validityYears, min: 1, max: 10 },
  signatureTitle: { type: String, default: d.signatureTitle, maxlength: 40 },
  show,
  backTop: { type: String, default: '', maxlength: 400 },
  backBottom: { type: String, default: '', maxlength: 200 },
  qrMode: { type: String, enum: ['off', 'static', 'dynamic'], default: 'off' },
  qrData: { type: String, default: '', maxlength: 300 },
  watermarkUrl: { type: String, default: '' },
  signatureUrl: { type: String, default: '' },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const TeacherCardConfig = mongoose.model('TeacherCardConfig', schema) as unknown as mongoose.Model<any>;

/** A stored row laid over the defaults, so a row saved before a field existed still works. */
export const normalizeTeacherCardConfig = (row: any): TeacherCardConfigData => {
  const r = row ?? {};
  return {
    design: r.design ?? d.design,
    themeColor: r.themeColor ?? d.themeColor,
    textColor: r.textColor ?? d.textColor,
    nameColor: r.nameColor ?? d.nameColor,
    fontSchool: r.fontSchool ?? d.fontSchool,
    fontAddress: r.fontAddress ?? d.fontAddress,
    fontDetails: r.fontDetails ?? d.fontDetails,
    photoShape: r.photoShape ?? d.photoShape,
    issueDate: r.issueDate ?? '',
    validUntil: r.validUntil ?? '',
    validityYears: r.validityYears ?? d.validityYears,
    signatureTitle: r.signatureTitle ?? d.signatureTitle,
    show: Object.fromEntries(TEACHER_SHOW_KEYS.map((k) => [k, r.show?.[k] ?? d.show[k]])) as Record<TeacherShowKey, boolean>,
    backTop: r.backTop ?? '',
    backBottom: r.backBottom ?? '',
    qrMode: r.qrMode ?? 'off',
    qrData: r.qrData ?? '',
    watermarkUrl: r.watermarkUrl ?? '',
    signatureUrl: r.signatureUrl ?? '',
  };
};
