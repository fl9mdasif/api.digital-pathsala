import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

export const ADMIT_DESIGNS = ['modern', 'classic', 'idstyle', 'mono'] as const;
export type AdmitDesign = (typeof ADMIT_DESIGNS)[number];

/** What an admit card shows. */
export const ADMIT_SHOW_KEYS = ['photo', 'qr', 'routine', 'dueAmount', 'sigClassTeacher', 'sigAccounts', 'sigHead', 'class', 'roll', 'group', 'father', 'dob'] as const;
export type AdmitShowKey = (typeof ADMIT_SHOW_KEYS)[number];

export const DEFAULT_ADMIT_CARD_CONFIG = {
  /** The head's signature label (kept under its original name so older rows keep working). */
  signatureTitle: 'Principal',
  instructions: '',
  /** The default for exams that have no lockdown rule of their own. */
  blockIfDue: false,
  /** Overdue fees up to this amount (in poisha) do not block an admit card. */
  maxDueAllowed: 0,
  design: 'modern' as AdmitDesign,
  themeColor: '#1b4b8a',
  perPage: 1 as 1 | 2 | 3,
  show: {
    photo: true,
    qr: false,
    routine: true,
    dueAmount: true,
    sigClassTeacher: false,
    sigAccounts: false,
    sigHead: true,
    class: true,
    roll: true,
    group: false,
    father: false,
    dob: false,
  } as Record<AdmitShowKey, boolean>,
  sigClassTeacherLabel: 'Class teacher',
  sigAccountsLabel: 'Accounts',
  signatureUrl: '',
  qrData: '{student_id}|{name}|{exam}',
};
export type AdmitConfigData = typeof DEFAULT_ADMIT_CARD_CONFIG;

const d = DEFAULT_ADMIT_CARD_CONFIG;
const show = Object.fromEntries(ADMIT_SHOW_KEYS.map((k) => [k, { type: Boolean, default: d.show[k] }]));

const schema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true }, // one config row per tenant
  signatureTitle: { type: String, default: d.signatureTitle, maxlength: 40 },
  instructions: { type: String, default: d.instructions, maxlength: 300 },
  blockIfDue: { type: Boolean, default: d.blockIfDue },
  maxDueAllowed: { type: Number, default: d.maxDueAllowed, min: 0 },
  design: { type: String, enum: ADMIT_DESIGNS, default: d.design },
  themeColor: { type: String, default: d.themeColor },
  perPage: { type: Number, enum: [1, 2, 3], default: d.perPage },
  show,
  sigClassTeacherLabel: { type: String, default: d.sigClassTeacherLabel, maxlength: 40 },
  sigAccountsLabel: { type: String, default: d.sigAccountsLabel, maxlength: 40 },
  signatureUrl: { type: String, default: '' },
  qrData: { type: String, default: d.qrData, maxlength: 300 },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const AdmitCardConfig = mongoose.model('AdmitCardConfig', schema) as unknown as mongoose.Model<any>;

/** A stored row laid over the defaults, so rows saved before a field existed still work. */
export const normalizeAdmitConfig = (row: any): AdmitConfigData => {
  const r = row ?? {};
  return {
    signatureTitle: r.signatureTitle ?? d.signatureTitle,
    instructions: r.instructions ?? '',
    blockIfDue: r.blockIfDue ?? d.blockIfDue,
    maxDueAllowed: r.maxDueAllowed ?? d.maxDueAllowed,
    design: r.design ?? d.design,
    themeColor: r.themeColor ?? d.themeColor,
    perPage: r.perPage ?? d.perPage,
    show: Object.fromEntries(ADMIT_SHOW_KEYS.map((k) => [k, r.show?.[k] ?? d.show[k]])) as Record<AdmitShowKey, boolean>,
    sigClassTeacherLabel: r.sigClassTeacherLabel ?? d.sigClassTeacherLabel,
    sigAccountsLabel: r.sigAccountsLabel ?? d.sigAccountsLabel,
    signatureUrl: r.signatureUrl ?? '',
    qrData: r.qrData ?? d.qrData,
  };
};

/**
 * Fee lockdown for one exam. When a rule exists it replaces the school-wide default for that exam:
 * active means students owing more than `maxDueAllowed` are blocked, inactive means nobody is.
 */
const ruleSchema = createTenantSchema({
  examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
  active: { type: Boolean, default: true },
  /** In poisha. */
  maxDueAllowed: { type: Number, default: 0, min: 0 },
  /** Only invoices with one of these fee heads count. Empty means every fee head. */
  feeHeadIds: [{ type: Schema.Types.ObjectId, ref: 'FeeHead' }],
  /** Whether an admin can still print the cards of blocked students. */
  adminCanPrint: { type: Boolean, default: true },
});
ruleSchema.index({ tenantId: 1, examId: 1 }, { unique: true });

export const AdmitLockRule = mongoose.model('AdmitLockRule', ruleSchema) as unknown as mongoose.Model<any>;
