"""Opt-in offline CPU benchmark using generated text, never participant documents."""
import argparse
import contextlib
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def deny_network(*_args, **_kwargs):
    raise RuntimeError("This synthetic benchmark must run offline.")


def benchmark(acceleration):
    import main
    from PIL import Image, ImageDraw, ImageFont
    import psutil

    stop = threading.Event()
    peak_rss = [0]
    process = psutil.Process()

    def sample_memory():
        while not stop.is_set():
            peak_rss[0] = max(peak_rss[0], process.memory_info().rss)
            stop.wait(0.05)

    sampler = threading.Thread(target=sample_memory, daemon=True)
    sampler.start()
    try:
        started = time.perf_counter()
        main.ENGINE = main.create_engine(enable_mkldnn=acceleration)
        startup_seconds = time.perf_counter() - started
        font = ImageFont.truetype("arial.ttf", 30) if sys.platform == "win32" else ImageFont.truetype("DejaVuSans.ttf", 30)
        image = Image.new("RGB", (1000, 650), "white")
        draw = ImageDraw.Draw(image)
        for index, text in enumerate(["SYNTHETIC TEST - NOT AN ID", "PHILIPPINE PASSPORT", "Full Name: SAMPLE APPLICANT",
                                      "Date of Birth: 1990-05-12", "Passport No: SYNTHETIC123", "Expiry Date: 2099-05-12"]):
            draw.text((35, 40 + index * 75), text, fill="black", font=font)
        timings = []
        for format, mime in [("PNG", "image/png"), ("PNG", "image/png"), ("PDF", "application/pdf")]:
            output = io.BytesIO()
            image.save(output, format=format)
            started = time.perf_counter()
            result = main.extract_lines(output.getvalue(), mime)
            elapsed = time.perf_counter() - started
            assert any("SAMPLE APPLICANT" in line["text"] for line in result["lines"]), "Synthetic name was not extracted."
            assert any("SYNTHETIC123" in line["text"] for line in result["lines"]), "Synthetic identifier was not extracted."
            timings.append({"format": format, "seconds": round(elapsed, 3), "lines": len(result["lines"])})
        return {"synthetic_only": True, "offline": True, "acceleration_requested": acceleration,
                "startup_seconds": round(startup_seconds, 3),
                "sampled_peak_rss_mib": round(peak_rss[0] / 1024**2, 1), "runs": timings}
    finally:
        stop.set()
        sampler.join()
        main.ENGINE = None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acceleration", choices=["true", "false"], default="true")
    parser.add_argument("--compare-cpu", action="store_true", help="Compare baseline and accelerated readers in separate processes.")
    args = parser.parse_args()
    socket.socket.connect = deny_network
    if args.compare_cpu:
        for mode in ["false", "true"]:
            child = subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()), "--acceleration", mode],
                                   capture_output=True, text=True, check=True)
            print(child.stdout.strip(), flush=True)
    else:
        with contextlib.redirect_stdout(io.StringIO()):
            result = benchmark(args.acceleration == "true")
        print(json.dumps(result))
