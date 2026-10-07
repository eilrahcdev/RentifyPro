# Private KYC text extraction

This CPU service reads text from JPEG, PNG, and PDF documents using PaddleOCR and OpenCV. RentifyPro's Node backend performs preliminary field comparisons, and the administrator inspects the original document before saving a comparison and making the final decision. Matching text alone cannot establish authenticity or document layout. The existing supported document types and selfie requirements remain in force.

The service accepts authenticated server requests containing only document bytes, MIME type, and protocol version. It keeps image/PDF bytes in memory, writes no participant documents, and returns text with OCR confidence, page numbers, and normalized text bounds (`schema_version=1`, `layout_version=2`). It has no Gemini integration, registration database, browser API, or automatic approval endpoint. Keep `GEMINI_SENSITIVE_DATA_APPROVED=false` in RentifyPro.

The `/health` response advertises `ready`, `schema_version=1`, `provider=paddleocr`, and `layout_version=2` with `Cache-Control: no-store`. The development launcher reuses only a ready service with these capabilities. If an older process occupies the port, it reports that the service needs restarting and leaves that process untouched. Live extraction also requires version 2 positions, including when autostart is disabled or the service is hosted remotely. Missing positions are a service compatibility problem, not proof that a document is unreadable; Node retains those uploads for manual review without enabling selfies or calling Gemini.

After updating the service, stop its existing terminal process and restart Python and Node. A backend restart alone can leave a separately launched Python worker unchanged. With local autostart enabled, `npm.cmd run dev` starts the updated worker when its port is free; otherwise use `npm.cmd run kyc:ocr:dev` from `backend/` in a separate terminal. Re-upload a previously unmatched document to obtain a fresh result. This does not overwrite approved documents or current manual comparisons. No new environment variables are needed.

Node independently classifies OCR title/issuer evidence against the existing 17 supported types before comparing personal or business information. A different type, unknown type, or conflicting types requires a new upload; low-confidence type evidence requires manual review. Selecting a type or supplying matching names cannot substitute for detected type evidence. This is text-based screening, not issuer verification or proof of authenticity; original document structure and final approval still require administrator review.

Node uses field positions to associate labels with their values on the same page/column, checks the detected type's required fields and applicable expiry, and compares the required profile details. Successful preliminary matching requires at least 90% confidence on both the type evidence and each critical field, preserving a stronger configured classification threshold. Bilingual labels and a unique National ID card number without a label are supported. The existing owner flow does not gain a birth-date input requirement; renter birth-date matching remains required. Contradictory readings, ambiguous dates, missing required data, and low confidence cannot pass. Legacy normalization still accepts inline readings; live service responses require version 2 positions and split labels are never paired by arbitrary line order. Rigid layout, separate country-banner, OCR portrait, and MRZ presence checks no longer block a match; Python no longer runs the extra portrait/quality analysis. These are type-and-details checks, not authenticity or issuer verification.

Registration displays one specific message per document. A successful current ID match unlocks live selfie verification before manual review finishes. Its versioned keyed binding uses the existing fingerprint secret and binds the file/type result to the registration snapshot, role, and session. Replacement, rejected, uncertain, duplicate, expired, stale, and legacy stored results cannot unlock selfies. Final approval still requires the administrator's recorded comparison; Face Service matching and liveness remain required. New environment variables are not needed. Restart Python and Node, then submit again to check an upload processed by older screening rules.

## Local setup

Use Python 3.11 in a separate virtual environment. From this directory in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe download_models.py
```

The download script retrieves two public inference models from PaddlePaddle and verifies their reviewed SHA-256 checksums. The generated `models/` directory and virtual environment are ignored by Git. Model weights must exist before startup; inference does not download them. [PaddleOCR's documentation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md) describes the local model-directory and CPU options used here.

Set a private `KYC_PRIVATE_INTERNAL_API_KEY` in the backend `.env`, at least 32 characters, or use the existing `INTERNAL_API_KEY` when it meets that requirement. The explicit local launcher reads the chosen key privately and passes it to Python as `INTERNAL_API_KEY`. From `backend/`, start it with:

```powershell
npm.cmd run kyc:ocr:dev
```

The launcher uses `kyc-ocr-service/.venv/` or the existing isolated `qa/private-kyc-venv/` environment. You can pass `-- --python=<absolute virtual-environment interpreter>` to select another prepared environment. It rejects production use and reuses an already healthy local service.

For automatic local startup with `npm.cmd run dev` in `backend/`, set `KYC_PRIVATE_SERVICE_AUTOSTART=true`, `KYC_DOCUMENT_PROVIDER=private_ocr`, and `KYC_PRIVATE_SERVICE_URL=http://127.0.0.1:8020` in the backend `.env`. The backend starts OCR in the background, reuses an existing healthy instance, and stops only its own worker on shutdown. The switch defaults to false and cannot launch Python in production or for a remote endpoint. On Azure, keep it false and deploy this service separately.

