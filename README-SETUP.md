# RentifyPro Setup Guide (Local Development)

For temporary public user testing, see [Cloudflare Quick Tunnel setup](README-QUICK-TUNNEL.md).

This guide covers full local setup for the RentifyPro website:
- `frontend` (React + Vite)
- `backend` (Node.js + Express)
- `face-service` (FastAPI + DeepFace)
- `chatbot-service` (FastAPI + Sentence Transformers)

## 1. Prerequisites

Install these first:
- Node.js 20.19+ or 22.12+ (required by the installed Vite version)
- npm (comes with Node.js)
- Python 3.10 or 3.11
- Git
- MongoDB access:
1. MongoDB Atlas cluster (recommended), or
2. Local MongoDB server

## 2. Open Project Root

Open PowerShell in your own cloned `RentifyPro` folder. Run the commands below
from that folder unless a step says to enter a service folder.

```powershell
Set-Location 'C:\path\to\your\RentifyPro'
```

## 3. Install Node Dependencies

```powershell
cd backend
npm ci

cd ..\frontend
npm ci

cd ..
```

## 4. Create Python Environments and Install Dependencies

### 4.1 Face Service

```powershell
cd face-service
py -3.10 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
deactivate
cd ..
```

### 4.2 Chatbot Service

```powershell
cd chatbot-service
py -3.10 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
deactivate
cd ..
```

If `py -3.10` is not available, use `python -m venv venv`.

The chatbot uses only `chatbot-service/rentifypro_chatbot_dataset_v6.json`. Legacy
dataset files are retained for history but are not loaded, and `CHATBOT_DATASET_PATH`
does not override the v6 dataset.

## 5. Create Environment Files

### 5.1 Backend `.env`

```powershell
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
```

The example is safe to commit. The populated `backend/.env` is private and is
ignored by Git. Each teammate must fill its blank secret fields on their own
computer. Use the local MongoDB URI in the example only if MongoDB runs on that
computer; otherwise use their authorized Atlas URI. Do not copy another
teammate's `.env` into the repository.

Set at least the values below in `backend/.env`:

```env
PORT=5000
NODE_ENV=development

MONGO_URI=mongodb://127.0.0.1:27017/rentifypro
MONGO_URI_DIRECT=
MONGO_DB_NAME=rentifypro

JWT_SECRET=<strong-random-secret>
PASSWORD_RESET_TOKEN_SECRET=<strong-random-secret>
JWT_EXPIRE=7d
PASSWORD_RESET_TOKEN_EXPIRE=15m

FRONTEND_URL=http://localhost:5173
FACE_SERVICE_URL=http://localhost:8000
CHATBOT_URL=http://localhost:8001
INTERNAL_API_KEY=<shared-internal-secret>
GEMINI_API_KEY=<private-gemini-key>
FACE_SERVICE_AUTOSTART=true
CHATBOT_SERVICE_AUTOSTART=true
```

Also set `GEMINI_API_KEY` before testing document validation. Without it, the
ID details cannot be compared with registration details, so the selfie step
will remain locked. Registration email and OTP delivery need working SMTP
credentials.

Other feature-specific settings:
- SMTP for OTP email:
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_FROM_NAME`
  (or legacy `EMAIL_USER`, `EMAIL_PASS`)
- `PAYMONGO_SECRET_KEY` (checkout/payment)

Document checks run through a database-backed queue so a Gemini quota or temporary
provider failure does not reject an applicant. Recommended free-tier settings are:

```env
KYC_DOCUMENT_QUEUE_ENABLED=true
KYC_ALLOW_GEMINI_AUTO_APPROVE=false
KYC_GEMINI_REQUESTS_PER_MINUTE=4
KYC_GEMINI_MAX_ATTEMPTS=3
KYC_DOCUMENT_QUEUE_POLL_MS=5000
KYC_PROCESSING_LOCK_TIMEOUT_MS=600000
KYC_PENDING_REVIEW_RETENTION_HOURS=72
```

Keep automatic approval disabled unless the legal and risk policy explicitly permits
it. The Super Admin makes the final decision in **Customers > Documents**. See
`docs/KYC_VERIFICATION_WORKFLOW.md` before production deployment.

### 5.2 Frontend `.env`

```powershell
if (-not (Test-Path frontend\.env)) { Copy-Item frontend\.env.example frontend\.env }
```

Use the local backend address below. An existing empty `frontend/.env` needs
these two lines added manually. Restart Vite after changing `.env`; `VITE_`
values are bundled into browser code, so never put secrets there.

```env
VITE_API_BASE_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```

### 5.3 Face Service `.env`

```powershell
if (-not (Test-Path face-service\.env)) { Copy-Item face-service\.env.example face-service\.env }
```

Use the same MongoDB database and the same private `INTERNAL_API_KEY` as the
backend. `FACE_SERVICE_PORT` must match the port in `FACE_SERVICE_URL` in
`backend/.env`:

```env
MONGO_URI=<same mongo uri as backend>
MONGO_URI_DIRECT=<same direct mongo uri as backend>
MONGO_DB_NAME=rentifypro
FRONTEND_URL=http://localhost:5173
NODE_BACKEND_URL=http://localhost:5000
INTERNAL_API_KEY=<same shared key as backend>
FACE_SERVICE_PORT=8000
```

## 6. Run the Project

You have two options.

### Option A (Recommended): Backend auto-starts Python services

Run only backend + frontend terminals after setup.

Terminal 1:

```powershell
cd .\backend
npm run dev
```

Terminal 2:

```powershell
cd .\frontend
npm run dev
```

### Option B: Start all services manually

Terminal 1 (backend):

```powershell
cd .\backend
npm run dev
```

Terminal 2 (face-service):

```powershell
cd .\face-service
.\venv\Scripts\Activate.ps1
python main.py
```

Terminal 3 (chatbot-service):

```powershell
cd .\chatbot-service
.\venv\Scripts\Activate.ps1
python -m uvicorn app:app --env-file ../backend/.env --host 127.0.0.1 --port 8001 --reload
```

Terminal 4 (frontend):

```powershell
cd .\frontend
npm run dev
```

## 7. Verify Everything Is Running

Expected URLs:
- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:5000/api/health`
- Face service: `http://localhost:8000/`
- Chatbot health: `http://localhost:8001/health`

Useful backend checks:

```powershell
cd .\backend
npm run db:check
npm run services:check
```

## 8. Common Issues

1. MongoDB auth/SRV errors
- Recheck Atlas username/password and IP allowlist.
- If SRV DNS fails, fill `MONGO_URI_DIRECT` too.

2. `EADDRINUSE` on port `5000`, `5173`, `8000`, or `8001`
- Another process is already using the port; stop it or change env ports.

3. PowerShell blocks venv activation
- Run once in PowerShell (Current User):
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

4. Face service startup is slow on first run
- Initial DeepFace model download can take several minutes.

5. Chatbot service fails to boot
- Confirm `chatbot-service/venv` exists and dependencies installed.
- Retry:
```powershell
cd .\chatbot-service
.\venv\Scripts\Activate.ps1
python -m uvicorn app:app --host 127.0.0.1 --port 8001 --reload
```
