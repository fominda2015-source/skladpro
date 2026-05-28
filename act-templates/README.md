# Шаблоны актов

Скопируйте сюда ваши `.xlsx` с **точными именами**:

- `Возврат.xlsx`
- `Межподразделенческая.xlsx`
- `Недостача.xlsx`
- `Неисправность.xlsx`
- `Порча.xlsx`
- `Прием-передача ТМЦ.xlsx`
- `Списание.xlsx`
- `Утеря.xlsx`
- `Утилизация.xlsx`
- `Хищение.xlsx`

Затем выполните:

```powershell
Copy-Item -Path "act-templates\*.xlsx" -Destination "apps\web\public\acts\" -Force
```

Файлы из `apps/web/public/acts/` попадают во вкладку **«Акты»** в приложении.
