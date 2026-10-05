FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHATBOT_SERVICE_PORT=8001 \
    HF_HUB_DISABLE_PROGRESS_BARS=1 \
    TRANSFORMERS_NO_ADVISORY_WARNINGS=1 \
    HF_HOME=/home/app/.cache/huggingface

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip check

RUN useradd --create-home --user-group --uid 10001 app

COPY --chown=app:app app.py ./
COPY --chown=app:app chatbot_routing.py ./
COPY --chown=app:app chatbot_config.json ./
COPY --chown=app:app rentifypro_chatbot_dataset_v6.json ./

USER app

RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

EXPOSE 8001

CMD ["sh", "-c", "exec python -m uvicorn app:app --host 0.0.0.0 --port \"${CHATBOT_SERVICE_PORT:-8001}\""]