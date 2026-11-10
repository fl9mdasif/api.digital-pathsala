import { mediaUrl } from '../../lib/mediaUrl';
import { z } from 'zod';
import { isValidLocalDate } from '../../lib/localDate';

const url = mediaUrl;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1d4ed8');

export const QUICK_TILES = ['results', 'admission', 'notices', 'teachers', 'gallery', 'routine', 'feeLookup', 'contact'] as const;
const message = z.strictObject({
  name: z.string().trim().max(100),
  designation: z.string().trim().max(100),
  photoUrl: url.optional(),
  text: z.string().trim().max(3000),
});

export const updateSiteBody = z.strictObject({
  establishedYear: z.number().int().min(1000).max(2100).optional(),
  eiin: z.string().trim().max(20).optional(),
  secondMessage: message.optional(),
  quickTiles: z.array(z.enum(QUICK_TILES)).max(8).refine((a) => new Set(a).size === a.length, 'Each tile once').optional(),
  importantLinks: z.array(z.strictObject({ label: z.string().trim().min(1).max(80), url: z.string().url().max(300) })).max(12).optional(),
  display: z.strictObject({ showStats: z.boolean(), showTicker: z.boolean() }).partial().optional(),
  theme: z
    .strictObject({ primaryColor: color.optional(), template: z.enum(['classic', 'modern']).optional() })
    .optional(),
  hero: z
    .strictObject({
      title: z.string().trim().max(150).optional(),
      subtitle: z.string().trim().max(300).optional(),
      imageUrl: url.optional(),
    })
    .optional(),
  about: z.string().trim().max(5000).optional(),
  mission: z.string().trim().max(2000).optional(),
  headMessage: z
    .strictObject({
      name: z.string().trim().max(100),
      designation: z.string().trim().max(100),
      photoUrl: url.optional(),
      text: z.string().trim().max(3000),
    })
    .optional(),
  admissionInfo: z
    .strictObject({
      isOpen: z.boolean(),
      text: z.string().trim().max(2000).optional(),
      classes: z.array(z.string().trim().max(40)).max(20).optional(),
      lastDate: z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD').optional(),
    })
    .optional(),
  contact: z
    .strictObject({
      phone: z.string().trim().max(30).optional(),
      email: z.string().email().optional(),
      address: z.string().trim().max(300).optional(),
      mapUrl: z.string().url().max(500).optional(),
    })
    .optional(),
  gallery: z
    .array(z.strictObject({ url, caption: z.string().trim().max(150).optional() }))
    .max(60)
    .optional(),
  social: z
    .strictObject({
      facebook: z.string().url().max(300).optional(),
      youtube: z.string().url().max(300).optional(),
    })
    .optional(),
  seo: z
    .strictObject({
      title: z.string().trim().max(70).optional(),
      description: z.string().trim().max(160).optional(),
    })
    .optional(),
  sectionsVisible: z
    .strictObject({
      about: z.boolean(),
      teachers: z.boolean(),
      notices: z.boolean(),
      gallery: z.boolean(),
      admission: z.boolean(),
      results: z.boolean(),
      routine: z.boolean(),
      feeLookup: z.boolean(),
    })
    .partial()
    .optional(),
});

export const staffProfileBody = z.strictObject({
  userId: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  designation: z.string().trim().min(2).max(100),
  photoUrl: url.optional(),
  bio: z.string().trim().max(1000).optional(),
  showOnPublicSite: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
});
