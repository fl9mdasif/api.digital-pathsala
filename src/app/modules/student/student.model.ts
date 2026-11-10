import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';
import type { IStudent } from './student.interface';

const schema = createTenantSchema(
  {
    studentId: { type: String, required: true },
    admissionNo: String,
    name: { type: String, required: true, trim: true },
    nameBn: String,
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    dob: { type: String, required: true },
    photoUrl: String,
    religion: String,
    bloodGroup: { type: String, enum: ['A+', 'A-', 'AB+', 'AB-', 'B+', 'B-', 'O+', 'O-'] },
    address: String,
    birthRegistrationNo: { type: String, select: false },
    admittedOn: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'transferred', 'passed_out', 'dropped', 'inactive'],
      default: 'active',
    },
    guardianIds: [{ type: Schema.Types.ObjectId, ref: 'Guardian' }],
    currentEnrolmentId: { type: Schema.Types.ObjectId, ref: 'Enrolment' },
  },
  { softDelete: true },
);
schema.index({ tenantId: 1, studentId: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1 });
schema.index({ name: 'text', studentId: 'text' });
schema.index({ tenantId: 1, guardianIds: 1 });

export const Student = mongoose.model<IStudent>('Student', schema);
