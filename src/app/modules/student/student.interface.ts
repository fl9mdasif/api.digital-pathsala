import type { Types } from 'mongoose';

export type StudentStatus = 'active' | 'transferred' | 'passed_out' | 'dropped' | 'inactive';

export interface IStudent {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  studentId: string;
  admissionNo?: string;
  name: string;
  nameBn?: string;
  gender: 'male' | 'female' | 'other';
  dob: string;
  photoUrl?: string;
  religion?: string;
  bloodGroup?: 'A+' | 'A-' | 'AB+' | 'AB-' | 'B+' | 'B-' | 'O+' | 'O-';
  address?: string;
  birthRegistrationNo?: string;
  admittedOn: string;
  status: StudentStatus;
  guardianIds: Types.ObjectId[];
  currentEnrolmentId?: Types.ObjectId;
  isDeleted: boolean;
}
