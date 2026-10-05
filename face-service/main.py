"""
RentifyPro — KYC Face Verification API (v3.2 — optimized for speed)
DeepFace + OpenCV + FastAPI

KYC flow:
  1) POST /api/kyc/face/detect     → Quality check + face bounding box
  2) POST /api/kyc/id/register     → Extract and store face embedding from ID card
  3) POST /api/kyc/selfie/verify   → Compare one selfie vs stored ID embedding
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import base64
import os
import re
import logging
import hmac
from datetime import datetime, timezone, timedelta

import cv2
import numpy as np
from deepface import DeepFace

import time
import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING
from dotenv import load_dotenv

load_dotenv()

# Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("rentifypro-kyc")

# Config
MONGO_URI        = os.getenv("MONGO_URI", "mongodb://localhost:27017/rentifypro")
MONGO_URI_DIRECT = os.getenv("MONGO_URI_DIRECT", "").strip()
MONGO_DB_NAME    = os.getenv("MONGO_DB_NAME", "rentifypro").strip() or "rentifypro"
MONGO_SERVER_SELECTION_TIMEOUT_MS = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "15000"))
FRONTEND_URL     = os.getenv("FRONTEND_URL", "http://localhost:5173")
NODE_BACKEND_URL = os.getenv("NODE_BACKEND_URL", "http://localhost:5000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "").strip()
FACE_SERVICE_PORT = int(os.getenv("FACE_SERVICE_PORT", "8000"))
BIOMETRIC_TEMPLATE_TTL_HOURS = max(1, int(os.getenv("BIOMETRIC_TEMPLATE_TTL_HOURS", "24")))

if not INTERNAL_API_KEY:
    logger.error("INTERNAL_API_KEY is missing. KYC endpoints will reject requests until it is configured.")

# Face model settings
MODEL_NAME       = "Facenet512"
DETECTOR_BACKEND = "opencv"        # Faster than retinaface on CPU
DISTANCE_METRIC  = "cosine"
ENFORCE_DETECTION = False

# Thresholds
MAX_ACCEPT_DISTANCE = float(os.getenv("KYC_MAX_ACCEPT_DISTANCE", "0.60"))
MAX_IMAGE_WIDTH     = 800          # Smaller images process faster
MIN_FACE_AREA_RATIO = float(os.getenv("KYC_MIN_FACE_AREA_RATIO", "0.02"))
MIN_ID_FACE_RATIO   = float(os.getenv("KYC_MIN_ID_FACE_RATIO", "0.01"))
MAX_FACE_AREA_RATIO = float(os.getenv("KYC_MAX_FACE_AREA_RATIO", "0.85"))
MIN_FACE_CONFIDENCE = float(os.getenv("KYC_MIN_FACE_CONFIDENCE", "0.40"))
ID_FACE_COUNT_MIN_AREA_RATIO = float(os.getenv("KYC_ID_COUNT_MIN_AREA_RATIO", "0.006"))
ID_FACE_COUNT_MIN_RELATIVE_RATIO = float(os.getenv("KYC_ID_COUNT_MIN_RELATIVE_RATIO", "0.25"))
SELFIE_FACE_COUNT_MIN_AREA_RATIO = float(os.getenv("KYC_SELFIE_COUNT_MIN_AREA_RATIO", "0.010"))
SELFIE_FACE_COUNT_MIN_RELATIVE_RATIO = float(os.getenv("KYC_SELFIE_COUNT_MIN_RELATIVE_RATIO", "0.35"))
BLUR_THRESHOLD      = 15
BRIGHTNESS_MIN      = 15
BRIGHTNESS_MAX      = 245
MIN_FACE_CONTRAST    = 8

def sanitize_mongo_uri(uri: str) -> str:
    text = str(uri or "")
    return re.sub(r"(mongodb(?:\+srv)?://)([^:@/]+):([^@/]+)@", r"\1***:***@", text, flags=re.IGNORECASE)


def get_candidate_mongo_uris() -> List[str]:
    uris: List[str] = []
    for value in [MONGO_URI_DIRECT, MONGO_URI]:
        uri = str(value or "").strip()
        if uri and uri not in uris:
            uris.append(uri)
    return uris


def is_mongo_auth_error(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    code_name = str(getattr(exc, "codeName", ""))
    message = str(exc or "")
    return (
        code in [18, 8000]
        or "Auth" in code_name
        or ("bad auth" in message.lower())
        or ("authentication failed" in message.lower())
    )


# MongoDB (initialized during startup)
ACTIVE_MONGO_URI = ""
mongo_client = None
mongo_db = None
kyc_col = None


async def connect_mongo_with_fallback() -> None:
    global ACTIVE_MONGO_URI, mongo_client, mongo_db, kyc_col

    uris = get_candidate_mongo_uris()
    if not uris:
        raise RuntimeError("MongoDB connection error: MONGO_URI is missing.")

    last_error = None

    for _, uri in enumerate(uris):
        label = "MONGO_URI_DIRECT" if (MONGO_URI_DIRECT and uri == MONGO_URI_DIRECT) else "MONGO_URI"
        try:
            logger.info(f"MongoDB connect attempt with {label}: {sanitize_mongo_uri(uri)}")
            client = AsyncIOMotorClient(
                uri,
                serverSelectionTimeoutMS=MONGO_SERVER_SELECTION_TIMEOUT_MS,
            )
            await client.admin.command("ping")

            ACTIVE_MONGO_URI = uri
            mongo_client = client
            mongo_db = mongo_client[MONGO_DB_NAME]
            kyc_col = mongo_db["biometric_templates"]

            logger.info("MongoDB connected successfully.")
            return
        except Exception as exc:
            last_error = exc
            logger.warning(f"MongoDB attempt failed ({label}): {exc}")
            if is_mongo_auth_error(exc):
                raise RuntimeError(
                    "MongoDB Atlas authentication failed. Verify Database Access username/password, "
                    "reset the Atlas user password if needed, and update both MONGO_URI and MONGO_URI_DIRECT."
                ) from exc

    raise RuntimeError(f"MongoDB connection error: {last_error}")

# FastAPI app
app = FastAPI(
    title="RentifyPro KYC Face Verification API",
    version="3.2.0",
    description="Face verification — optimized for speed",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5173", "http://localhost:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_internal_key(request: Request, call_next):
    """The face service is backend-only; browsers must never call it directly."""
    if request.url.path.startswith("/api/kyc/"):
        supplied = request.headers.get("x-internal-key", "")
        if not INTERNAL_API_KEY:
            return JSONResponse({"detail": "Face service is not securely configured."}, status_code=503)
        if not hmac.compare_digest(supplied, INTERNAL_API_KEY):
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    return await call_next(request)


# Load models on startup
@app.on_event("startup")
async def startup():
    await connect_mongo_with_fallback()

    # Collections are intentionally separated from Node's kyc_cases collection.
    # Never drop/rebuild indexes during service startup.
    try:
        existing = await kyc_col.index_information()
        if "user_id_1" not in existing:
            await kyc_col.create_index([("user_id", ASCENDING)], unique=True, name="user_id_1")
        if "expires_at_1" not in existing:
            await kyc_col.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, name="expires_at_1")
        logger.info("Biometric template indexes ensured.")
    except Exception as e:
        logger.warning(f"Index fix note: {e}")

    # Warm up the model so the first request is faster
    logger.info("Pre-loading Facenet512 model (this takes ~30s on first run)...")
    try:
        dummy = np.zeros((160, 160, 3), dtype=np.uint8)
        dummy[40:120, 40:120] = 128  # Fake face area for warmup
        DeepFace.represent(
            img_path=dummy,
            model_name=MODEL_NAME,
            detector_backend="skip",   # Just load the model
            enforce_detection=False,
        )
        logger.info("✅ Facenet512 model loaded and ready!")
    except Exception as e:
        logger.warning(f"Model pre-load note (this is OK): {e}")
        logger.info("✅ Model will load on first request instead.")


# Request and response models

class FaceDetectRequest(BaseModel):
    image_base64: str

class FaceDetectResponse(BaseModel):
    ok: bool
    message: str
    face_count: int
    bounding_box: Optional[Dict[str, int]] = None
    quality: Optional[Dict[str, Any]] = None

class KycIdRegisterRequest(BaseModel):
    user_id: str = Field(..., description="User's email or ID")
    role: str = Field(..., description="user or owner")
    full_name: str
    id_image_base64: str = Field(..., description="Base64 image of the full ID card front")

class KycIdRegisterResponse(BaseModel):
    success: bool
    message: str
    user_id: Optional[str] = None
    stored_at: Optional[str] = None

class KycSelfieVerifyRequest(BaseModel):
    user_id: str
    selfie_image_base64: str

class KycSelfieVerifyResponse(BaseModel):
    verified: bool
    message: str
    user_id: str
    role: Optional[str] = None
    full_name: Optional[str] = None
    distance: float = 1.0
    confidence: float = 0.0


# Image helpers

def decode_base64_image(b64: str) -> np.ndarray:
    if "base64," in b64:
        b64 = b64.split("base64,")[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise ValueError("We couldn't read your image. Please try uploading again.")
    arr = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("The image format isn't supported. Please upload a JPEG or PNG file.")
    return img


def resize_if_needed(image: np.ndarray, max_width: int = MAX_IMAGE_WIDTH) -> np.ndarray:
    h, w = image.shape[:2]
    if w <= max_width:
        return image
    scale = max_width / float(w)
    return cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def normalize_image(image: np.ndarray) -> np.ndarray:
    """CLAHE normalization for brightness/contrast equalization."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    lab = cv2.merge([l, a, b])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def blur_score(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def brightness_score(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(np.mean(gray))


