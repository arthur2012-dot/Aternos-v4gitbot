FROM node:20-bookworm-slim

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

COPY package.json ./
COPY scripts ./scripts
COPY patches ./patches

RUN npm install--omit=dev

COPY . .

RUN node scripts/fetch-base.js

# Railway injects PORT; default 8081 for local
ENV PORT=8081
EXPOSE 8081

CMD ["npm", "start"]
