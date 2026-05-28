# Отчёт по UX/UI-редизайну (ТЗ из docx)

## Внедрено

### Дизайн-система
- `erp-design.css`, `TabShell`, `PageHero`, `FilterStrip`, `StatusBadge`, `EmptyState`, `detailDrawer`

### Главная
- KPI включая **просроченные поверки**
- График **движения за 30 дней** (приход/расход)
- Быстрые действия: создать заявку, принять возврат, поверки, QR
- Таблица объектов, объявления, блок внимания

### Лимиты · Инструменты · Приходы · Заявки · Документы · Перемещения · Сводка · Акты
- Табличные виды, KPI, FilterStrip, split-view (документы)
- **Side-panel** карточки инструмента (`ToolDetailDrawer`)
- **Side-panel** таблицы заявки (`RequestMaterialsModal` embedded)

### Поверки (новая вкладка ◷)
- `VerificationsTab` — реестр с фильтрами просрочка / 30 дней / без даты
- Поле `calibrationDueAt` в БД и API инструментов

### Склад — зоны хранения
- `WarehouseZonesTable` — агрегация по комнате/ячейке из остатков

### Уведомления
- «К объекту» для warehouse, stock, operation, camp, tool, receipt, issue, waybill

### Акты
- Список с API (`GET /api/acts/templates`)
- **Загрузка шаблонов** на сервер (`POST /api/acts/upload`, право `documents.write`)

### Сводка по объекту
- `ReportsRiskPanel` — лимиты, поверки, приходы, ТН, переходы в разделы

---

## Миграция БД

```bash
cd apps/api && npx prisma migrate deploy
```

Файл: `20260527150000_tool_calibration_due` — поле `Tool.calibrationDueAt`.

---

## Ограничения / дальше

| Тема | Примечание |
|------|------------|
| WMS-ячейки | Упрощённая карта по `storageRoom`/`storageCell`, не полноценный WMS |
| KPI поверок без даты | В KPI только инструменты с заполненной `calibrationDueAt` |
| Городок / мат.отчёт / аудит | Базовый ERP-стиль; при необходимости — отдельные таблицы как у лимитов |
