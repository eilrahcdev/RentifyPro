"""Private CPU text extraction. Document decisions remain in the Node backend."""
import asyncio
import base64
import binascii
from contextlib import asynccontextmanager
import hmac
import io
import json
import os
from pathlib import Path
import tempfile
import time

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("MODELSCOPE_OFFLINE", "1")
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", "20000000")
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(Path(tempfile.gettempdir()) / "rentifypro-ocr-cache"))
os.environ.setdefault("PADDLE_HOME", str(Path(tempfile.gettempdir()) / "rentifypro-paddle-cache"))

import cv2
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import numpy as np
from PIL import Image
import pypdfium2 as pdfium

MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_REQUEST_BYTES = 6 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_PAGES = 5
MAX_LINES = 1200
MAX_IMAGE_EDGE = 1400
MODEL_ROOT = Path(os.getenv("KYC_OCR_MODEL_ROOT", str(Path(__file__).parent / "models")))
ENGINE = None
ACTIVE = asyncio.Lock()
cv2.setNumThreads(2)


def create_engine():
    from paddleocr import PaddleOCR
    directories = [MODEL_ROOT / "PP-OCRv5_mobile_det", MODEL_ROOT / "en_PP-OCRv5_mobile_rec"]
    if any(not (directory / "inference.json").is_file() for directory in directories):
        raise RuntimeError("Local OCR models are missing. Run download_models.py before starting the service.")
    engine = PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=str(directories[0]),
        text_recognition_model_name="en_PP-OCRv5_mobile_rec",
        text_recognition_model_dir=str(directories[1]),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
        cpu_threads=2,
        enable_mkldnn=False,
        text_recognition_batch_size=1,
    )
    list(engine.predict(np.full((100, 300, 3), 255, dtype=np.uint8)))
    return engine


@asynccontextmanager
async def lifespan(_app):
    global ENGINE
    if len(os.getenv("INTERNAL_API_KEY", "")) < 32:
        raise RuntimeError("INTERNAL_API_KEY must contain at least 32 characters.")
    ENGINE = await asyncio.to_thread(create_engine)
    yield
    ENGINE = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def image_frames(data, mime_type):
    if mime_type in {"image/jpeg", "image/png"}:
        expected = "JPEG" if mime_type == "image/jpeg" else "PNG"
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format != expected or image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Unsupported image")
                image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
                yield cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
        except (ValueError, OSError, Image.DecompressionBombError):
            raise HTTPException(422, "The image cannot be processed within the private checker limits.") from None
        return
    if mime_type != "application/pdf" or not data.startswith(b"%PDF-"):
        raise HTTPException(422, "Only JPEG, PNG, and PDF documents are supported.")
    try:
        with pdfium.PdfDocument(data) as document:
            if not 1 <= len(document) <= MAX_PAGES:
                raise HTTPException(422, "The PDF exceeds the private checker page limit. An administrator can review the original.")
            for index in range(len(document)):
                page = document[index]
                try:
                    width, height = page.get_size()
                    if width <= 0 or height <= 0:
                        raise HTTPException(422, "Invalid PDF page size.")
                    scale = min(2, MAX_IMAGE_EDGE / max(width, height))
                    bitmap = page.render(scale=scale)
                    try:
                        image = bitmap.to_pil()
                        try:
                            frame = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
                        finally:
                            image.close()
                    finally:
                        bitmap.close()
                finally:
                    page.close()
                yield frame
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "The PDF could not be read. An administrator can review the original.") from None


def extract_lines(data, mime_type):
    lines = []
    pages = 0
    started = time.monotonic()
    for pages, image in enumerate(image_frames(data, mime_type), 1):
        if time.monotonic() - started > 25:
            raise HTTPException(422, "This document needs manual review because extraction exceeded its processing limit.")
        height, width = image.shape[:2]
        for result in ENGINE.predict(image):
            texts, scores = result.get("rec_texts", []), result.get("rec_scores", [])
            boxes = result.get("rec_boxes", [])
            if len(texts) != len(scores) or len(boxes) != len(texts):
                raise HTTPException(503, "OCR output was unavailable.")
            for text, score, box in zip(texts, scores, boxes):
                text, score = str(text).strip(), float(score)
                bounds = np.asarray(box, dtype=float)
                if bounds.shape != (4,) or not np.all(np.isfinite(bounds)) \
                        or not (0 <= bounds[0] < bounds[2] <= width and 0 <= bounds[1] < bounds[3] <= height):
                    raise HTTPException(503, "OCR positions were unavailable.")
                if len(text) > 400 or not np.isfinite(score) or not 0 <= score <= 1:
                    raise HTTPException(422, "This document needs manual review because OCR output exceeded its limits.")
                if text:
                    lines.append({"text": text, "confidence": score, "page": pages,
                                  "bbox": [round(float(bounds[0] / width), 6), round(float(bounds[1] / height), 6),
                                           round(float(bounds[2] / width), 6), round(float(bounds[3] / height), 6)]})
                if len(lines) > MAX_LINES:
                    raise HTTPException(422, "This document needs manual review because it contains too much text.")
    return {"schema_version": 1, "provider": "paddleocr", "pages": pages, "lines": lines,
            "layout_version": 2}


@app.get("/health")
async def health():
    return JSONResponse({"ready": ENGINE is not None, "schema_version": 1,
                         "provider": "paddleocr", "layout_version": 2},
                        status_code=200 if ENGINE is not None else 503,
                        headers={"Cache-Control": "no-store"})


@app.post("/inspect")
async def inspect(request: Request):
    secret = os.getenv("INTERNAL_API_KEY", "")
    supplied = request.headers.get("x-internal-key", "")
    if len(secret) < 32 or not hmac.compare_digest(supplied.encode("utf-8"), secret.encode("utf-8")):
        raise HTTPException(401, "Service authentication required.")
    if ENGINE is None:
        raise HTTPException(503, "The private checker is starting.")
    if ACTIVE.locked():
        raise HTTPException(429, "The private checker is busy. Retry through the document queue.")
    async with ACTIVE:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_REQUEST_BYTES:
                raise HTTPException(413, "Document request is too large.")
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict) or set(payload) != {"schema_version", "base64", "mime_type"} \
                    or type(payload["schema_version"]) is not int or payload["schema_version"] != 1:
                raise ValueError("Invalid schema")
            if not isinstance(payload["base64"], str) or not isinstance(payload["mime_type"], str):
                raise ValueError("Invalid encoding")
            data = base64.b64decode(payload["base64"], validate=True)
            if not data or len(data) > MAX_FILE_BYTES:
                raise ValueError("Invalid size")
        except (ValueError, KeyError, TypeError, binascii.Error):
            raise HTTPException(422, "Invalid document request.") from None
        try:
            result = await asyncio.to_thread(extract_lines, data, payload["mime_type"])
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Private OCR could not complete this document.") from None
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
