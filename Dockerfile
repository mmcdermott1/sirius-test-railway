FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

COPY shared ./shared

ENV NODE_ENV=production

# Flight Control provides PORT via environment variable (typically 3000)
# The app reads process.env.PORT to bind to the correct port
EXPOSE 3000

# Health check uses the PORT env var - Flight Control handles this externally
# so we can remove the internal healthcheck and let the load balancer do it
CMD ["npm", "start"]
