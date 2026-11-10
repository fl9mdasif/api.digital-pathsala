import mongoose, { Schema } from 'mongoose';
import { createTenantSchema } from '../../plugins/createTenantSchema';

const schema = createTenantSchema({
  examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
  classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  /** Empty means the whole class sits the paper together. A section entry overrides it for that section. */
  sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
  subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  room: { type: String, trim: true, maxlength: 40 },
});
schema.index({ tenantId: 1, examId: 1, classId: 1, sectionId: 1, subjectId: 1 }, { unique: true });
schema.index({ tenantId: 1, examId: 1, date: 1 });

export const ExamRoutineEntry = mongoose.model('ExamRoutineEntry', schema) as unknown as mongoose.Model<any>;
