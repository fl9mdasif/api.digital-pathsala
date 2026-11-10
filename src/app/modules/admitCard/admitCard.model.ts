import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

export const DEFAULT_ADMIT_CARD_CONFIG = {
  signatureTitle: 'Principal',
  instructions: '',
  blockIfDue: false,
  /** Overdue fees up to this amount (in poisha) do not block an admit card. */
  maxDueAllowed: 0,
};

const schema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true }, // one config row per tenant
  signatureTitle: { type: String, default: DEFAULT_ADMIT_CARD_CONFIG.signatureTitle, maxlength: 40 },
  instructions: { type: String, default: DEFAULT_ADMIT_CARD_CONFIG.instructions, maxlength: 300 },
  blockIfDue: { type: Boolean, default: DEFAULT_ADMIT_CARD_CONFIG.blockIfDue },
  maxDueAllowed: { type: Number, default: DEFAULT_ADMIT_CARD_CONFIG.maxDueAllowed, min: 0 },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const AdmitCardConfig = mongoose.model('AdmitCardConfig', schema) as unknown as mongoose.Model<any>;