def check_image_quality(image: np.ndarray, bbox: Optional[Dict[str, int]] = None) -> Optional[str]:
    sample = image
    if bbox:
        x, y = bbox["x"], bbox["y"]
        sample = image[y:y + bbox["h"], x:x + bbox["w"]]
        if sample.size == 0:
            return "We couldn't find a clear face. Please try again."
    b = blur_score(sample)
    br = brightness_score(sample)
    if b < BLUR_THRESHOLD:
        return "Your image is a bit blurry. Please hold your device steady and try again."
    if bbox:
        gray = cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY)
        if float(np.std(gray)) < MIN_FACE_CONTRAST:
            return "We couldn't see enough facial detail. Please use more even lighting and try again."
        return None
    if br < BRIGHTNESS_MIN:
        return "The image is too dark. Please move to a brighter area."
    if br > BRIGHTNESS_MAX:
        return "The image is too bright. Please avoid direct light or flash."
    return None


# Face detection and embeddings

def extract_best_face(image: np.ndarray) -> Dict[str, Any]:
    """Detect faces using opencv (fast). Only fall back to ssd if opencv finds nothing."""
    faces = []
    image_area = max(1, image.shape[0] * image.shape[1])
    for backend in ("opencv", "ssd"):
        try:
            detected = DeepFace.extract_faces(
                img_path=image,
                detector_backend=backend,
                enforce_detection=True,
                align=True,
            )
            faces = [face for face in detected if not (
                float(face.get("confidence", 0.0)) <= 0
                and int(face.get("facial_area", {}).get("w", 0))
                * int(face.get("facial_area", {}).get("h", 0)) >= image_area * 0.95
            )]
            if faces:
                break
        except Exception as e:
            logger.info(f"{backend} found no usable face: {e}")

    if not faces:
        raise ValueError("We couldn't find a face in your image. Please make sure your face is clearly visible and well-lit.")

    def area(f):
        fa = f.get("facial_area", {})
        return int(fa.get("w", 0)) * int(fa.get("h", 0))

    best = sorted(faces, key=area, reverse=True)[0]
    fa = best.get("facial_area", {})
    face_boxes = []
    for detected in faces:
        box = detected.get("facial_area", {})
        w = max(0, int(box.get("w", 0)))
        h = max(0, int(box.get("h", 0)))
        if w <= 0 or h <= 0:
            continue
        face_boxes.append(
            {
                "x": int(box.get("x", 0)),
                "y": int(box.get("y", 0)),
                "w": w,
                "h": h,
                "confidence": float(detected.get("confidence", 0.0)),
            }
        )
    if not face_boxes:
        raise ValueError("We couldn't find a valid face region in your image. Please try again.")

    return {
        "face": best.get("face"),
        "bbox": {
            "x": int(fa.get("x", 0)),
            "y": int(fa.get("y", 0)),
            "w": int(fa.get("w", 0)),
            "h": int(fa.get("h", 0)),
        },
        "confidence": float(best.get("confidence", 0.0)),
        "face_count": len(face_boxes),
        "faces": face_boxes,
    }


