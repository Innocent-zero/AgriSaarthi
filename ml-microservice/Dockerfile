FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    ML_SERVICE_PORT=8000 \
    SVM_MODEL_PATH=app/models/artifacts/leaf_svm.joblib

WORKDIR /srv

# OpenCV headless still needs libGL-free glib bindings for image codecs.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

# Bake the trained SVM into the image so cold starts never pay training cost.
RUN python -m app.models.train_svm_mock --samples 260 --quiet

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:${ML_SERVICE_PORT}/health || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${ML_SERVICE_PORT} --workers 2"]