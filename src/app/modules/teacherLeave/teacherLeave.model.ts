import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

export const LEAVE_TYPES = ['casual', 'sick', 'annual', 'maternity', 'unpaid'] as const;
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

const schema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  type: { type: String, enum: LEAVE_TYPES, required: true },
  fromDate: { type: String, required: true },
  toDate: { type: String, required: true },
  /** Working days in the range (weekend days excluded). */
  days: { type: Number, required: true, min: 1 },
  reason: { type: String, trim: true, maxlength: 500 },
  status: { type: String, enum: LEAVE_STATUSES, default: 'pending', index: true },
  appliedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  decidedBy: mongoose.Schema.Types.ObjectId,
  decidedAt: Date,
  decisionNote: { type: String, trim: true, maxlength: 300 },
});
schema.index({ tenantId: 1, employeeId: 1, fromDate: 1 });
schema.index({ tenantId: 1, status: 1, createdAt: -1 });

export const TeacherLeave = mongoose.model('TeacherLeave', schema) as unknown as mongoose.Model<any>;

/** Yearly allowance in working days per leave type. Unpaid leave has no limit. */
export const DEFAULT_ALLOWANCES = { casual: 10, sick: 14, annual: 15, maternity: 120 };

const configSchema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true }, // one config row per tenant
  allowances: {
    casual: { type: Number, default: DEFAULT_ALLOWANCES.casual, min: 0, max: 365 },
    sick: { type: Number, default: DEFAULT_ALLOWANCES.sick, min: 0, max: 365 },
    annual: { type: Number, default: DEFAULT_ALLOWANCES.annual, min: 0, max: 365 },
    maternity: { type: Number, default: DEFAULT_ALLOWANCES.maternity, min: 0, max: 365 },
  },
});
configSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const TeacherLeaveConfig = mongoose.model(
  'TeacherLeaveConfig',
  configSchema,
) as unknown as mongoose.Model<any>;