def face_area_ratio(bbox: Dict[str, int], image: np.ndarray) -> float:
    h, w = image.shape[:2]
    face_pixels = bbox["w"] * bbox["h"]
    total_pixels = w * h
    return float(face_pixels / total_pixels) if total_pixels > 0 else 0.0


def count_faces_opencv(image: np.ndarray) -> Optional[int]:
    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]
        min_size = max(24, int(min(h, w) * 0.05))
        counts = []
        for cascade_name in ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"):
            cascade_path = os.path.join(cv2.data.haarcascades, cascade_name)
            cascade = cv2.CascadeClassifier(cascade_path)
            if cascade.empty():
                continue
            faces = cascade.detectMultiScale(
                gray,
                scaleFactor=1.05,
                minNeighbors=4,
                minSize=(min_size, min_size),
            )
            counts.append(int(len(faces)))
        if not counts:
            return None
        return max(counts)
    except Exception:
        return None


def validate_face_constraints(
    best: Dict[str, Any],
    image: np.ndarray,
    *,
    min_ratio: float,
    max_ratio: float,
    min_confidence: Optional[float],
    multi_face_message: str,
    small_face_message: str,
    large_face_message: str,
    low_conf_message: str,
    max_faces_allowed: Optional[int] = 1,
    use_secondary_count: bool = True,
    count_min_area_ratio: Optional[float] = None,
    count_min_relative_to_largest: Optional[float] = None,
) -> Optional[str]:
    primary_count = int(best.get("face_count", 0))
    face_count = primary_count
    candidate_faces = best.get("faces") or []
    if candidate_faces and (
        count_min_area_ratio is not None or count_min_relative_to_largest is not None
    ):
        img_h, img_w = image.shape[:2]
        image_area = max(1, img_h * img_w)
        areas = [
            max(0, int(face.get("w", 0)) * int(face.get("h", 0)))
            for face in candidate_faces
        ]
        largest_area = max(areas) if areas else 0
        filtered_count = 0
        largest_index = 0
        if areas:
            largest_index = int(np.argmax(np.array(areas)))
        for idx, area_value in enumerate(areas):
            if area_value <= 0:
                continue
            # Always count the largest detected face as the primary face candidate.
            if idx == largest_index:
                filtered_count += 1
                continue
            if (
                count_min_area_ratio is not None
                and (area_value / float(image_area)) < count_min_area_ratio
            ):
                continue
            if (
                count_min_relative_to_largest is not None
                and largest_area > 0
                and (area_value / float(largest_area)) < count_min_relative_to_largest
            ):
                continue
            filtered_count += 1
        if filtered_count != primary_count:
            logger.info(
                f"Filtered face count from {primary_count} to {filtered_count} "
                "based on face-size thresholds."
            )
        face_count = filtered_count
    if use_secondary_count:
        alt_count = count_faces_opencv(image)
        if alt_count is not None:
            # Use secondary detector as a recovery signal for missed faces,
            # not to aggressively override a valid primary single-face result.
            if face_count < 1 and alt_count > 0:
                face_count = alt_count
                logger.info(
                    f"Using secondary face count {alt_count} because primary detector found no valid face."
                )
            elif alt_count > primary_count:
                logger.info(
                    f"Ignoring secondary multi-face count {alt_count} (primary={primary_count}) "
                    "to reduce false positives."
                )
    if face_count < 1 or (
        max_faces_allowed is not None and face_count > max_faces_allowed
    ):
        return multi_face_message
    if min_confidence is not None and best.get("confidence", 0.0) < min_confidence:
        return low_conf_message
    ratio = face_area_ratio(best["bbox"], image)
    if ratio < min_ratio:
        return small_face_message
    if ratio > max_ratio:
        return large_face_message
    return None


