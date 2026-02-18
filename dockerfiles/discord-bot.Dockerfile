FROM python:3.13-slim-trixie

COPY --from=ghcr.io/astral-sh/uv:0.10.2 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock auction_role_sync_bot.py ./

RUN uv sync --locked --no-dev

CMD ["uv", "run", "auction_role_sync_bot.py"]
