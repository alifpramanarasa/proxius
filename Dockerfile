# ── Build Admin CMS (SPA) ───────────────────────────────────────────
FROM node:22-slim AS admin
WORKDIR /ui
RUN npm install -g pnpm@10
COPY pnpm-workspace.yaml package.json ./
COPY ui/admin ui/admin
RUN pnpm install --filter @proxius/admin... \
    && pnpm --filter @proxius/admin build

# ── Build server (Rust) ─────────────────────────────────────────────
FROM rust:1-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY apps apps
RUN cargo build --release -p proxius-server

# ── Runtime ─────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /build/target/release/proxius-server /usr/local/bin/proxius-server
COPY --from=admin /ui/ui/admin/dist /app/admin
ENV BIND=0.0.0.0:8080
EXPOSE 8080
CMD ["proxius-server"]
