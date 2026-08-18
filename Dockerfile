FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      patch \
      ca-certificates \
      python3 \
      python-is-python3 \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG DREAMBOT_BUILD=2026-08-18-mineflayer-latest

COPY package.json ./
COPY scripts ./scripts
COPY patches ./patches
COPY stubs ./stubs

RUN npm install --omit=dev && \
    npm install --omit=dev mineflayer@latest minecraft-protocol@latest minecraft-data@latest

COPY . .

RUN node scripts/fetch-base.js

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
