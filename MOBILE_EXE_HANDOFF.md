# Mobile + EXE Handoff

Этот документ фиксирует последний крупный шаг перед переходом к мобильной версии и стабильному desktop `.exe`.

## Что уже закрыто

- Выдачи переведены на отдельные поля данных:
  - `IssueRequest.responsibleName`
  - `IssueRequest.flowType` (`REQUEST` / `DIRECT_ISSUE`)
- На web добавлены:
  - фильтрация по потоку выдачи
  - бейдж потока в таблице
  - KPI-карточки по потокам с быстрым фильтром
- Для legacy-данных есть backfill-скрипт:
  - `npm run backfill:issue-responsible --workspace @skladpro/api`

## Что изменено для desktop `.exe`

- Desktop теперь умеет грузить встроенный web-бандл из пакета (если он есть).
- `pack:win` на уровне root собирает web + desktop последовательно.
- Это позволяет выпускать более предсказуемый `.exe`, не завязанный на dev-server.

## Команды релизной проверки

```bash
npm run release:preflight
```

Сборка `.exe`:

```bash
npm run pack:win
```

## Минимальный план перехода к mobile

1. **Стабилизация API-контрактов**
   - зафиксировать OpenAPI как source of truth
   - не менять payload без версии/совместимости

2. **Вынос API-слоя из `App.tsx`**
   - собрать модуль `apiClient` (auth, issues, stocks, operations)
   - одинаковый слой для web/desktop/mobile

3. **Декомпозиция экранов**
   - выделить `IssuesScreen`, `WarehouseScreen`, `OperationsScreen`, `InboxScreen`
   - убрать критическую зависимость от “монолитного” состояния `App.tsx`

4. **Mobile shell (Capacitor/React Native)**
   - стартовать с `Issues`, `Warehouse`, `Inbox`
   - auth + push + базовые офлайн-кэши

5. **Единый release cycle**
   - web + api + desktop + mobile RC
   - общий regression checklist перед релизом

## Что сделать прямо перед началом mobile-ветки

- Выполнить backfill:
  - `npm run backfill:issue-responsible --workspace @skladpro/api`
- Убедиться, что БД обновлена под новые поля (`prisma db push`/миграции).
- Прогнать `npm run release:preflight`.
- Зафиксировать релизный тег и от него открыть mobile-ветку.
