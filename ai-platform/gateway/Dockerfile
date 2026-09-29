FROM node:22-alpine AS build
WORKDIR /build
COPY sdk ./sdk
COPY gateway ./gateway
WORKDIR /build/gateway
RUN npm install --no-audit --no-fund && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /build/gateway/package.json ./package.json
COPY --from=build /build/gateway/node_modules ./node_modules
COPY --from=build /build/gateway/dist ./dist
EXPOSE 8080
CMD ["node", "dist/gateway/src/server.js"]
