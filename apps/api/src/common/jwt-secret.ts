import { ConfigService } from '@nestjs/config';

const DEV_FALLBACK = 'local-dev-jwt-secret';

/** True when process should reject weak/default JWT secrets. */
export function isSecureRuntime(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') return true;
  // Railway / staging containers usually set these even when NODE_ENV=production
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return true;
  return process.env.REQUIRE_STRONG_SECRETS === 'true';
}

/**
 * Resolve JWT signing secret. In secure runtimes, missing/weak defaults fail fast
 * so staging/prod cannot boot with forgeable tokens.
 */
export function resolveJwtSecret(config?: ConfigService): string {
  const secret =
    (config?.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET)?.trim() || '';

  if (!secret || secret === DEV_FALLBACK || secret.length < 32) {
    if (isSecureRuntime()) {
      throw new Error(
        'JWT_SECRET must be set to a strong value (min 32 chars) in staging/production. Refusing to start with a weak/default secret.',
      );
    }
    return secret || DEV_FALLBACK;
  }
  return secret;
}
