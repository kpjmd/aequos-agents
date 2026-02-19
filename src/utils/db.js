import { neon } from '@neondatabase/serverless';
import logger from './logger.js';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  logger.warn('DATABASE_URL not set — database queries will fail');
}

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

export default sql;
