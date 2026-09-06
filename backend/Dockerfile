FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate --schema prisma/schema.prisma
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5001
CMD ["node", "dist/server.js"]
