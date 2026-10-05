# FreshWise API. Works on Railway/Render (they inject PORT) and in Synology
# Container Manager alike.
FROM python:3.12.7-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv/src:/srv

WORKDIR /srv

# Requirements first so a code change doesn't re-run the dependency install.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
# Keep the public APK copy explicit: a missing release file now fails the
# Railway image build instead of producing a healthy API with a dead link.
COPY app/static/downloads/FreshWise-v1.4.5-early-estimate-20261005.apk ./app/static/downloads/FreshWise-v1.4.5-early-estimate-20261005.apk
COPY src/ ./src/
COPY models/ ./models/
COPY data/ ./data/
COPY scripts/ ./scripts/

# Non-root: if the API is ever compromised, it shouldn't own the container.
RUN useradd --create-home --uid 10001 freshwise && chown -R freshwise /srv
USER freshwise

# Port is configurable: Railway and Render inject their own PORT and expect you
# to honour it; on a NAS you set it in .env.
ENV PORT=8000
EXPOSE 8000

# sh -c so ${PORT} expands at runtime, `exec` so uvicorn becomes PID 1 and
# still receives SIGTERM -- without exec the shell swallows it and container
# stops take the full kill timeout.
# No --reload in production; it watches the filesystem and costs memory.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
