# syntax=docker/dockerfile:1.7

# ---- build: instala deps, roda checagens e gera os bundles
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: só o bundle do servidor (dependências embutidas) e os estáticos.
# Sem node_modules, sem npm, sem código-fonte: superfície de ataque mínima.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*
COPY --from=build --chown=node:node /app/packages/server/dist/server.cjs /app/packages/server/dist/server.cjs.map ./
COPY --from=build --chown=node:node /app/packages/client/dist ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
# node como PID 1 recebe SIGTERM direto e faz shutdown gracioso.
CMD ["node", "--enable-source-maps", "server.cjs"]
