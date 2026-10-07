"""Download public model weights during setup/build, never during document processing."""
import argparse
import hashlib
import io
from pathlib import Path
import tarfile
from urllib.request import urlopen

BASE = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/"
MODELS = ["PP-OCRv5_mobile_det", "en_PP-OCRv5_mobile_rec"]
HASHES = {
    "PP-OCRv5_mobile_det": "50446e5d01ac2a73d5319c89513281f6578414c888c602f9af13f93feefffc58",
    "en_PP-OCRv5_mobile_rec": "e595b4cf2ffad19fbb5a61ba345d63939577a3ab8717b6e5995642590c9101b4",
}


def download_models(destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    for name in MODELS:
        with urlopen(f"{BASE}{name}_infer.tar", timeout=120) as response:
            archive = response.read(30 * 1024 * 1024 + 1)
        if len(archive) > 30 * 1024 * 1024:
            raise RuntimeError("Model archive exceeded its size limit.")
        if hashlib.sha256(archive).hexdigest() != HASHES[name]:
            raise RuntimeError("The model download did not match the reviewed checksum.")
        with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
            for member in bundle.getmembers():
                parts = Path(member.name).parts
                if len(parts) != 2 or parts[0] != f"{name}_infer" or not member.isfile():
                    if member.isdir():
                        continue
                    raise RuntimeError("Unexpected model archive entry.")
                target = destination / name / parts[1]
                if target.parent != destination / name or parts[1] in {".", ".."}:
                    raise RuntimeError("Unsafe model archive path.")
                target.parent.mkdir(exist_ok=True)
                with bundle.extractfile(member) as source:
                    target.write_bytes(source.read())
        print(f"{name}: archive_sha256={hashlib.sha256(archive).hexdigest()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", default=str(Path(__file__).parent / "models"))
    download_models(parser.parse_args().destination)
