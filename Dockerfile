# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
ENV DATA_PATH=/data/tradingapp.sqlite
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node package.json package-lock.json ./
# Optional CA mount is used only by managed cloud builds with an HTTPS proxy.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --ignore-scripts --strict-ssl=true && npm cache clean --force
COPY --chown=node:node companies.js news.js server.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node lib ./lib
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok || (await r.json()).status!=='ok') process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