def select_selfie_frame(
    image: np.ndarray,
    *,
    multi_face_message: str,
    small_face_message: str,
    large_face_message: str,
    low_conf_message: str,
    use_secondary_count: bool = True,
    count_min_area_ratio: Optional[float] = None,
    count_min_relative_to_largest: Optional[float] = None,
) -> tuple:
    first_issue = None
    for attempt in range(2):
        candidate = image if attempt == 0 else normalize_image(image)
        try:
            best = extract_best_face(candidate)
        except ValueError:
            continue

        constraint_err = validate_face_constraints(
            best,
            candidate,
            min_ratio=MIN_FACE_AREA_RATIO,
            max_ratio=MAX_FACE_AREA_RATIO,
            min_confidence=MIN_FACE_CONFIDENCE,
            multi_face_message=multi_face_message,
            small_face_message=small_face_message,
            large_face_message=large_face_message,
            low_conf_message=low_conf_message,
            use_secondary_count=use_secondary_count,
            count_min_area_ratio=count_min_area_ratio,
            count_min_relative_to_largest=count_min_relative_to_largest,
        )
        if constraint_err:
            if constraint_err in (multi_face_message, small_face_message, large_face_message):
                return candidate, best, constraint_err
            if first_issue is None:
                first_issue = (candidate, best, constraint_err)
            continue

        quality_err = check_image_quality(candidate, best["bbox"])
        if quality_err:
            if first_issue is None:
                first_issue = (candidate, best, quality_err)
            continue
        return candidate, best, None

    if first_issue is not None:
        return first_issue
    brightness = brightness_score(image)
    if brightness < BRIGHTNESS_MIN:
        return image, None, "We couldn't find your face in this dark image. Please add some light and try again."
    if brightness > BRIGHTNESS_MAX:
        return image, None, "We couldn't find your face because of glare. Please avoid direct light and try again."
    return image, None, "We couldn't find your face. Keep your full face visible and try again."


