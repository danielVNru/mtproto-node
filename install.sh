#!/bin/bash
set -e

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

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker не найден. Устанавливаю Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version &> /dev/null 2>&1; then
    echo -e "${RED}Docker Compose не найден. Установите Docker Compose.${NC}"
    exit 1
fi

# Check git
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}Git не найден. Устанавливаю git...${NC}"
    apt-get update -qq && apt-get install -y -qq git > /dev/null 2>&1 || \
    yum install -y -q git > /dev/null 2>&1 || \
    apk add --no-cache git > /dev/null 2>&1
fi

# Clone or update repo
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${CYAN}Обновление из репозитория...${NC}"
    cd "$INSTALL_DIR"
    git fetch origin master
    git reset --hard origin/master
else
    echo -e "${CYAN}Скачивание последней версии...${NC}"
    git clone --branch master "$REPO_URL" "$INSTALL_DIR"
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

# Generate 32-char token
AUTH_TOKEN=$(openssl rand -hex 16)

echo ""
echo -e "${GREEN}Конфигурация:${NC}"
echo -e "  Порт:  ${YELLOW}${PORT}${NC}"
echo -e "  Токен: ${YELLOW}${AUTH_TOKEN}${NC}"
echo ""
echo -e "${YELLOW}⚠  СОХРАНИТЕ ТОКЕН! Он понадобится для подключения из панели.${NC}"
echo ""

# Create .env file
cat > .env << EOF
PORT=${PORT}
AUTH_TOKEN=${AUTH_TOKEN}
EOF

# Create data directory
mkdir -p data

# Build and start
echo -e "${CYAN}Сборка и запуск сервис-ноды...${NC}"
docker compose up -d --build

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Сервис-нода запущена!                 ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  API:     ${CYAN}http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '0.0.0.0'):${PORT}${NC}"
echo -e "  Токен:   ${YELLOW}${AUTH_TOKEN}${NC}"
echo -e "  Каталог: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "${GREEN}========================================${NC}"
