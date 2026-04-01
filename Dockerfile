FROM node:20-alpine

RUN apk add --no-cache bash git docker-cli docker-cli-compose

WORKDIR /app

COPY package.json package-lock.json* ./
RUN echo "nameserver 8.8.8.8" > /etc/resolv.conf && npm install --production=false

COPY tsconfig.json ./
COPY src ./src
COPY update.sh ./update.sh
RUN chmod +x ./update.sh

RUN npm run build
RUN npm prune --production

EXPOSE 8443

CMD ["node", "dist/index.js"]
