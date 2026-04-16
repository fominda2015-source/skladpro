# SkladPro Monorepo

Проект включает:
- `apps/web` — web-клиент (React + Vite)
- `apps/api` — API (Express + Prisma)
- `apps/desktop` — desktop `.exe` (Electron + auto-update)

## Быстрый старт

1. Установить Node.js 22 LTS.
2. Установить зависимости:

```bash
npm install
```

3. Создать env для API и web:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

4. Запуск dev:

```bash
npm run dev:api
npm run dev:web
```

Проверка:
- web: `http://localhost:5173`
- api: `http://localhost:4000/api/health`
- db health: `http://localhost:4000/api/health/db`

## Prisma

```bash
npm run prisma:generate --workspace @skladpro/api
npm run prisma:db:push --workspace @skladpro/api
```

## Release Preflight

Единая проверка сборок перед релизом:

```bash
npm run release:preflight
```

## Desktop (.exe)

Теперь desktop-сборка включает собранный web-бандл внутрь приложения.

Сборка `.exe`:

```bash
npm run pack:win
```

Собрать полный install-бандл в одну папку:

```bash
npm run release:bundle
```

Папка результата:
- `release/install-bundle`

Подготовить update-канал, который коммитится в git:

```bash
npm run release:git-channel
```

После этого файлы лежат в:
- `updates/win/x64`

Публикация обновлений:

```bash
npm run publish:win --workspace @skladpro/desktop
```

Перед публикацией проверьте `apps/desktop/package.json`:
- `build.publish[0].url`

## Переход к мобильной версии

Подробный handoff-план:
- `MOBILE_EXE_HANDOFF.md`

## VPS

Инструкция деплоя:
- `DEPLOY_VPS.md`
