import { z } from 'zod';
import { crudRouter } from '../../lib/crud';
import { assertNotInUse } from '../../lib/inUse';
import { ROLE } from '../../lib/roles';
import { Employee } from '../employee/employee.model';
import { Department } from './department.model';

const createBody = z.strictObject({
  name: z.string().trim().min(2).max(80),
  nameBn: z.string().trim().max(80).optional(),
  isActive: z.boolean().optional(),
});

export const departmentRoutes = crudRouter({
  name: 'department',
  model: Department,
  createBody,
  updateBody: createBody.partial(),
  readRoles: [ROLE.ADMIN, ROLE.TEACHER, ROLE.ACCOUNTANT],
  writeRoles: [ROLE.ADMIN],
  sort: { name: 1 },
  beforeDelete: (doc) =>
    assertNotInUse(Employee, { departmentId: doc._id }, 'this department is assigned to employees'),
});
