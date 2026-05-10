import { z } from 'zod';
import { caseDataSchema } from './case-data.js';

// /triage body: top-level fields are the case data directly
export const triageSchema = caseDataSchema;
