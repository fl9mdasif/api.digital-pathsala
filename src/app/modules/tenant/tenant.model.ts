import mongoose, { Schema } from 'mongoose';
import { createPlatformSchema } from '../../plugins/createTenantSchema';
import type { ITenant } from './tenant.interface';

const schema = createPlatformSchema({
  name: { type: String, required: true, trim: true },
  nameBn: { type: String, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true },
  slugAliases: {
    type: [
      new Schema(
        { slug: { type: String, required: true }, expiresAt: { type: Date, required: true } },
        { _id: false },
      ),
    ],
    default: [],
  },
  institutionType: { type: String, enum: ['school', 'madrasa', 'coaching'], required: true },
  status: {
    type: String,
    enum: ['trial', 'active', 'suspended', 'cancelled'],
    default: 'trial',
    index: true,
  },
  trialEndsAt: { type: Date, required: true },
  suspendedAt: Date,
  planId: { type: Schema.Types.ObjectId, ref: 'Plan', required: true },
  studentCap: { type: Number, required: true },
  contact: {
    phone: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    address: String,
    district: String,
    upazila: String,
  },
  eiin: String,
  logoUrl: String,
  settings: {
    locale: { type: String, enum: ['bn', 'en'], default: 'bn' },
    timezone: { type: String, enum: ['Asia/Dhaka'], default: 'Asia/Dhaka' },
    weekendDays: { type: [Number], default: [5] },
    defaultFeeCycle: { type: String, enum: ['monthly', 'term', 'yearly', 'one_time'], default: 'monthly' },
    attendanceEditWindowHours: { type: Number, default: 24, min: 0 },
    resultLookupMode: {
      type: String,
      enum: ['roll_dob', 'roll_only', 'student_id_dob'],
      default: 'roll_dob',
    },
    terminology: { type: Schema.Types.Mixed, default: {} },
    /** Colour theme for the school's dashboard and website (client/app/globals.css [data-brand]). */
    theme: { type: String, enum: ['forest', 'navy', 'maroon', 'royal', 'plum'], default: 'forest' },
  },
});

schema.index({ 'slugAliases.slug': 1 }, { unique: true, sparse: true });
schema.index({ name: 'text', slug: 'text' });

export const Tenant = mongoose.model<ITenant>('Tenant', schema);
