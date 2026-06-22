# Figcad Node 백엔드 (Railway). nixpacks Node/pnpm 버전 불일치 회피 위해 Dockerfile 고정.
# node:22 + corepack(pnpm@11.6.0 packageManager 핀) → pnpm install → web dist + node 번들 → 단일서비스 서빙.
FROM node:22-slim
WORKDIR /app

# corepack = Node 동봉. packageManager 필드(pnpm@11.6.0)로 정확 버전.
RUN corepack enable

# 워크스페이스 전체 복사(.dockerignore가 node_modules·connectors·dist·glb 제외).
COPY . .

# 의존성 + 빌드 (web dist + node-server self-contained 번들).
RUN corepack pnpm install --frozen-lockfile \
 && corepack pnpm -F @figcad/web build \
 && corepack pnpm -F @figcad/server build:node

# Railway가 PORT 주입 — node-server가 process.env.PORT 읽음. DATA_DIR=/data(볼륨)는 env로.
CMD ["node", "apps/server/node-dist/server.mjs"]
