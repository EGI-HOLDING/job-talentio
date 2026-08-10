import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { resolveJwtSecret } from './common/jwt-secret';

async function bootstrap() {
  // Fail fast before Nest wires JWT if staging/prod secrets are weak
  resolveJwtSecret();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // Behind Railway (and optionally Cloudflare) the client IP arrives via
  // X-Forwarded-For; without trust proxy every visitor shares the proxy IP,
  // which breaks per-IP rate limiting. Hops: 1 = Railway edge, 2 = +Cloudflare.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  (app.getHttpAdapter().getInstance() as import('express').Express).set(
    'trust proxy',
    Number.isFinite(trustProxyHops) ? trustProxyHops : 1,
  );
  app.enableCors({
    origin: [
      process.env.WEB_URL ?? 'http://localhost:3000',
      process.env.ADMIN_URL ?? 'http://localhost:3001',
    ],
    credentials: true,
  });

  // Lightweight security headers (no extra dependency)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  // Simple in-memory rate limit for auth endpoints
  const hits = new Map<string, { count: number; resetAt: number }>();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/auth/')) return next();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const windowMs = 60_000;
    const max = 30;
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ statusCode: 429, message: 'Too many requests' });
      return;
    }
    return next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Job Talentio API listening on port ${port}`);
}

bootstrap();
