FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/api/package.json ./
RUN npm install
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/package.json apps/api/tsconfig.json ./
COPY apps/api/prisma ./prisma
COPY apps/api/src ./src
RUN npx prisma generate
RUN npm run build
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY apps/api/package.json ./
COPY apps/web/public/acts ./seed/acts
EXPOSE 4000
CMD ["sh", "-c", "(npm run prisma:migrate:deploy || echo 'migrate:deploy failed, trying db push' && npx prisma db push --skip-generate || echo 'db push failed, continuing'); node dist/index.js"]
