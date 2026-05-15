# Base image
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build backend
RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

# Only copy production dependencies and dist
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/main"]
