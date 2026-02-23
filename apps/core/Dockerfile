FROM node:20-slim AS base
WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/core/ ./apps/core/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @tec-brain/types build
RUN pnpm --filter @tec-brain/database build
RUN pnpm --filter @tec-brain/telegram build
RUN pnpm --filter @tec-brain/drive build
RUN pnpm --filter @tec-brain/core build

FROM node:20-slim AS production
WORKDIR /app
COPY --from=base /app ./

ENV NODE_ENV=production

EXPOSE 3002
CMD ["node", "apps/core/dist/index.js"]
