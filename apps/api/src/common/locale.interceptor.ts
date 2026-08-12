import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { requestLocale } from './i18n/request-locale';
import type { Locale } from './i18n/locale';

/** Deep walk is bounded so a pathological payload cannot spin the event loop. */
const MAX_DEPTH = 12;

export const RAW_LOCALE_NAMES_KEY = 'rawLocaleNames';

/**
 * Keeps `nameUz` / `nameRu` in the response instead of collapsing them into
 * `name`. Used by the admin catalog screens, which edit the columns directly.
 */
export const RawLocaleNames = () => SetMetadata(RAW_LOCALE_NAMES_KEY, true);

type Localizable = Record<string, unknown> & {
  name: string;
  nameUz?: string | null;
  nameRu?: string | null;
};

function isLocalizable(value: unknown): value is Localizable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string') return false;
  return 'nameUz' in row || 'nameRu' in row;
}

/**
 * Rewrites catalog rows in place-ish: `name` becomes the localized label and the
 * locale columns are dropped, so every client keeps reading a single `name`
 * field. Rows without a translation fall back to the canonical English name.
 */
function localizeDeep(value: unknown, locale: Locale, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => localizeDeep(item, locale, depth + 1));
  }
  if (value instanceof Date) return value;

  const row = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(row)) {
    if (key === 'nameUz' || key === 'nameRu') continue;
    out[key] = localizeDeep(child, locale, depth + 1);
  }

  if (isLocalizable(row)) {
    const translated = locale === 'uz' ? row.nameUz : locale === 'ru' ? row.nameRu : null;
    out.name = (typeof translated === 'string' && translated) || row.name;
  }

  return out;
}

@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const raw = this.reflector.getAllAndOverride<boolean>(RAW_LOCALE_NAMES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    const request = context.switchToHttp().getRequest();
    const locale = requestLocale(request);

    return next.handle().pipe(
      map((body) => (locale === 'en' ? stripLocaleColumns(body) : localizeDeep(body, locale))),
    );
  }
}

/** English already lives in `name`; only the extra columns need removing. */
function stripLocaleColumns(value: unknown): unknown {
  return localizeDeep(value, 'en');
}