Alternatively, set Python's `INTERNAL_API_KEY` privately to the same selected OCR key and start one worker directly. Do not put its value in a command, Git, the frontend, or Docker build arguments:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8020 --workers 1 --limit-concurrency 8 --no-access-log
Invoke-RestMethod http://127.0.0.1:8020/health
```

The health endpoint returns 200 only after both models have loaded and warmed up. In the local Node environment choose `KYC_DOCUMENT_PROVIDER=private_ocr`, `KYC_PRIVATE_SERVICE_URL=http://127.0.0.1:8020`, and keep the Gemini switch false. Set the explicit document-fingerprint secret on both website and admin backends to the same existing private random value. Restart each process after configuration changes.

## Azure Container Apps

Build only this service, then deploy its image separately from the Node App Service:

```powershell
docker build -t rentifypro-kyc-ocr:local .
```

The Docker build includes the public models. Its allowlist excludes `.env`, test documents, uploads, local environments, and repository siblings. The container runs as a non-root user on port 8020. Store `INTERNAL_API_KEY` as a Container Apps secret and reference it from the environment; never bake it into the image. Use your actual registry, subscription, and resource names when publishing the image.

Start the Azure assessment with one replica at most, one vCPU, and 1 GiB memory, then measure actual usage with synthetic documents. These are starting limits to test, not a capacity guarantee. A minimum of zero replicas reduces idle usage but introduces cold starts; retain a startup-probe allowance for model loading, readiness on `/health`, and target port 8020. Use private ingress when the Node/admin services can reach it; otherwise use the owned HTTPS endpoint and internal-key authentication. Restrict runtime outbound traffic after building the image when the deployment network permits it.

Configure Node's `KYC_PRIVATE_SERVICE_URL` to that real owned HTTPS endpoint only after its health and authenticated extraction checks pass. If the admin backend should show OCR suggestions, give it the same private URL, provider selection, and selected OCR key. Both Node backends need the same document-fingerprint secret and existing private KYC storage access. The Python service needs neither the fingerprint secret nor mounted participant storage. See [backend configuration](../backend/ENVIRONMENT.md#private-document-extraction).

There is no provider API-credit allowance for local inference. Azure compute, registry, build, and log usage can still consume trial credits. Hosted cost and throughput have not been verified by the local benchmark.

## Limits and review behavior

One extraction runs at a time. Concurrent authenticated requests receive 429 for the existing Node queue to retry. Images are resized to a maximum 1400-pixel edge; input files are limited to 4 MiB, images to 20 million pixels, PDFs to five pages, and OCR output to 1200 lines. PDFs render one page at a time and close native resources explicitly. [PDFium's API](https://pypdfium2.readthedocs.io/en/stable/python_api.html) documents those resources.

Node defaults to a 30-second request timeout. Python checks a 25-second elapsed budget between pages; this does not interrupt an individual native inference call. Requests beyond supported limits become manual-review cases without deleting the original stored document. The service has no unbounded internal work queue. Documents must be upright and legible; orientation/unwarping models are disabled to reduce memory. Uncertain OCR, unfamiliar layouts, screenshots, and suspected alterations need human inspection.

Ready private documents run sequentially without queue-poll gaps. Transient private service failures have at most two attempts and a three-second retry delay; a request timeout goes directly to manual review rather than repeating a potentially still-running native call. Registration retains the upload controls and reports automated matches separately from admin review. Restart the Python process when updating this service; reusing an older healthy process will retain its old response format until restarted.

The Node provider never falls back to Gemini. Private OCR results always require review, even if a legacy automatic-verification switch is true. The administrator must confirm original-document features and correct OCR fields; the backend rejects mismatching registration details, expired documents, duplicate identifiers, or stale file/version evidence. Comparison and final approval remain separate, password-protected actions in the admin application. OCR suggestions and images are not written to service logs or disk; protect the existing Node storage and admin audit records with their existing access and retention rules.

## Validation

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe tests/benchmark_synthetic.py
```

Service unit tests use a fake OCR engine to exercise request authentication, file decoding, PDF bounds, output shape, and busy/startup behavior. The separate benchmark uses the real downloaded models, denies network connections, and creates synthetic text images/PDFs in memory. It verifies sample name and identifier extraction. It does not measure real-document accuracy or issuer authenticity.

Backend tests exercise the full 17-type recognition/mismatch matrix, positioned extraction, required-field confidence, dates, business matching, safe public summaries, stale revisions, and unchanged manual approval. The opt-in `scripts/private-document-checker-browser-check.mjs` checks the actual renter/owner forms at desktop/mobile sizes with intercepted synthetic responses. These checks do not establish real-document accuracy; representative labeled document variants are still needed before claiming parity with Gemini.

With the essential matching flow, the local Windows synthetic benchmark measured model startup at 5.594 seconds, two PNG extractions at 2.003 and 2.157 seconds, a PDF extraction at 3.238 seconds, and sampled process RSS at 335.6 MiB. Memory is sampled after extraction rather than a continuous peak measurement. These are single-process synthetic measurements, not a capacity guarantee. Docker/Linux and Azure startup, memory, concurrency, and real-document accuracy require separate verification.
