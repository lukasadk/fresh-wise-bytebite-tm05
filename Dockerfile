# Railway/GitHub entry point for the monorepo root.
#
# The mobile app lives at the repository root, while the deployable FastAPI
# service lives under backend/. Keeping this Dockerfile here means a Railway
# service connected to the GitHub repository can build without a manually
# configured Root Directory.
FROM python:3.12.7-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv/src:/srv

WORKDIR /srv

# Install dependencies before application code so ordinary source changes can
# reuse Railway/BuildKit's dependency layer.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ ./app/
COPY backend/src/ ./src/
COPY backend/models/ ./models/
COPY backend/data/ ./data/
COPY backend/scripts/ ./scripts/

RUN useradd --create-home --uid 10001 freshwise && chown -R freshwise /srv
USER freshwise

ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
