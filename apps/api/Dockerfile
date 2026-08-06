# Build context: monorepo root
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @job-talentio/shared build
RUN pnpm --filter @job-talentio/api prisma:generate
RUN pnpm --filter @job-talentio/api build
# Fail the image build if Nest emitted the wrong layout (e.g. dist/src/main.js).
RUN test -f /app/apps/api/dist/main.js

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules

WORKDIR /app/apps/api
EXPOSE 4000
# Nest emits dist/main.js when only `src` is compiled (see tsconfig.build.json).
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