def get_embedding_fast(image: np.ndarray) -> np.ndarray:
    """
    Get face embedding using opencv detector (fast).
    Falls back to ssd only if opencv fails.
    """
    for backend in ["opencv", "ssd"]:
        try:
            reps = DeepFace.represent(
                img_path=image,
                model_name=MODEL_NAME,
                detector_backend=backend,
                enforce_detection=True,
            )
            if reps:
                return np.array(reps[0]["embedding"], dtype=np.float32)
        except Exception as e:
            logger.warning(f"Embedding with {backend} failed: {e}")
            continue

    raise ValueError("We couldn't process the face in your image. Please try a clearer photo.")


def get_embedding_with_normalization(image: np.ndarray) -> tuple:
    """
    Try original image first (fast path).
    If that works, also try normalized image and return the one
    that produces a valid embedding.
    Returns (original_emb, normalized_emb) — normalized may be None.
    """
    original_emb = None
    normalized_emb = None

    # Try the original image first
    try:
        original_emb = get_embedding_fast(image)
    except Exception:
        pass

    # Try a normalized image too
    try:
        norm_img = normalize_image(image)
        normalized_emb = get_embedding_fast(norm_img)
    except Exception:
        pass

    if original_emb is None and normalized_emb is None:
        raise ValueError("We couldn't process the face in your image. Please try a clearer photo.")

    return original_emb, normalized_emb


def cosine_distance(e1: np.ndarray, e2: np.ndarray) -> float:
    denom = np.linalg.norm(e1) * np.linalg.norm(e2)
    if denom == 0:
        return 1.0
    sim = float(np.dot(e1, e2) / denom)
    dist = 1.0 - max(-1.0, min(1.0, sim))
    return float(max(0.0, min(2.0, dist)))


def distance_to_confidence(dist: float) -> float:
    if dist <= 0:
        return 100.0
    if dist >= MAX_ACCEPT_DISTANCE:
        return max(0.0, (1.0 - dist) * 100.0)
    return float(max(0.0, min(100.0, (1.0 - dist / MAX_ACCEPT_DISTANCE) * 100.0 * 0.5 + 50.0)))


# Notify the Node.js backend

async def notify_node_backend(user_id: str, verified: bool, confidence: float):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.patch(
                f"{NODE_BACKEND_URL}/api/kyc/internal/update-status",
                json={
                    "user_id": user_id,
                    "status": "approved" if verified else "rejected",
                    "confidence": confidence,
                },
                headers={"x-internal-key": INTERNAL_API_KEY},
            )
        logger.info(f"Node backend notified: user={user_id} verified={verified}")
    except Exception as e:
        logger.warning(f"Could not notify Node backend: {e}")


# Endpoint 1: face quality check

