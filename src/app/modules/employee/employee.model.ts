import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

const schema = createTenantSchema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeCode: { type: String, required: true, trim: true, uppercase: true },
  designationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation' },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  joinDate: Date,
  employmentType: {
    type: String,
    enum: ['permanent', 'contractual', 'part_time'],
    default: 'permanent',
  },
  employmentStatus: {
    type: String,
    enum: ['active', 'on_leave', 'resigned', 'terminated'],
    default: 'active',
    index: true,
  },
  gender: { type: String, enum: ['male', 'female', 'other'] },
  dateOfBirth: Date,
  bloodGroup: { type: String, trim: true },
  nationalId: { type: String, trim: true },
  qualification: { type: String, trim: true },
  address: { type: String, trim: true },
  basicSalary: { type: Number, min: 0 },
  photoUrl: { type: String, trim: true },
});
schema.index({ tenantId: 1, userId: 1 }, { unique: true });
schema.index({ tenantId: 1, employeeCode: 1 }, { unique: true });

export const Employee = mongoose.model('Employee', schema) as unknown as mongoose.Model<any>;
