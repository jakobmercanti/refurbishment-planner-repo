FROM ghcr.io/astral-sh/uv:0.10.9 AS uv
FROM python:3.12-slim
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 \
    RENOVATION_FIT_PUBLIC=true ENABLE_PROGRAMMER_TOOLS=false \
    ALLOWED_ORIGINS=https://www.freefloorplan3d.com \
    POSTHOG_PROJECT_TOKEN=phc_m6QdNetEwxnbfresRz6V84gvjiJLWRyEKD2LRbPWcWmM
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend ./backend
COPY geometry ./geometry
COPY cad ./cad
COPY database ./database
COPY fixtures ./fixtures
COPY data/ui_theme_defaults.json data/software_settings.json ./data/
COPY frontend/lib/*.json ./frontend/lib/
COPY frontend/public ./frontend/public
CMD ["sh", "-c", "exec .venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-proxy-headers"]
