import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

export const ID_CARD_DESIGNS = ['modern', 'classic', 'mono'] as const;
export type IdCardDesign = (typeof ID_CARD_DESIGNS)[number];

/** Which details a card shows. */
export const SHOW_KEYS = [
  'watermark',
  'signatureFront',
  'signatureBack',
  'class',
  'section',
  'group',
  'roll',
  'year',
  'mobile',
  'bloodGroup',
  'father',
  'mother',
  'dob',
] as const;
export type ShowKey = (typeof SHOW_KEYS)[number];

export const DEFAULT_ID_CARD_CONFIG = {
  design: 'modern' as IdCardDesign,
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
  classDisplay: 'class_section' as 'class_section' | 'class_only',
  sessionLabel: 'Session',
  signatureTitle: 'Principal',
  show: {
    watermark: true,
    signatureFront: true,
    signatureBack: false,
    class: true,
    section: true,
    group: false,
    roll: true,
    year: true,
    mobile: true,
    bloodGroup: false,
    father: true,
    mother: false,
    dob: false,
  } as Record<ShowKey, boolean>,
  backTop: '',
  backBottom: '',
  qrMode: 'off' as 'off' | 'static' | 'dynamic',
  qrData: '',
  watermarkUrl: '',
  signatureUrl: '',
};
export type IdCardConfigData = typeof DEFAULT_ID_CARD_CONFIG;

const show = Object.fromEntries(SHOW_KEYS.map((k) => [k, { type: Boolean, default: DEFAULT_ID_CARD_CONFIG.show[k] }]));

const schema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true }, // one config row per tenant
  design: { type: String, enum: ID_CARD_DESIGNS, default: DEFAULT_ID_CARD_CONFIG.design },
  themeColor: { type: String, default: DEFAULT_ID_CARD_CONFIG.themeColor },
  textColor: { type: String, default: DEFAULT_ID_CARD_CONFIG.textColor },
  nameColor: { type: String, default: DEFAULT_ID_CARD_CONFIG.nameColor },
  fontSchool: { type: Number, default: DEFAULT_ID_CARD_CONFIG.fontSchool, min: 6, max: 16 },
  fontAddress: { type: Number, default: DEFAULT_ID_CARD_CONFIG.fontAddress, min: 5, max: 12 },
  fontDetails: { type: Number, default: DEFAULT_ID_CARD_CONFIG.fontDetails, min: 6, max: 12 },
  photoShape: { type: String, enum: ['square', 'rounded', 'circle'], default: DEFAULT_ID_CARD_CONFIG.photoShape },
  issueDate: { type: String, default: '' },
  validUntil: { type: String, default: '' },
  validityYears: { type: Number, default: DEFAULT_ID_CARD_CONFIG.validityYears, min: 1, max: 10 },
  classDisplay: { type: String, enum: ['class_section', 'class_only'], default: DEFAULT_ID_CARD_CONFIG.classDisplay },
  sessionLabel: { type: String, default: DEFAULT_ID_CARD_CONFIG.sessionLabel, maxlength: 20 },
  signatureTitle: { type: String, default: DEFAULT_ID_CARD_CONFIG.signatureTitle, maxlength: 40 },
  show,
  backTop: { type: String, default: '', maxlength: 400 },
  backBottom: { type: String, default: '', maxlength: 200 },
  qrMode: { type: String, enum: ['off', 'static', 'dynamic'], default: 'off' },
  qrData: { type: String, default: '', maxlength: 300 },
  watermarkUrl: { type: String, default: '' },
  signatureUrl: { type: String, default: '' },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const IdCardConfig = mongoose.model('IdCardConfig', schema) as unknown as mongoose.Model<any>;

/** Merges a stored row over the defaults, so older rows that lack the newer fields keep working. */
export const normalizeIdCardConfig = (row: any): IdCardConfigData => {
  const d = DEFAULT_ID_CARD_CONFIG;
  const r = row ?? {};
  const legacyMobile = typeof r.showGuardianPhone === 'boolean' ? r.showGuardianPhone : d.show.mobile;
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
    classDisplay: r.classDisplay ?? d.classDisplay,
    sessionLabel: r.sessionLabel ?? d.sessionLabel,
    signatureTitle: r.signatureTitle ?? d.signatureTitle,
    show: Object.fromEntries(SHOW_KEYS.map((k) => [k, r.show?.[k] ?? (k === 'mobile' ? legacyMobile : d.show[k])])) as Record<ShowKey, boolean>,
    backTop: r.backTop ?? '',
    backBottom: r.backBottom ?? r.footerNote ?? '',
    qrMode: r.qrMode ?? 'off',
    qrData: r.qrData ?? '',
    watermarkUrl: r.watermarkUrl ?? '',
    signatureUrl: r.signatureUrl ?? '',
  };
};
