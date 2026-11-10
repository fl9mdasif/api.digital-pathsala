import { z } from 'zod';
import { objectIdSchema } from '../../lib/objectId';
import { MAX_CARDS } from '../idCard/idCard.validation';

export const SEAT_DESIGNS = ['band', 'framed', 'mono'] as const;

const idList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(objectIdSchema).min(1).max(MAX_CARDS));

const target = {
  examId: objectIdSchema,
  sectionId: objectIdSchema.optional(),
  /** Chosen students; otherwise the whole section. */
  studentIds: idList.optional(),
  /** Room name, for example "Hall". With seatsPerRoom the rooms are numbered "Hall 1", "Hall 2" and so on. */
  room: z.string().trim().max(30).default(''),
  /** Seats in each room; students are split across rooms in roll order. Empty means one room. */
  seatsPerRoom: z.coerce.number().int().min(1).max(500).optional(),
  /** The first seat number in each room. */
  startSeat: z.coerce.number().int().min(1).max(9999).default(1),
};
const hasTarget = (q: { sectionId?: string; studentIds?: string[] }) => !!q.sectionId || !!q.studentIds;
const needTarget = { message: 'Choose a section or some students' };

export const assignQuery = z.strictObject(target).refine(hasTarget, needTarget);

export const printQuery = z
  .strictObject({
    ...target,
    design: z.enum(SEAT_DESIGNS).default('band'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1b4b8a').default('#1b4b8a'),
    photo: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    locale: z.enum(['bn', 'en']).default('bn'),
  })
  .refine(hasTarget, needTarget);
