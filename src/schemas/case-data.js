import { z } from 'zod';

const freeText = (label) =>
  z.string({ invalid_type_error: `${label} must be a string` })
    .max(2048, `${label} must be 2048 characters or fewer`)
    .optional();

export const caseDataSchema = z.object({
  primaryComplaint: freeText('primaryComplaint'),
  rawQuery: freeText('rawQuery'),
  symptoms: z.union([
    z.array(z.string().max(2048)).max(20),
    z.string().max(2048)
  ]).optional(),
  painLevel: z.number().min(0).max(10).optional(),
  location: z.string().max(200).optional(),
  bodyPart: z.string().max(200).optional(),
  duration: z.string().max(500).optional(),
  age: z.number().min(0).max(120).optional(),
  gender: z.string().max(50).optional(),
  id: z.string().max(100).optional(),
  // Recovery / context fields
  functionalLevel: z.string().max(500).optional(),
  goals: z.string().max(1000).optional(),
  movementSymptoms: z.string().max(2048).optional(),
  limitations: z.string().max(1000).optional(),
  painImpact: z.string().max(1000).optional(),
  mood: z.string().max(500).optional(),
  complexity: z.number().optional(),
  urgency: z.string().max(50).optional(),
  // Dual-track / enrichment fields
  enableDualTrack: z.boolean().optional(),
  userId: z.string().max(200).optional(),
  isReturningUser: z.boolean().optional(),
  priorConsultations: z.union([
    z.number().int().min(0),
    z.array(z.any()).max(100),
  ]).optional(),
  requestResearch: z.boolean().optional(),
  uploadedImages: z.array(z.any()).max(10).optional(),
  athleteProfile: z.object({}).passthrough().optional(),
  userTier: z.enum(['basic', 'premium']).optional(),
  triageContext: z.object({}).passthrough().optional(),
  agentRecommendations: z.array(z.any()).optional(),
  platformContext: z.object({}).passthrough().optional(),
}).passthrough();
