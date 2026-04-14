# SkladPro Monorepo

Стартовый каркас под:
- web (React)
- api (Express)
- desktop `.exe` (Electron + auto-update)
- VPS deployment (Docker Compose + Nginx + PostgreSQL)

## Быстрый локальный старт

1. Установить Node.js 22 LTS.
2. В корне выполнить:

```bash
npm install
```

3. Для API создать env:

```bash
cp apps/api/.env.example apps/api/.env
```

4. Запустить API:

```bash
npm run dev:api
```

5. В другом терминале запустить web:

```bash
npm run dev:web
```

5. Проверка:
- web: `http://localhost:5173`
- api: `http://localhost:4000/api/health`
- db health: `http://localhost:4000/api/health/db`

## Prisma (БД)

Схема БД лежит в:
- `apps/api/prisma/schema.prisma`

Локальные команды:

```bash
npm run prisma:generate --workspace @skladpro/api
npm run prisma:db:push --workspace @skladpro/api
```

## Desktop

Сборка Windows-установщика:

```bash
npm run build:desktop
npm run pack:win --workspace @skladpro/desktop
```

Публикация обновлений в канал сервера:

```bash
npm run publish:win --workspace @skladpro/desktop
```

Перед реальной публикацией замените URL в `apps/desktop/package.json`:
- `build.publish[0].url`

## VPS

Подробная инструкция:
- `DEPLOY_VPS.md`
