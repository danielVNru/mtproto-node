#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

REPO_URL="https://github.com/danielVNru/mtproto-node.git"
INSTALL_DIR="/opt/mtproto-node"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MTProto Service Node — Установка      ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check root
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Ошибка: запустите скрипт от root (sudo).${NC}"
    echo -e "  sudo bash <(wget -qO- ...)"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker не найден. Устанавливаю Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка установки Docker.${NC}"
        exit 1
    fi
fi

if ! docker compose version &> /dev/null 2>&1; then
    echo -e "${YELLOW}Docker Compose не найден. Устанавливаю...${NC}"
    COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
    COMPOSE_VERSION=${COMPOSE_VERSION:-v2.34.0}
    ARCH=$(uname -m)
    [ "$ARCH" = "x86_64" ] && ARCH="x86_64"
    [ "$ARCH" = "aarch64" ] && ARCH="aarch64"
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

if ! docker compose version &> /dev/null 2>&1; then
    echo -e "${RED}Не удалось установить Docker Compose.${NC}"
    exit 1
fi

# Check git
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}Git не найден. Устанавливаю git...${NC}"
    if command -v apt-get &> /dev/null; then
        apt-get update -qq && apt-get install -y -qq git
    elif command -v yum &> /dev/null; then
        yum install -y -q git
    elif command -v apk &> /dev/null; then
        apk add --no-cache git
    fi
    if ! command -v git &> /dev/null; then
        echo -e "${RED}Не удалось установить git.${NC}"
        exit 1
    fi
fi

# Clone or update repo
if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "${CYAN}Обновление из репозитория...${NC}"
    cd "$INSTALL_DIR"
    git fetch origin master
    git reset --hard origin/master
else
    echo -e "${CYAN}Скачивание последней версии...${NC}"
    rm -rf "$INSTALL_DIR"
    git clone --branch master "$REPO_URL" "$INSTALL_DIR"
    if [ $? -ne 0 ]; then
        echo -e "${RED}Ошибка клонирования репозитория.${NC}"
        exit 1
    fi
    cd "$INSTALL_DIR"
fi

# Ask for port
echo ""
read -p "Порт сервис-ноды [8443]: " PORT
PORT=${PORT:-8443}

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo -e "${RED}Некорректный номер порта${NC}"
    exit 1
fi

read -p "Порт прокси (nginx) [443]: " NGINX_PORT
NGINX_PORT=${NGINX_PORT:-443}

if ! [[ "$NGINX_PORT" =~ ^[0-9]+$ ]] || [ "$NGINX_PORT" -lt 1 ] || [ "$NGINX_PORT" -gt 65535 ]; then
    echo -e "${RED}Некорректный номер порта${NC}"
    exit 1
fi

# Generate 32-char token
AUTH_TOKEN=$(openssl rand -hex 16)

echo ""
echo -e "${GREEN}Конфигурация:${NC}"
echo -e "  Порт API:    ${YELLOW}${PORT}${NC}"
echo -e "  Порт прокси: ${YELLOW}${NGINX_PORT}${NC}"
echo -e "  Токен: ${YELLOW}${AUTH_TOKEN}${NC}"
echo ""
echo -e "${YELLOW}⚠  СОХРАНИТЕ ТОКЕН! Он понадобится для подключения из панели.${NC}"
echo ""

# Create .env file
cat > .env << EOF
PORT=${PORT}
NGINX_PORT=${NGINX_PORT}
AUTH_TOKEN=${AUTH_TOKEN}
EOF

# Create data directory
mkdir -p data

# Build and start
echo -e "${CYAN}Сборка и запуск сервис-ноды...${NC}"
docker network create mtproto-net 2>/dev/null || true
docker build --network=host -t mtproto-node-service-node .
if [ $? -ne 0 ]; then
    echo -e "${RED}Ошибка при сборке образа.${NC}"
    exit 1
fi
docker compose up -d

if [ $? -ne 0 ]; then
    echo -e "${RED}Ошибка при запуске контейнеров.${NC}"
    exit 1
fi

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
SERVER_IP=${SERVER_IP:-"0.0.0.0"}

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Сервис-нода запущена!                 ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  API:     ${CYAN}http://${SERVER_IP}:${PORT}${NC}"
echo -e "  Токен:   ${YELLOW}${AUTH_TOKEN}${NC}"
echo -e "  Каталог: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "${GREEN}========================================${NC}"
