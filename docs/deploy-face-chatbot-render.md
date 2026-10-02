# Deploy Face Service + Chatbot Service on Render

If you want these features in production, both services must be deployed:

- Face verification during registration (renter/owner)
- Owner supporting-document verification flow
- AI chatbot replies

Without them, backend endpoints that depend on those services will fail.

## 1. Deploy `face-service` on Render

Create a new **Web Service**:

- **Runtime**: Python
- **Root Directory**: `face-service`
- **Build Command**: `pip install --upgrade pip && pip install -r requirements.txt`
- **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Set environment variables:

- `MONGO_URI=<atlas-uri>`
- `MONGO_URI_DIRECT=<atlas-direct-uri>` (recommended)
- `MONGO_DB_NAME=rentifypro`
- `FRONTEND_URL=https://<your-vercel-domain>`
- `NODE_BACKEND_URL=https://<your-render-backend-domain>`
- `INTERNAL_API_KEY=<same-value-as-backend>`
- `FACE_SERVICE_PORT=8000` (optional)

After deploy, open:

- `https://<face-service-domain>/`
- `https://<face-service-domain>/docs`

## 2. Deploy `chatbot-service` on Render

Create another **Web Service**:

- **Runtime**: Python
- **Root Directory**: `chatbot-service`
- **Build Command**: `pip install --upgrade pip && pip install -r requirements.txt`
- **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`

After deploy, open:

- `https://<chatbot-service-domain>/`
- `https://<chatbot-service-domain>/health`

## 3. Wire URLs into backend (Render backend service)

In backend Render env vars, set:

- `FACE_SERVICE_AUTOSTART=false`
- `CHATBOT_SERVICE_AUTOSTART=false`
- `FACE_SERVICE_URL=https://<face-service-domain>`
- `CHATBOT_URL=https://<chatbot-service-domain>`
- `ALLOW_VERCEL_PREVIEW_ORIGINS=true` (optional, for Vercel preview links)

Then redeploy backend.

## 4. Wire frontend to backend (Vercel)

In Vercel env vars:

- `VITE_API_BASE_URL=https://<your-render-backend-domain>`
- `VITE_SOCKET_URL=https://<your-render-backend-domain>`

Then redeploy Vercel.

## 5. Quick validation checklist

1. Vercel browser devtools network: no `Failed to fetch` to backend APIs.
2. Backend logs show successful calls to `FACE_SERVICE_URL` and `CHATBOT_URL`.
3. `POST /api/kyc/pre/id-register` returns JSON (not network/CORS error).
4. `POST /api/kyc/pre/supporting-doc/verify` returns JSON.
5. `POST /api/chat` returns chatbot reply.

## Notes

- First chatbot startup may be slower because the embedding model downloads.
- Face service is compute-heavy (`deepface` + `tf-keras`); use a Render instance with enough RAM/CPU.
