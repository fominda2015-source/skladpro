# VPS: запуск с нуля (IP 193.176.78.148)

Инструкция ниже привязана к вашему VPS `193.176.78.148`.
Текущий канал автообновлений desktop настроен на:
- `http://193.176.78.148/updates/win/x64`

## 1) Подготовка

- VPS: Ubuntu 22.04
- SSH-доступ
- Локально (Windows): `git`, Node.js 22 LTS, `scp`

Подключение:

```powershell
ssh root@193.176.78.148
```

## 2) Базовая настройка Ubuntu

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg git ufw
timedatectl set-timezone Europe/Moscow
```

Firewall:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw --force enable
ufw status
```

## 3) Установка Docker + Compose

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version
```

## 4) Клонирование проекта

```bash
mkdir -p /opt/skladpro
cd /opt/skladpro
git clone <URL_ВАШЕГО_РЕПО> .
```

## 5) Настройка env

```bash
cp .env.example .env
nano .env
```

Обязательно поменять:
- `POSTGRES_PASSWORD` (сложный пароль)

## 6) Первый запуск проекта

```bash
cd /opt/skladpro
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

Проверка:
- `http://193.176.78.148/api/health`
- `http://193.176.78.148/api/health/db`

## 7) Что сделано по БД в проекте

- Подключен `Prisma`
- Схема: `apps/api/prisma/schema.prisma`
- В `docker-compose` API при старте делает:
  - `npm run prisma:db:push`
  - потом запускается сервер

Это означает: при первом старте таблицы создадутся автоматически в PostgreSQL.

## 8) Канал обновлений .exe через git

Теперь update-канал берется из репозитория:
- локально: `updates/win/x64`
- внутри nginx: `/var/www/updates/win/x64`

Проверка в браузере:
- `http://193.176.78.148/updates/win/x64/latest.yml`

## 9) Публикация новой версии desktop (git flow)

На локальной Windows-машине:

1. Поднять версию в `apps/desktop/package.json`
2. Выполнить:

```powershell
npm install
npm run release:git-channel
```

Команда:
- соберет инсталлер
- соберет единый install-бандл
- положит update-файлы в `updates/win/x64`

3. Закоммитить и запушить update-файлы:

```powershell
git add updates/win/x64
git commit -m "release desktop 0.1.x"
git push
```

4. На VPS:

```bash
cd /opt/skladpro
git pull
docker compose up -d nginx
```

После `git pull` клиенты получают обновление автоматически через `latest.yml`.

## 10) Бэкапы БД (обязательно)

Создать папку:

```bash
mkdir -p /opt/skladpro/backups
```

Тестовый бэкап:

```bash
docker exec skladpro-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > /opt/skladpro/backups/db_$(date +%F_%H-%M).sql
```

Автоматизация (cron):

```bash
crontab -e
```

Добавить:

```cron
0 2 * * * docker exec skladpro-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > /opt/skladpro/backups/db_$(date +\%F).sql
```

## 11) Ежедневные команды обслуживания

- Перезапуск с пересборкой:
```bash
cd /opt/skladpro && docker compose up -d --build
```
- Логи API:
```bash
cd /opt/skladpro && docker compose logs -f api
```
- Проверка контейнеров:
```bash
cd /opt/skladpro && docker compose ps
```
- Остановка:
```bash
cd /opt/skladpro && docker compose down
```

## 12) Важный этап после запуска (рекомендую)

Сейчас update-канал работает по HTTP (из-за IP). Для production лучше перейти на домен + HTTPS:
- `skladpro.yourdomain.ru`
- обновить `publish.url` в `apps/desktop/package.json` на `https://...`
- выпустить SSL-сертификат.
