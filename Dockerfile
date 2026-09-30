# Kerangka sidecar image (PLAN.md §11, L1)
#
# One process: the engine over HTTP/JSON and stdio JSON-RPC.
#   docker build -t kerangka-sidecar .
#   docker run --rm -p 3000:3000 -v "$PWD/examples:/models:ro" kerangka-sidecar \
#     serve /models/todo.kerangka.json
#   docker run --rm -i -v "$PWD/examples:/models:ro" kerangka-sidecar \
#     serve /models/todo.kerangka.json --stdio < requests.jsonl

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY conformance ./conformance
COPY examples ./examples

RUN npm ci
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The workspace build is self-contained: packages resolve through the root
# node_modules, so the built tree is copied as-is rather than reinstalled.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/examples ./examples

# The engine is pure; the image carries no store state. Mount a model in.
VOLUME ["/models"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/openapi.json').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "packages/cli/dist/bin/kerangka.js"]
CMD ["serve", "/models/todo.kerangka.json"]