@app.post("/api/kyc/face/detect", response_model=FaceDetectResponse)
async def post_face_detect(req: FaceDetectRequest):
    try:
        img = resize_if_needed(decode_base64_image(req.image_base64))
        b = blur_score(img)
        br = brightness_score(img)
        selected_img, best, error = select_selfie_frame(
            img,
            multi_face_message="Multiple faces detected. Please make sure only your face is visible.",
            small_face_message="Your face is too small. Please move closer to the camera.",
            large_face_message="Your face is too close. Please move slightly farther away.",
            low_conf_message="We're having trouble detecting your face. Please improve the lighting.",
        )
        quality = {"blur": round(b, 2), "brightness": round(br, 2)}
        if best:
            quality["face_area_ratio"] = round(face_area_ratio(best["bbox"], selected_img), 4)
        return FaceDetectResponse(
            ok=error is None,
            message=error or "Face detected. Looking good!",
            face_count=best["face_count"] if best else 0,
            bounding_box=best["bbox"] if best else None,
            quality=quality,
        )
    except ValueError as e:
        return FaceDetectResponse(ok=False, message=str(e), face_count=0)
    except Exception as e:
        logger.error(f"Face detect error: {e}")
        return FaceDetectResponse(ok=False, message="Something went wrong. Please try again.", face_count=0)


# Endpoint 2: register ID face

@app.post("/api/kyc/id/register", response_model=KycIdRegisterResponse)
async def post_kyc_id_register(req: KycIdRegisterRequest):
    t_start = time.time()
    try:
        img = resize_if_needed(decode_base64_image(req.id_image_base64))

        best = extract_best_face(img)

        # For ID uploads we only require that a face exists on the ID image.
        # Do not reject for multi-face detections, quality, size, or confidence.
        if int(best.get("face_count", 0)) < 1:
            return KycIdRegisterResponse(
                success=False,
                message="We couldn't find a face on your ID. Please retake the photo clearly.",
            )

        # Get embeddings from both versions
        orig_emb, norm_emb = get_embedding_with_normalization(img)
        # Prefer the normalized embedding if it exists
        emb = norm_emb if norm_emb is not None else orig_emb
        now = datetime.now(timezone.utc)

        await kyc_col.update_one(
            {"user_id": req.user_id},
            {"$set": {
                "user_id": req.user_id,
                "role": req.role,
                "full_name": req.full_name,
                "id_embedding": emb.tolist(),
                "model": MODEL_NAME,
                "detector": DETECTOR_BACKEND,
                "id_registered_at": now,
                "expires_at": now + timedelta(hours=BIOMETRIC_TEMPLATE_TTL_HOURS),
                "id_faces_detected": best["face_count"],
            }},
            upsert=True,
        )

        elapsed = time.time() - t_start
        logger.info(f"ID registered: user_id={req.user_id} (faces: {best['face_count']}) in {elapsed:.1f}s")
        return KycIdRegisterResponse(
            success=True,
            message="Your ID image was uploaded successfully. You can now take your selfie while document review continues.",
            user_id=req.user_id,
            stored_at=now.isoformat(),
        )

    except ValueError as e:
        return KycIdRegisterResponse(success=False, message=str(e))
    except Exception as e:
        logger.error(f"ID registration error for {req.user_id}: {e}")
        return KycIdRegisterResponse(success=False, message="Something went wrong while registering your ID. Please try again.")


# Endpoint 3: selfie vs ID check
# Try the original image first, then a normalized one if needed.

