FROM node:20-alpine AS builder
WORKDIR /app

# 1. Build Dashboard
COPY dashboard/package*.json ./dashboard/
RUN cd dashboard && npm ci
COPY dashboard ./dashboard
RUN cd dashboard && npm run build

# 2. Build API
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# 3. Production Runtime
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dashboard/dist ./dashboard/dist
COPY landing ./landing
EXPOSE 3200
CMD ["node", "dist/index.js"]
