# TEC Brain — Backend Monorepo

"Segundo Cerebro" académico. Sistema backend autónomo que extrae notificaciones del TEC Digital y las distribuye por Telegram y Google Drive, sin herramientas no-code.

## Arquitectura

```
tec-brain/
├── apps/
│   ├── scraper/     # Playwright scraper — POST /scrape/:userId, GET /health
│   └── core/        # Orquestador — Cron, dispatcher, deduplicación
└── packages/
    ├── types/       # Interfaces y tipos compartidos
    ├── database/    # pg client, queries, migraciones, crypto
    ├── telegram/    # TelegramService (Bot API)
    └── drive/       # DriveService (Google Drive API v3)
```

## Prerequisitos

- Node.js >= 20
- pnpm >= 9
- Docker + Docker Compose
- Google Service Account JSON
- Telegram Bot Token

## Configuración

```bash
# 1. Copiar y rellenar variables de entorno
cp .env.example .env

# Generar DB_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Colocar el Service Account JSON de Google
cp ~/downloads/service-account.json ./data/credentials/google_service_account.json
```

## Correr en local (desarrollo)

```bash
# Instalar dependencias
pnpm install

# Levantar PostgreSQL
docker compose up db -d

# Correr migraciones
pnpm --filter @tec-brain/database build
# Luego en core: el servicio las corre automáticamente al iniciar

# Dev mode (2 terminales)
pnpm dev:scraper   # Scraper en :3001
pnpm dev:core      # Core en :3002
```

## Producción

```bash
docker compose up --build -d
```

## Seed de usuarios

Después de levantar la DB, ejecutar:

```bash
# Primero encriptar las contraseñas
node -e "
  const { encrypt } = await import('./packages/database/dist/index.js');
  console.log(encrypt('TU_PASSWORD'));
"

# Luego editar 002_seed.sql con los valores encriptados y correr:
docker exec -i tec-brain-db psql -U tecbrain tecbrain < packages/database/src/migrations/002_seed.sql
```

## Disparar ciclo manual

```bash
curl -X POST http://localhost:3002/api/run-now
```

## Monitoreo

```bash
docker logs -f tec-brain-core     # Ver actividad del orquestador
docker logs -f tec-brain-scraper  # Ver actividad del scraper
```
