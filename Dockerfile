FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV CANONICAL_DOMAIN=https://aldridgeautosupply.com
ENV PUBLIC_PWA_URL=https://aldridgeautosupply.com
ENV SHOPIFY_SHOP_DOMAIN=aldridgesales.myshopify.com
ENV SHOPIFY_DOMAIN=aldridgesales.myshopify.com

COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY data/command_hub.db ./data/command_hub.db
COPY data/review_catalog.json ./data/review_catalog.json
COPY data/uploads ./data/uploads

EXPOSE 8080

CMD ["node", "src/server.js"]
