FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      python3 \
      python-is-python3 \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bust cache when deps change
ARG CACHE_BUST=2026-08-19-eslint

COPY package.json ./
COPY scripts ./scripts
COPY patches ./patches
COPY stubs ./stubs

RUN npm install --omit=dev --no-audit --no-fund && \
    npm install --no-save --no-audit eslint@^9.13.0 @eslint/js@^9.13.0 globals@^15.11.0 eslint-plugin-no-floating-promise@^2.0.0 open@^10.2.0

COPY . .

RUN node scripts/fetch-base.js || echo '[docker] fetch-base deferred to start'

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
