# MTProto Service Node

Сервис-нода для управления MTProto прокси контейнерами. Устанавливается на каждый прокси-сервер и управляется через [MTProto Panel](https://github.com/danielVNru/mtproto-panel).

## Возможности

- Автоматическое создание и управление Docker контейнерами с MTProto прокси
- Единый nginx на порту 443 с fake TLS маскировкой
- SNI-based роутинг трафика по доменам
- Статистика прокси: CPU, RAM, трафик, аптайм
- Подключённые IP-адреса с определением страны (ip-api.com)
- Чёрный список IP-адресов (блокировка через nginx)
- Лимиты одновременных подключений на прокси
- Пользовательский пул доменов для fake TLS (50 доменов по умолчанию)
- Обновление из панели управления
- REST API с авторизацией по токену
- Использует [seriyps/mtproto_proxy](https://github.com/seriyps/mtproto_proxy) (Erlang)

## Архитектура

```
┌──────────────────────────────────────┐
│           Service Node               │
│                                      │
│  ┌────────────┐    ┌──────────────┐  │
│  │  Express   │    │  nginx :443  │  │
│  │  API :8443 │    │  (fake TLS)  │  │
│  └────────────┘    └──────┬───────┘  │
│                     SNI routing       │
│            ┌──────────┼──────────┐   │
│            │          │          │   │
│         ┌──┴──┐   ┌──┴──┐   ┌──┴──┐│
│         │proxy│   │proxy│   │proxy││
│         │  1  │   │  2  │   │  N  ││
│         └─────┘   └─────┘   └─────┘│
└──────────────────────────────────────┘
```

## Быстрая установка

Одна команда для загрузки и запуска:

```bash
wget -qO /tmp/node-install.sh https://raw.githubusercontent.com/danielVNru/mtproto-node/master/install.sh && sudo bash /tmp/node-install.sh
```

Скрипт автоматически:
1. Установит Docker и Docker Compose (если отсутствуют)
2. Скачает последнюю версию из ветки `master`
3. Запросит настройки:
   - **Порт API** (по умолчанию `8443`)
4. Сгенерирует **токен авторизации** (32 символа)
5. Соберёт и запустит контейнер

Сервис-нода установится в `/opt/mtproto-node`.

> ⚠️ **Сохраните токен!** Он понадобится для подключения ноды в панели управления.

## Обновление

### Из панели

Нажмите кнопку «Обновить» на карточке ноды в панели управления.

### Вручную

```bash
cd /opt/mtproto-node
git pull origin master
docker compose up -d --build
```

Скрипт `update.sh` автоматически остановит ноду, обновит код, пересоберёт контейнер и восстановит все запущенные прокси.

## Структура контейнеров

| Контейнер | Описание | Порт |
|-----------|----------|------|
| `mtproto-service-node` | Express API + управление | `${PORT}:8443` |
| `mtproto-nginx` | nginx stream proxy (fake TLS) | `443` |
| `mtproto-proxy-*` | MTProto прокси контейнеры | внутренняя сеть |

## Конфигурация (.env)

| Переменная | Описание |
|------------|----------|
| `PORT` | Внешний порт API сервис-ноды |
| `AUTH_TOKEN` | Токен авторизации для подключения из панели |

## API

Все запросы (кроме `/api/health`) требуют заголовок `Authorization: Bearer <TOKEN>`.

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/proxies` | Список прокси |
| `POST` | `/api/proxies` | Создать прокси |
| `GET` | `/api/proxies/:id` | Детали прокси |
| `PUT` | `/api/proxies/:id` | Обновить прокси |
| `DELETE` | `/api/proxies/:id` | Удалить прокси |
| `GET` | `/api/proxies/:id/stats` | Статистика прокси |
| `GET` | `/api/proxies/:id/link?server_ip=X` | Ссылка для подключения |
| `POST` | `/api/proxies/:id/restart` | Перезапустить прокси |
| `POST` | `/api/proxies/:id/pause` | Приостановить прокси |
| `POST` | `/api/proxies/:id/unpause` | Возобновить прокси |
| `GET` | `/api/domains` | Получить домены fake TLS |
| `PUT` | `/api/domains` | Задать пользовательские домены |
| `GET` | `/api/blacklist` | Получить чёрный список IP |
| `PUT` | `/api/blacklist` | Обновить чёрный список IP |

### Создание прокси

```bash
curl -X POST http://NODE_IP:8443/api/proxies \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"port": 3001, "domain": "www.google.com", "maxConnections": 2}'
```

| Параметр | Обязательный | Описание |
|----------|:---:|----------|
| `port` | Нет | Внутренний порт (случайный если не указан) |
| `domain` | Нет | Fake TLS домен (случайный из пула) |
| `tag` | Нет | Промо-тег для Telegram |
| `name` | Нет | Название прокси |
| `note` | Нет | Заметка |
| `maxConnections` | Нет | Лимит одновременных подключений (0 = без лимита) |

## Требования

- Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- Docker Engine 20.10+
- Docker Compose v2
- Порт 443 свободен (для nginx)
- 512 MB RAM, 1 GB диск

## Связанный проект

Панель управления: [mtproto-panel](https://github.com/danielVNru/mtproto-panel)
