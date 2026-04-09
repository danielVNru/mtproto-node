#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="/opt/mtproto-node"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MTProto Service Node — Удаление       ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Ошибка: запустите скрипт от root (sudo).${NC}"
    exit 1
fi

echo -e "${YELLOW}Будут удалены:${NC}"
echo -e "  - Все прокси-контейнеры (mtproto-proxy-*)"
echo -e "  - Все xray-контейнеры (mtproto-xray-*)"
echo -e "  - Контейнер nginx (mtproto-nginx)"
echo -e "  - Контейнер сервис-ноды"
echo -e "  - Docker-образы прокси (telemt-proxy-*)"
echo -e "  - Docker-сеть mtproto-net"
echo -e "  - Каталог ${INSTALL_DIR}"
echo ""
read -p "Вы уверены? (y/N): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo -e "${CYAN}Отменено.${NC}"
    exit 0
fi

echo ""

# Stop and remove proxy containers
echo -e "${CYAN}[1/6] Остановка прокси-контейнеров...${NC}"
PROXY_CONTAINERS=$(docker ps -a --format '{{.Names}}' | grep '^mtproto-proxy-' || true)
if [ -n "$PROXY_CONTAINERS" ]; then
    COUNT=$(echo "$PROXY_CONTAINERS" | wc -l)
    echo "$PROXY_CONTAINERS" | xargs -r docker rm -f 2>/dev/null || true
    echo -e "${GREEN}  Удалено прокси: ${COUNT}${NC}"
else
    echo -e "${YELLOW}  Прокси-контейнеров не найдено${NC}"
fi

# Stop and remove xray containers
echo -e "${CYAN}[2/6] Остановка xray-контейнеров...${NC}"
XRAY_CONTAINERS=$(docker ps -a --format '{{.Names}}' | grep '^mtproto-xray-' || true)
if [ -n "$XRAY_CONTAINERS" ]; then
    COUNT=$(echo "$XRAY_CONTAINERS" | wc -l)
    echo "$XRAY_CONTAINERS" | xargs -r docker rm -f 2>/dev/null || true
    echo -e "${GREEN}  Удалено xray: ${COUNT}${NC}"
else
    echo -e "${YELLOW}  Xray-контейнеров не найдено${NC}"
fi

# Stop and remove nginx container
echo -e "${CYAN}[3/6] Остановка nginx...${NC}"
if docker ps -a --format '{{.Names}}' | grep -q '^mtproto-nginx$'; then
    docker rm -f mtproto-nginx 2>/dev/null || true
    echo -e "${GREEN}  Nginx удалён.${NC}"
else
    echo -e "${YELLOW}  Nginx-контейнер не найден${NC}"
fi

# Stop and remove service-node container
echo -e "${CYAN}[4/6] Остановка сервис-ноды...${NC}"
if [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
    cd "$INSTALL_DIR"
    docker compose down --rmi local 2>/dev/null || true
    echo -e "${GREEN}  Сервис-нода удалена.${NC}"
else
    # Try removing by name
    docker rm -f mtproto-service-node 2>/dev/null || true
    echo -e "${GREEN}  Контейнер удалён.${NC}"
fi

# Remove proxy images and network
echo -e "${CYAN}[5/6] Удаление образов и сети...${NC}"
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^telemt-proxy-' | xargs -r docker rmi -f 2>/dev/null || true
docker image rm -f teddysun/xray 2>/dev/null || true
docker network rm mtproto-net 2>/dev/null || true
docker image prune -f 2>/dev/null || true
echo -e "${GREEN}  Готово.${NC}"

# Remove install directory
echo -e "${CYAN}[6/6] Удаление каталога ${INSTALL_DIR}...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo -e "${GREEN}  Каталог удалён.${NC}"
else
    echo -e "${YELLOW}  Каталог не найден, пропуск...${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Сервис-нода полностью удалена.        ${NC}"
echo -e "${GREEN}========================================${NC}"
