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

COPY package.json ./
COPY scripts ./scripts
COPY patches ./patches
COPY stubs ./stubs

# Single install — do not fail build on optional extras
RUN npm install --omit=dev --no-audit --no-fund || \
    (echo '[docker] npm install retry' && npm install --omit=dev --no-audit --no-fund --legacy-peer-deps)

COPY . .

# Mindcraft tree + patches (non-fatal if network flake)
RUN node scripts/fetch-base.js || echo '[docker] fetch-base deferred to start'

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
