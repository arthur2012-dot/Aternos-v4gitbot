FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    python3 \
    python-is-python3 \
    build-essential \
    patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY scripts ./scripts
COPY patches ./patches

RUN npm install

COPY . .

# Ensure overlays applied after full copy
RUN node scripts/fetch-base.js || true

EXPOSE 8081

CMD ["npm", "start"]
