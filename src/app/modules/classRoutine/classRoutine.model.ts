import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

const schema = createTenantSchema({
  classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
  /** 0 = Sunday ... 6 = Saturday, matching the school week used elsewhere. */
  day: { type: Number, required: true, min: 0, max: 6 },
  periodId: { type: Schema.Types.ObjectId, ref: 'RoutinePeriod', required: true },
  subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User' },
  room: { type: String, trim: true, maxlength: 40 },
});
schema.index({ tenantId: 1, sectionId: 1, day: 1, periodId: 1 }, { unique: true });
schema.index({ tenantId: 1, teacherId: 1, day: 1, periodId: 1 });
schema.index({ tenantId: 1, periodId: 1 });

export const ClassRoutineSlot = mongoose.model('ClassRoutineSlot', schema) as unknown as mongoose.Model<any>;
