#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MTProto Service Node - Installation   ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
fi

if ! command -v docker compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}Docker Compose not found. Please install Docker Compose.${NC}"
    exit 1
fi

# Ask for port
read -p "Enter service node port [8443]: " PORT
PORT=${PORT:-8443}

# Validate port
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo "Invalid port number"
    exit 1
fi

# Generate 32-char token
AUTH_TOKEN=$(openssl rand -hex 16)

echo ""
echo -e "${GREEN}Configuration:${NC}"
echo -e "  Port:  ${YELLOW}${PORT}${NC}"
echo -e "  Token: ${YELLOW}${AUTH_TOKEN}${NC}"
echo ""
echo -e "${YELLOW}⚠  SAVE THIS TOKEN! You will need it to connect from the panel.${NC}"
echo ""

# Create .env file
cat > .env << EOF
PORT=${PORT}
AUTH_TOKEN=${AUTH_TOKEN}
EOF

# Create data directory
mkdir -p data

# Build and start
echo -e "${CYAN}Building and starting service node...${NC}"
docker compose up -d --build

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Service Node is running!              ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  API:   http://0.0.0.0:${PORT}"
echo -e "  Token: ${AUTH_TOKEN}"
echo -e "${GREEN}========================================${NC}"
