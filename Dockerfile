FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# canvas (node-canvas) + build tools for prismarine-viewer 3D on mobile
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      python3 \
      python-is-python3 \
      build-essential \
      pkg-config \
      libcairo2-dev \
      libpango1.0-dev \
      libjpeg-dev \
      libgif-dev \
      librsvg2-dev \
      libpixman-1-dev \
      libcairo2 \
      libpango-1.0-0 \
      libjpeg62-turbo \
      libgif7 \
      librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG CACHE_BUST=2026-08-19-canvas-viewer

COPY package.json ./
COPY scripts ./scripts
COPY patches ./patches
COPY stubs ./stubs

RUN npm install --omit=dev --no-audit --no-fund && \
    npm install --no-save --no-audit canvas@^2.11.2 eslint@^9.13.0 @eslint/js@^9.13.0 globals@^15.11.0 eslint-plugin-no-floating-promise@^2.0.0 open@^10.2.0

COPY . .

RUN node scripts/fetch-base.js || echo '[docker] fetch-base deferred to start'

ENV PORT=8080
ENV ENABLE_VIEWER=1
EXPOSE 8080

CMD ["npm", "start"]
