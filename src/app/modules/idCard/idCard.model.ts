import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

export const DEFAULT_ID_CARD_CONFIG = {
  themeColor: '#1b4b8a',
  validityYears: 1,
  signatureTitle: 'Principal',
  showGuardianPhone: true,
  footerNote: '',
};

const schema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true }, // one config row per tenant
  themeColor: { type: String, default: DEFAULT_ID_CARD_CONFIG.themeColor },
  validityYears: { type: Number, default: DEFAULT_ID_CARD_CONFIG.validityYears, min: 1, max: 10 },
  signatureTitle: { type: String, default: DEFAULT_ID_CARD_CONFIG.signatureTitle, maxlength: 40 },
  showGuardianPhone: { type: Boolean, default: DEFAULT_ID_CARD_CONFIG.showGuardianPhone },
  footerNote: { type: String, default: DEFAULT_ID_CARD_CONFIG.footerNote, maxlength: 80 },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const IdCardConfig = mongoose.model('IdCardConfig', schema) as unknown as mongoose.Model<any>;
