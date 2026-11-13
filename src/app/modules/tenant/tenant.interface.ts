import type { Types } from 'mongoose';

export type InstitutionType = 'school' | 'madrasa' | 'coaching';
export type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled';
export type FeeCycle = 'monthly' | 'term' | 'yearly' | 'one_time';
export type Terminology = Record<string, { en: string; bn: string }>;

export interface ITenant {
  _id: Types.ObjectId;
  name: string;
  nameBn?: string;
  slug: string;
  slugAliases: { slug: string; expiresAt: Date }[];
  institutionType: InstitutionType;
  status: TenantStatus;
  trialEndsAt: Date;
  suspendedAt?: Date;
  planId: Types.ObjectId;
  studentCap: number;
  contact: { phone: string; email?: string; address?: string; district?: string; upazila?: string };
  eiin?: string;
  logoUrl?: string;
  settings: {
    locale: 'bn' | 'en';
    timezone: 'Asia/Dhaka';
    weekendDays: number[];
    defaultFeeCycle: FeeCycle;
    attendanceEditWindowHours: number;
    resultLookupMode: 'roll_dob' | 'roll_only' | 'student_id_dob';
    terminology: Terminology;
    theme?: 'forest' | 'navy' | 'maroon' | 'royal' | 'plum';
  };
  createdAt: Date;
  updatedAt: Date;
}
