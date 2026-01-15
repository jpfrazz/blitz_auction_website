FROM rust:1.92 AS chef
WORKDIR /app
RUN cargo install cargo-chef sccache --locked

FROM chef AS planner

COPY Cargo.toml Cargo.lock .
COPY src ./src

RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder

COPY --from=planner /app/recipe.json recipe.json

ENV RUSTC_WRAPPER=sccache \
    SCCACHE_DIR=/sccache \
    SQLX_OFFLINE=true

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=$SCCACHE_DIR,sharing=locked \
    cargo chef cook --release --recipe-path recipe.json

COPY Cargo.toml Cargo.lock .
COPY src ./src
COPY .sqlx ./.sqlx

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=$SCCACHE_DIR,sharing=locked \
    cargo build --release --bin blitz-auction-backend

FROM debian:13-slim AS runner
WORKDIR /app
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/blitz-auction-backend /app/blitz-auction-backend

ENTRYPOINT ["./blitz-auction-backend"]

