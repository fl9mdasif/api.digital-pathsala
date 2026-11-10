import { z } from 'zod';
import { crudRouter } from '../../lib/crud';
import { assertNotInUse } from '../../lib/inUse';
import { ROLE } from '../../lib/roles';
import { Employee } from '../employee/employee.model';
import { Designation } from './designation.model';

const createBody = z.strictObject({
  name: z.string().trim().min(2).max(80),
  nameBn: z.string().trim().max(80).optional(),
  isActive: z.boolean().optional(),
});

export const designationRoutes = crudRouter({
  name: 'designation',
  model: Designation,
  createBody,
  updateBody: createBody.partial(),
  readRoles: [ROLE.ADMIN, ROLE.TEACHER, ROLE.ACCOUNTANT],
  writeRoles: [ROLE.ADMIN],
  sort: { name: 1 },
  beforeDelete: (doc) =>
    assertNotInUse(Employee, { designationId: doc._id }, 'this designation is assigned to employees'),
});
