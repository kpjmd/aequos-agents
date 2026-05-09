import { z } from 'zod';
import { caseDataSchema } from './case-data.js';

const SPECIALIST_TYPES = ['triage', 'painWhisperer', 'movementDetective', 'strengthSage', 'mindMender'];

export const consultationSchema = z.object({
  caseData: caseDataSchema,
  requiredSpecialists: z.array(z.enum(SPECIALIST_TYPES)).max(6).optional(),
  mode: z.enum(['fast', 'normal', 'comprehensive']).default('fast'),
  queryType: z.enum(['informational', 'clinical']).optional(),
  platformContext: z.object({}).passthrough().optional(),
  noCache: z.boolean().optional(),
  userTier: z.enum(['basic', 'premium']).optional(),
}).strict();
