import { z } from 'zod';
import { AppError } from '../../errors/AppError';
import { crudRouter } from '../../lib/crud';
import { assertNotInUse } from '../../lib/inUse';
import { ROLE } from '../../lib/roles';
import { ClassRoutineSlot } from '../classRoutine/classRoutine.model';
import { RoutinePeriod } from './routinePeriod.model';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const createBody = z.strictObject({
  name: z.string().trim().min(1).max(40),
  nameBn: z.string().trim().max(40).optional(),
  startTime: hhmm,
  endTime: hhmm,
  isBreak: z.boolean().optional(),
  order: z.number().int().min(0).max(100).optional(),
});

export const routinePeriodRoutes = crudRouter({
  name: 'routinePeriod',
  model: RoutinePeriod,
  createBody,
  updateBody: createBody.partial(),
  readRoles: [ROLE.ADMIN, ROLE.TEACHER, ROLE.ACCOUNTANT],
  writeRoles: [ROLE.ADMIN],
  sort: { order: 1, startTime: 1 },
  prepare: async (body, existing) => {
    const start: string = body.startTime ?? existing?.startTime;
    const end: string = body.endTime ?? existing?.endTime;
    if (start && end && end <= start) throw AppError.badRequest('End time must be after start time');
    if (body.startTime || body.endTime) {
      const clash = await RoutinePeriod.findOne({
        _id: { $ne: existing?._id },
        startTime: { $lt: end },
        endTime: { $gt: start },
      }).lean();
      if (clash) throw AppError.conflict(`This overlaps the period "${clash.name}"`, 'PERIOD_OVERLAP');
    }
    return body;
  },
  beforeDelete: (doc) =>
    assertNotInUse(ClassRoutineSlot, { periodId: doc._id }, 'this period is used in a class routine'),
});
