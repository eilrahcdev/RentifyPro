FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True HF_HUB_OFFLINE=1 MODELSCOPE_OFFLINE=1 OMP_NUM_THREADS=2
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt && python -m pip check
COPY download_models.py ./
RUN python download_models.py
RUN useradd --create-home --user-group --uid 10001 app && chown -R app:app /app
COPY --chown=app:app main.py ./
USER app
EXPOSE 8020
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020", "--workers", "1", "--limit-concurrency", "8", "--no-access-log"]
