import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

const schema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  nameBn: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
});
schema.index({ tenantId: 1, name: 1 }, { unique: true });

export const Designation = mongoose.model('Designation', schema) as unknown as mongoose.Model<any>;
