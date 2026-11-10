import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

export const TEACHER_ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave', 'half_day'] as const;

const schema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true },
  status: { type: String, enum: TEACHER_ATTENDANCE_STATUSES, required: true },
  checkIn: { type: String, trim: true },
  checkOut: { type: String, trim: true },
  note: { type: String, maxlength: 200 },
  markedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
});
schema.index({ tenantId: 1, employeeId: 1, date: 1 }, { unique: true });
schema.index({ tenantId: 1, date: 1 });

export const TeacherAttendance = mongoose.model('TeacherAttendance', schema) as unknown as mongoose.Model<any>;

const configSchema = createTenantSchema({
  key: { type: String, default: 'config', immutable: true }, // one config row per tenant
  inTime: { type: String, default: '09:00' },
  outTime: { type: String, default: '15:00' },
  graceMinutes: { type: Number, default: 10, min: 0, max: 120 },
});
configSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const TeacherAttendanceConfig = mongoose.model(
  'TeacherAttendanceConfig',
  configSchema,
) as unknown as mongoose.Model<any>;
