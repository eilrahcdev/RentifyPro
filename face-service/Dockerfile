FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FACE_SERVICE_PORT=8010 \
    DEEPFACE_HOME=/home/app

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip check

RUN useradd --create-home --user-group --uid 10001 app

COPY --chown=app:app main.py ./

USER app

RUN python -c "import cv2; from deepface import DeepFace"

EXPOSE 8010

CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port \"${FACE_SERVICE_PORT:-8010}\""]
