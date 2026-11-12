import mongoose from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

/**
 * An online admission application. applied -> admitted or rejected -> confirmed (a real student is created).
 * A rejected application can be admitted again; a confirmed one is final.
 */
export const ADMISSION_STATUSES = ['applied', 'admitted', 'rejected', 'confirmed'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

const guardian = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true },
    relation: { type: String, enum: ['father', 'mother', 'other'], default: 'other' },
    occupation: { type: String, trim: true, maxlength: 80 },
  },
  { _id: false },
);

const historyEntry = new mongoose.Schema(
  {
    status: { type: String, enum: ADMISSION_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: mongoose.Schema.Types.ObjectId,
    note: { type: String, maxlength: 300 },
  },
  { _id: false },
);

const schema = createTenantSchema({
  applicationNo: { type: String, required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession' },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  group: { type: String, enum: ['science', 'commerce', 'arts', null], default: null },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  nameBn: { type: String, trim: true, maxlength: 120 },
  gender: { type: String, enum: ['male', 'female', 'other'], required: true },
  dob: { type: String, required: true },
  religion: { type: String, trim: true, maxlength: 40 },
  bloodGroup: { type: String, enum: ['A+', 'A-', 'AB+', 'AB-', 'B+', 'B-', 'O+', 'O-'] },
  address: { type: String, trim: true, maxlength: 300 },
  birthRegistrationNo: { type: String, trim: true, maxlength: 30 },
  previousSchool: { type: String, trim: true, maxlength: 150 },
  guardians: { type: [guardian], default: [] },
  photoUrl: String,
  /** A photo the applicant sent after applying. It replaces photoUrl only when an admin approves it. */
  pendingPhotoUrl: String,
  status: { type: String, enum: ADMISSION_STATUSES, default: 'applied' },
  note: { type: String, trim: true, maxlength: 300 },
  /** The student created on confirmation. */
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  history: { type: [historyEntry], default: [] },
});
schema.index({ tenantId: 1, applicationNo: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1, createdAt: -1 });

export const Admission = mongoose.model('Admission', schema) as unknown as mongoose.Model<any>;
