FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS base
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy workspace config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy only the packages needed for the scraper
COPY packages/types/ ./packages/types/
COPY apps/scraper/ ./apps/scraper/

# Install deps
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm --filter @tec-brain/types build
RUN pnpm --filter @tec-brain/scraper build

FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS production
WORKDIR /app

RUN npm install -g pnpm@9
COPY --from=base /app ./

ENV NODE_ENV=production

EXPOSE 3001
CMD ["node", "apps/scraper/dist/index.js"]