@app.post("/api/kyc/selfie/verify", response_model=KycSelfieVerifyResponse)
async def post_kyc_selfie_verify(req: KycSelfieVerifyRequest):
    t_start = time.time()
    try:
        record = await kyc_col.find_one({"user_id": req.user_id})
        if not record or "id_embedding" not in record:
            return KycSelfieVerifyResponse(verified=False, message="Please upload your ID first before verifying.", user_id=req.user_id)

        img = resize_if_needed(decode_base64_image(req.selfie_image_base64))

        base_resp = {
            "user_id": req.user_id,
            "role": record.get("role"),
            "full_name": record.get("full_name"),
            "distance": 1.0,
            "confidence": 0.0,
        }

        selected_img, _, frame_error = select_selfie_frame(
            img,
            multi_face_message="Multiple people detected. Please make sure only you are in the frame.",
            small_face_message="Your face is too small. Please move closer to the camera.",
            large_face_message="Your face is too close. Please move slightly farther away.",
            low_conf_message="We're having trouble detecting your face. Please improve the lighting.",
            use_secondary_count=False,
            count_min_area_ratio=SELFIE_FACE_COUNT_MIN_AREA_RATIO,
            count_min_relative_to_largest=SELFIE_FACE_COUNT_MIN_RELATIVE_RATIO,
        )
        if frame_error:
            return KycSelfieVerifyResponse(verified=False, message=frame_error, **base_resp)

        id_emb = np.array(record["id_embedding"], dtype=np.float32)

        # Try the original image first
        best_dist = 999.0
        t1 = time.time()

        try:
            emb = get_embedding_fast(selected_img)
            d = cosine_distance(id_emb, emb)
            logger.info(f"  First face match: distance={d:.4f} ({time.time()-t1:.1f}s)")
            best_dist = d
        except Exception as e:
            logger.warning(f"  Fast path failed: {e}")

        # If needed, try the normalized image next
        if best_dist > MAX_ACCEPT_DISTANCE and selected_img is img:
            t2 = time.time()
            try:
                alternate_img = normalize_image(img)
                emb = get_embedding_fast(alternate_img)
                d = cosine_distance(id_emb, emb)
                logger.info(f"  Alternate face match: distance={d:.4f} ({time.time()-t2:.1f}s)")
                if d < best_dist:
                    best_dist = d
            except Exception as e:
                logger.warning(f"  Normalized path failed: {e}")

        if best_dist >= 999.0:
            return KycSelfieVerifyResponse(verified=False, message="We couldn't process your selfie. Please try again.", **base_resp)

        dist = best_dist
        conf = distance_to_confidence(dist)
        verified = dist <= MAX_ACCEPT_DISTANCE
        now = datetime.now(timezone.utc)

        if verified:
            msg = "Your face matches your ID. Verification successful!"
        else:
            msg = (
                "Your selfie doesn't seem to match your ID photo. "
                "Please try again — make sure you have good lighting, "
                "face the camera directly, and remove glasses or hats if possible."
            )

        elapsed = time.time() - t_start
        logger.info(
            f"Verify: user={req.user_id} verified={verified} "
            f"distance={dist:.4f} threshold={MAX_ACCEPT_DISTANCE} "
            f"confidence={conf:.1f}% time={elapsed:.1f}s"
        )

        await kyc_col.update_one(
            {"user_id": req.user_id},
            {"$set": {
                "face_match_score": round(conf, 2),
                "cosine_distance": round(dist, 4),
                "verified_at": now,
                "remarks": msg,
                "expires_at": now + timedelta(hours=BIOMETRIC_TEMPLATE_TTL_HOURS),
            }},
        )

        # Pre-registration attempts are finalized by the originating Node request,
        # which owns the signed session id. Only durable user ids use the callback.
        if not req.user_id.startswith("pre:"):
            await notify_node_backend(req.user_id, verified, conf)
        if verified:
            # The Node KYC case is the durable status source. Retain no biometric template after approval.
            await kyc_col.delete_one({"user_id": req.user_id})

        return KycSelfieVerifyResponse(
            verified=verified,
            message=msg,
            user_id=req.user_id,
            role=record.get("role"),
            full_name=record.get("full_name"),
            distance=round(dist, 4),
            confidence=round(conf, 2),
        )

    except ValueError as e:
        return KycSelfieVerifyResponse(verified=False, message=str(e), user_id=req.user_id)
    except Exception as e:
        logger.error(f"Selfie verify error for {req.user_id}: {e}")
        return KycSelfieVerifyResponse(verified=False, message="Something went wrong. Please try again.", user_id=req.user_id)


# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/")
async def root():
    count = await kyc_col.count_documents({})
    return {
        "status": "ok",
        "service": "RentifyPro KYC Face Verification API",
        "version": "3.2.0",
        "model": MODEL_NAME,
        "detector": DETECTOR_BACKEND,
        "match_threshold": MAX_ACCEPT_DISTANCE,
        "registered_users": count,
        "docs": f"http://localhost:{FACE_SERVICE_PORT}/docs",
        "id_policy": "at_least_one_face_required",
    }


# Run

if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 50)
    print("  RentifyPro KYC API v3.2 (speed optimized)")
    print("=" * 50)
    print(f"  Model:     {MODEL_NAME}")
    print(f"  Detector:  {DETECTOR_BACKEND} (fast)")
    print(f"  Threshold: {MAX_ACCEPT_DISTANCE}")
    print(f"  Max width: {MAX_IMAGE_WIDTH}px")
    print(f"  MongoDB:   {sanitize_mongo_uri(ACTIVE_MONGO_URI or MONGO_URI)}")
    print(f"  Docs:      http://localhost:{FACE_SERVICE_PORT}/docs")
    print("=" * 50 + "\n")
    uvicorn.run("main:app", host="0.0.0.0", port=FACE_SERVICE_PORT, reload=True)
