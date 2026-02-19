import winston from 'winston';
import { agentConfig } from '../config/agent-config.js';

const isProduction = agentConfig.environment.nodeEnv === 'production';

const logger = winston.createLogger({
  level: agentConfig.environment.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'orthoiq-agents' },
  transports: [
    // Always log to console (Railway captures stdout/stderr)
    new winston.transports.Console({
      format: isProduction
        ? winston.format.json() // JSON for production (easier to parse in Railway)
        : winston.format.simple() // Simple format for local development
    }),
  ],
});

// Only add file transports in non-production (Railway has ephemeral filesystem)
if (!isProduction) {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

export default logger;