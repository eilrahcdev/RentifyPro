"""
RentifyPro — KYC Face Verification API (v3.2 — optimized for speed)
DeepFace + OpenCV + FastAPI

KYC flow:
  1) POST /api/kyc/face/detect     → Quality check + face bounding box
  2) POST /api/kyc/id/register     → Extract and store face embedding from ID card
  3) POST /api/kyc/selfie/challenge → Single selfie liveness check
  4) POST /api/kyc/selfie/verify   → Compare selfie vs stored ID embedding
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import base64
import os
import logging
from datetime import datetime, timezone, timedelta

import cv2
import numpy as np
from deepface import DeepFace

import time
import uuid
import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError
from dotenv import load_dotenv

load_dotenv()

# Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("rentifypro-kyc")

# Config
MONGO_URI        = os.getenv("MONGO_URI", "mongodb://localhost:27017/rentifypro")
FRONTEND_URL     = os.getenv("FRONTEND_URL", "http://localhost:5173")
NODE_BACKEND_URL = os.getenv("NODE_BACKEND_URL", "http://localhost:5000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "rentifypro-internal-secret")
FACE_SERVICE_PORT = int(os.getenv("FACE_SERVICE_PORT", "8000"))

if INTERNAL_API_KEY == "rentifypro-internal-secret":
    logger.warning("INTERNAL_API_KEY is using the default value. Set a strong secret in your environment.")

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
BLUR_THRESHOLD      = 15
BRIGHTNESS_MIN      = 15
BRIGHTNESS_MAX      = 245
CHALLENGE_TTL_SECS  = 300
MIN_CHALLENGE_FRAMES = int(os.getenv("KYC_MIN_FRAMES", "3"))
MAX_CHALLENGE_FRAMES = max(MIN_CHALLENGE_FRAMES, int(os.getenv("KYC_MAX_FRAMES", "5")))
MIN_FRAME_DIFF      = float(os.getenv("KYC_MIN_FRAME_DIFF", "2.0"))
MIN_FACE_MOVEMENT   = float(os.getenv("KYC_MIN_FACE_MOVEMENT", "0.015"))

# MongoDB
mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client["rentifypro"]
kyc_col        = mongo_db["kycverifications"]
users_col      = mongo_db["users"]
challenges_col = mongo_db["kycchallenges"]

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


# Load models on startup
@app.on_event("startup")
async def startup():
    # Make sure indexes exist
    try:
        existing = await kyc_col.index_information()
        if "user_1" in existing:
            await kyc_col.drop_index("user_1")
            logger.info("Dropped broken 'user_1' index")
        if "user_id_1" not in existing:
            await kyc_col.create_index([("user_id", ASCENDING)], unique=True, name="user_id_1")
            logger.info("Created 'user_id_1' unique index")
    except Exception as e:
        logger.warning(f"Index fix note: {e}")

    try:
        existing_challenge = await challenges_col.index_information()
        if "challenge_id_1" not in existing_challenge:
            await challenges_col.create_index([("challenge_id", ASCENDING)], unique=True, name="challenge_id_1")
            logger.info("Created 'challenge_id_1' unique index")
        if "expires_at_1" not in existing_challenge:
            await challenges_col.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, name="expires_at_1")
            logger.info("Created 'expires_at_1' TTL index")
        if "user_id_1" not in existing_challenge:
            await challenges_col.create_index([("user_id", ASCENDING)], name="user_id_1")
    except Exception as e:
        logger.warning(f"Challenge index note: {e}")

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

class SelfieChallengeRequest(BaseModel):
    user_id: str
    frames_base64: List[str] = Field(..., description="One or more selfie frames as base64.")

class SelfieChallengeResponse(BaseModel):
    passed: bool
    message: str
    user_id: str
    challenge_id: Optional[str] = None

class KycSelfieVerifyRequest(BaseModel):
    user_id: str
    challenge_id: str
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


def check_image_quality(image: np.ndarray) -> Optional[str]:
    b = blur_score(image)
    br = brightness_score(image)
    if b < BLUR_THRESHOLD:
        return "Your image is a bit blurry. Please hold your device steady and try again."
    if br < BRIGHTNESS_MIN:
        return "The image is too dark. Please move to a brighter area."
    if br > BRIGHTNESS_MAX:
        return "The image is too bright. Please avoid direct light or flash."
    return None


def sample_frames(frames: List[str], max_frames: int) -> List[str]:
    if len(frames) <= max_frames:
        return frames
    step = len(frames) / float(max_frames)
    return [frames[int(i * step)] for i in range(max_frames)]


def crop_face(image: np.ndarray, bbox: Dict[str, int], margin: float = 0.12) -> np.ndarray:
    h, w = image.shape[:2]
    x = max(0, int(bbox.get("x", 0)))
    y = max(0, int(bbox.get("y", 0)))
    bw = max(1, int(bbox.get("w", 0)))
    bh = max(1, int(bbox.get("h", 0)))
    pad_x = int(bw * margin)
    pad_y = int(bh * margin)
    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(w, x + bw + pad_x)
    y2 = min(h, y + bh + pad_y)
    return image[y1:y2, x1:x2]


def mean_abs_diff(img_a: np.ndarray, img_b: np.ndarray) -> float:
    if img_a.size == 0 or img_b.size == 0:
        return 0.0
    gray_a = cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY)
    gray_b = cv2.cvtColor(img_b, cv2.COLOR_BGR2GRAY)
    gray_a = cv2.resize(gray_a, (160, 160))
    gray_b = cv2.resize(gray_b, (160, 160))
    diff = cv2.absdiff(gray_a, gray_b)
    return float(np.mean(diff))


def face_center(bbox: Dict[str, int]) -> tuple:
    return (
        float(bbox.get("x", 0)) + float(bbox.get("w", 0)) / 2.0,
        float(bbox.get("y", 0)) + float(bbox.get("h", 0)) / 2.0,
    )


# Face detection and embeddings

def extract_best_face(image: np.ndarray) -> Dict[str, Any]:
    """Detect faces using opencv (fast). Only fall back to ssd if opencv finds nothing."""
    faces = None

    # Try opencv first
    try:
        faces = DeepFace.extract_faces(
            img_path=image,
            detector_backend="opencv",
            enforce_detection=False,
            align=True,
        )
    except Exception as e:
        logger.warning(f"opencv face detection failed: {e}")

    # Fall back to ssd if opencv finds nothing
    if not faces:
        try:
            faces = DeepFace.extract_faces(
                img_path=image,
                detector_backend="ssd",
                enforce_detection=False,
                align=True,
            )
        except Exception as e:
            logger.warning(f"ssd face detection also failed: {e}")

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
            face_count = max(face_count, alt_count)
            if alt_count > primary_count:
                logger.info(f"Alt face detector saw {alt_count} faces (primary={primary_count}).")
    if face_count < 1 or (
        max_faces_allowed is not None and face_count > max_faces_allowed
    ):
        return multi_face_message
    ratio = face_area_ratio(best["bbox"], image)
    if ratio < min_ratio:
        return small_face_message
    if ratio > max_ratio:
        return large_face_message
    if min_confidence is not None and best.get("confidence", 0.0) < min_confidence:
        return low_conf_message
    return None


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
                enforce_detection=False,
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

        quality_err = check_image_quality(img)
        if quality_err:
            return FaceDetectResponse(
                ok=False, message=quality_err, face_count=0,
                quality={"blur": round(b, 2), "brightness": round(br, 2)},
            )

        best = extract_best_face(img)
        constraint_err = validate_face_constraints(
            best,
            img,
            min_ratio=MIN_FACE_AREA_RATIO,
            max_ratio=MAX_FACE_AREA_RATIO,
            min_confidence=MIN_FACE_CONFIDENCE,
            multi_face_message="Multiple faces detected. Please make sure only your face is visible.",
            small_face_message="Your face is too small. Please move closer to the camera.",
            large_face_message="Your face is too close. Please move slightly farther away.",
            low_conf_message="We're having trouble detecting your face. Please improve the lighting.",
        )
        if constraint_err:
            return FaceDetectResponse(
                ok=False,
                message=constraint_err,
                face_count=best["face_count"],
                bounding_box=best["bbox"],
                quality={
                    "blur": round(b, 2),
                    "brightness": round(br, 2),
                    "face_area_ratio": round(face_area_ratio(best["bbox"], img), 4),
                },
            )
        return FaceDetectResponse(
            ok=True,
            message="Face detected. Looking good!",
            face_count=best["face_count"],
            bounding_box=best["bbox"],
            quality={
                "blur": round(b, 2),
                "brightness": round(br, 2),
                "face_area_ratio": round(face_area_ratio(best["bbox"], img), 4),
            },
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
                "id_registered_at": now.isoformat(),
                "kyc_status": "id_uploaded",
                "id_faces_detected": best["face_count"],
            }},
            upsert=True,
        )

        elapsed = time.time() - t_start
        logger.info(f"ID registered: user_id={req.user_id} (faces: {best['face_count']}) in {elapsed:.1f}s")
        return KycIdRegisterResponse(
            success=True,
            message="Your ID has been registered successfully! You can now take your selfie.",
            user_id=req.user_id,
            stored_at=now.isoformat(),
        )

    except ValueError as e:
        return KycIdRegisterResponse(success=False, message=str(e))
    except Exception as e:
        logger.error(f"ID registration error for {req.user_id}: {e}")
        return KycIdRegisterResponse(success=False, message="Something went wrong while registering your ID. Please try again.")


# Endpoint 3: selfie liveness check

@app.post("/api/kyc/selfie/challenge", response_model=SelfieChallengeResponse)
async def post_selfie_challenge(req: SelfieChallengeRequest):
    t_start = time.time()
    try:
        if not req.frames_base64 or len(req.frames_base64) < MIN_CHALLENGE_FRAMES:
            return SelfieChallengeResponse(
                passed=False,
                message=f"Please capture at least {MIN_CHALLENGE_FRAMES} selfie frames.",
                user_id=req.user_id,
            )

        record = await kyc_col.find_one({"user_id": req.user_id})
        if not record or "id_embedding" not in record:
            return SelfieChallengeResponse(passed=False, message="Please register your ID first before taking a selfie.", user_id=req.user_id)

        frames = sample_frames(req.frames_base64, MAX_CHALLENGE_FRAMES)
        face_frames = []
        quality_notes = []

        for frame_b64 in frames:
            img = resize_if_needed(decode_base64_image(frame_b64))
            quality_err = check_image_quality(img)
            if quality_err:
                quality_notes.append(quality_err)

            try:
                best = extract_best_face(img)
            except ValueError:
                return SelfieChallengeResponse(
                    passed=False,
                    message="We couldn't find your face in the selfie. Please make sure your face is clearly visible.",
                    user_id=req.user_id,
                )

            constraint_err = validate_face_constraints(
                best,
                img,
                min_ratio=MIN_FACE_AREA_RATIO,
                max_ratio=MAX_FACE_AREA_RATIO,
                min_confidence=MIN_FACE_CONFIDENCE,
                multi_face_message="Multiple people detected. Please make sure only you are in the frame.",
                small_face_message="Your face is too small. Please move closer to the camera.",
                large_face_message="Your face is too close. Please move slightly farther away.",
                low_conf_message="We're having trouble detecting your face. Please improve the lighting.",
            )
            if constraint_err:
                return SelfieChallengeResponse(
                    passed=False,
                    message=constraint_err,
                    user_id=req.user_id,
                )

            face_frames.append({"img": img, "bbox": best["bbox"]})

        diffs = []
        centers = []
        for i, entry in enumerate(face_frames):
            centers.append(face_center(entry["bbox"]))
            if i > 0:
                crop_a = crop_face(face_frames[i - 1]["img"], face_frames[i - 1]["bbox"])
                crop_b = crop_face(entry["img"], entry["bbox"])
                diffs.append(mean_abs_diff(crop_a, crop_b))

        avg_diff = float(np.mean(diffs)) if diffs else 0.0
        movement_ratio = 0.0
        if len(centers) >= 2:
            frame_h, frame_w = face_frames[0]["img"].shape[:2]
            max_move = 0.0
            for c in centers[1:]:
                dx = c[0] - centers[0][0]
                dy = c[1] - centers[0][1]
                max_move = max(max_move, float(np.hypot(dx, dy)))
            movement_ratio = max_move / float(max(frame_w, frame_h))

        if avg_diff < MIN_FRAME_DIFF and movement_ratio < MIN_FACE_MOVEMENT:
            return SelfieChallengeResponse(
                passed=False,
                message="Please blink or move your head slightly during the selfie check.",
                user_id=req.user_id,
            )

        if quality_notes:
            logger.warning(f"Selfie quality notes for {req.user_id}: {quality_notes[-1]}")

        challenge_id = str(uuid.uuid4())
        expires_at = datetime.utcnow() + timedelta(seconds=CHALLENGE_TTL_SECS)
        inserted = False
        for _ in range(3):
            try:
                await challenges_col.insert_one(
                    {
                        "challenge_id": challenge_id,
                        "user_id": req.user_id,
                        "created_at": datetime.utcnow(),
                        "expires_at": expires_at,
                    }
                )
                inserted = True
                break
            except DuplicateKeyError:
                challenge_id = str(uuid.uuid4())
        if not inserted:
            return SelfieChallengeResponse(
                passed=False,
                message="We couldn't start the selfie session. Please try again.",
                user_id=req.user_id,
            )

        elapsed = time.time() - t_start
        logger.info(f"Liveness passed: user_id={req.user_id} in {elapsed:.1f}s")
        return SelfieChallengeResponse(passed=True, message="Selfie captured successfully! Click Verify to match with your ID.", user_id=req.user_id, challenge_id=challenge_id)

    except Exception as e:
        logger.error(f"Selfie challenge error for {req.user_id}: {e}")
        return SelfieChallengeResponse(passed=False, message="Something went wrong. Please try again.", user_id=req.user_id)


# Endpoint 4: selfie vs ID check
# Try the original image first, then a normalized one if needed.

@app.post("/api/kyc/selfie/verify", response_model=KycSelfieVerifyResponse)
async def post_kyc_selfie_verify(req: KycSelfieVerifyRequest):
    t_start = time.time()
    try:
        record = await kyc_col.find_one({"user_id": req.user_id})
        if not record or "id_embedding" not in record:
            return KycSelfieVerifyResponse(verified=False, message="Please upload your ID first before verifying.", user_id=req.user_id)

        challenge = await challenges_col.find_one({"challenge_id": req.challenge_id})
        if not challenge:
            return KycSelfieVerifyResponse(verified=False, message="Your selfie session has expired. Please capture a new selfie.", user_id=req.user_id)
        if challenge.get("user_id") != req.user_id:
            return KycSelfieVerifyResponse(verified=False, message="Session mismatch. Please start the selfie step again.", user_id=req.user_id)
        expires_at = challenge.get("expires_at")
        if expires_at and expires_at < datetime.utcnow():
            await challenges_col.delete_one({"challenge_id": req.challenge_id})
            return KycSelfieVerifyResponse(verified=False, message="Your session timed out. Please capture a new selfie.", user_id=req.user_id)

        await challenges_col.delete_one({"challenge_id": req.challenge_id})

        img = resize_if_needed(decode_base64_image(req.selfie_image_base64))

        base_resp = {
            "user_id": req.user_id,
            "role": record.get("role"),
            "full_name": record.get("full_name"),
            "distance": 1.0,
            "confidence": 0.0,
        }

        # Quality check (fail fast to avoid poor matches)
        quality_err = check_image_quality(img)
        if quality_err:
            return KycSelfieVerifyResponse(verified=False, message=quality_err, **base_resp)

        # Quick face check
        try:
            best = extract_best_face(img)
        except ValueError:
            return KycSelfieVerifyResponse(verified=False, message="We couldn't find your face. Please try again with better lighting.", **base_resp)

        constraint_err = validate_face_constraints(
            best,
            img,
            min_ratio=MIN_FACE_AREA_RATIO,
            max_ratio=MAX_FACE_AREA_RATIO,
            min_confidence=MIN_FACE_CONFIDENCE,
            multi_face_message="Multiple people detected. Please make sure only you are in the frame.",
            small_face_message="Your face is too small. Please move closer to the camera.",
            large_face_message="Your face is too close. Please move slightly farther away.",
            low_conf_message="We're having trouble detecting your face. Please improve the lighting.",
        )
        if constraint_err:
            return KycSelfieVerifyResponse(verified=False, message=constraint_err, **base_resp)

        id_emb = np.array(record["id_embedding"], dtype=np.float32)

        # Try the original image first
        best_dist = 999.0
        t1 = time.time()

        try:
            emb = get_embedding_fast(img)
            d = cosine_distance(id_emb, emb)
            logger.info(f"  Fast path (original+opencv): distance={d:.4f} ({time.time()-t1:.1f}s)")
            best_dist = d
        except Exception as e:
            logger.warning(f"  Fast path failed: {e}")

        # If needed, try the normalized image next
        if best_dist > MAX_ACCEPT_DISTANCE:
            t2 = time.time()
            try:
                norm_img = normalize_image(img)
                emb = get_embedding_fast(norm_img)
                d = cosine_distance(id_emb, emb)
                logger.info(f"  Normalized path: distance={d:.4f} ({time.time()-t2:.1f}s)")
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
                "kyc_status": "approved" if verified else "rejected",
                "face_match_score": round(conf, 2),
                "cosine_distance": round(dist, 4),
                "verified_at": now.isoformat(),
                "remarks": msg,
            }},
        )

        await notify_node_backend(req.user_id, verified, conf)

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
    print(f"  MongoDB:   {MONGO_URI}")
    print(f"  Docs:      http://localhost:{FACE_SERVICE_PORT}/docs")
    print("=" * 50 + "\n")
    uvicorn.run("main:app", host="0.0.0.0", port=FACE_SERVICE_PORT, reload=True)
