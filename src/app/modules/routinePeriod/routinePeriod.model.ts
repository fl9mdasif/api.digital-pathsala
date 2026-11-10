import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

const schema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  nameBn: { type: String, trim: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  isBreak: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
});
schema.index({ tenantId: 1, order: 1 });
schema.index({ tenantId: 1, name: 1 }, { unique: true });

export const RoutinePeriod = mongoose.model('RoutinePeriod', schema) as unknown as mongoose.Model<any>;
