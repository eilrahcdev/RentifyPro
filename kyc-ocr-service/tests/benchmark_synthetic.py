"""Opt-in real-model benchmark using generated text, never participant documents."""
import io
import json
from pathlib import Path
import socket
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from PIL import Image, ImageDraw, ImageFont
import psutil


def deny_network(*_args, **_kwargs):
    raise RuntimeError("This synthetic benchmark must run offline.")


if __name__ == "__main__":
    socket.socket.connect = deny_network
    started = time.perf_counter()
    main.ENGINE = main.create_engine()
    startup_seconds = time.perf_counter() - started
    font = ImageFont.truetype("arial.ttf", 30) if sys.platform == "win32" else ImageFont.truetype("DejaVuSans.ttf", 30)
    image = Image.new("RGB", (1000, 650), "white")
    draw = ImageDraw.Draw(image)
    for index, text in enumerate(["SYNTHETIC TEST - NOT AN ID", "PHILIPPINE PASSPORT", "Full Name: SAMPLE APPLICANT",
                                   "Date of Birth: 1990-05-12", "Passport No: SYNTHETIC123", "Expiry Date: 2099-05-12"]):
        draw.text((35, 40 + index * 75), text, fill="black", font=font)
    timings = []
    peak_rss = 0
    for format, mime in [("PNG", "image/png"), ("PNG", "image/png"), ("PDF", "application/pdf")]:
        output = io.BytesIO()
        image.save(output, format=format)
        started = time.perf_counter()
        result = main.extract_lines(output.getvalue(), mime)
        elapsed = time.perf_counter() - started
        peak_rss = max(peak_rss, psutil.Process().memory_info().rss)
        assert any("SAMPLE APPLICANT" in line["text"] for line in result["lines"]), "Synthetic name was not extracted."
        assert any("SYNTHETIC123" in line["text"] for line in result["lines"]), "Synthetic identifier was not extracted."
        timings.append({"format": format, "seconds": round(elapsed, 3), "lines": len(result["lines"])})
    print(json.dumps({"synthetic_only": True, "offline": True, "startup_seconds": round(startup_seconds, 3),
                      "sampled_peak_rss_mib": round(peak_rss / 1024**2, 1), "runs": timings}))
