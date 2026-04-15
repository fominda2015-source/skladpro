# Pre-Mobile Regression Checklist

## 1) Build and startup

- [ ] API: `npm run build` passes in `apps/api`
- [ ] Web: `npm run build` passes in `apps/web`
- [ ] API starts without runtime errors: `npm run dev` in `apps/api`
- [ ] Web starts and connects to API: `npm run dev` in `apps/web`

## 2) Roles and data scope

- [ ] Warehouse manager sees only allowed warehouses/projects
- [ ] Foreman sees team tasks and only scoped data
- [ ] Project manager sees project-scoped issues, waybills, tools
- [ ] Blocked users cannot access protected routes
- [ ] Sidebar hides tabs that are not allowed by permissions

## 3) Core workflows

### Issues (Выдачи)
- [ ] Create draft issue request
- [ ] Send to approval and approve/reject flows work
- [ ] Issue materials updates stocks and operation records
- [ ] Conflict cases show consistent error/conflict banners

### Waybills (ТН)
- [ ] Create waybill with items
- [ ] Status transitions `DRAFT -> FORMED -> SHIPPED -> RECEIVED -> CLOSED` work
- [ ] Events history is appended and visible
- [ ] PDF export opens/downloads correctly

### Tools (Инструменты)
- [ ] Create tool with QR and inventory number
- [ ] Status action flows work (`ISSUE`, `RETURN`, `SEND_TO_REPAIR`, etc.)
- [ ] Tool event log updates after every action
- [ ] QR preview and label PDF generation work

## 4) Team and inbox

- [ ] Team page loads employees and tasks with permissions applied
- [ ] Task creation notifies assignee
- [ ] Inbox shows grouped notifications and tasks
- [ ] Inbox deep-links open correct entity card/module
- [ ] Batch "mark as read" works

## 5) Data UX and pagination

- [ ] Issues list supports server pagination/sorting/filtering
- [ ] Waybills list supports server pagination/sorting/filtering
- [ ] Tools list supports server pagination/sorting/filtering
- [ ] Page size selector (`20/50/100`) works for all three lists
- [ ] "Показано X-Y из Z" is correct for all three lists

## 6) States and localization

- [ ] Loading/Empty/Error states are consistent across major screens
- [ ] Result banners use unified tone (`success/error/conflict/neutral`)
- [ ] User-facing status/action labels are localized to Russian
- [ ] No critical English strings left in operational screens

## 7) Contracts and readiness

- [ ] `/api/contracts/openapi.json` reflects runtime responses
- [ ] Paged responses are documented for `issues`, `waybills`, `tools`
- [ ] `/api/contracts/readiness` returns expected checks

## 8) Release decision

- [ ] P0 blockers: none
- [ ] P1 regressions: accepted or fixed
- [ ] Final smoke test signed off
- [ ] Mobile handoff approved
