# Tools & Fundamentals - RentifyPro

This file summarizes the technologies used in this project across `frontend`, `backend`, `face-service`, and `chatbot-service`.

## 1) Programming Languages

- JavaScript (ES Modules) - frontend + backend
- Python - AI/ML microservices (`face-service`, `chatbot-service`)
- HTML/CSS - web app UI (`frontend`)
- JSON - config/data payloads and chatbot dataset

## 2) Core Frameworks

- React 19 - frontend UI
- Vite 7 - frontend dev server and bundling
- Express 5 - backend REST API server
- FastAPI - Python services (`face-service`, `chatbot-service`)
- Socket.IO - real-time messaging (backend + frontend client)

## 3) Main Libraries / Modules by Service

### Frontend (`frontend`)

- `react`, `react-dom`
- `react-router-dom`
- `axios`
- `socket.io-client`
- `tailwindcss`, `postcss`, `autoprefixer`
- `lucide-react`
- `react-hot-toast`
- `recharts`
- `eslint` + React ESLint plugins

Also uses browser APIs:
- `navigator.mediaDevices.getUserMedia`, `ImageCapture`, `FileReader` (camera/KYC flows)

### Backend (`backend`)

- `express`
- `mongoose` (MongoDB ODM)
- `cors`
- `cookie-parser`
- `dotenv`
- `jsonwebtoken`
- `bcryptjs`
- `multer`
- `nodemailer`
- `axios`
- `socket.io`
- `helmet`
- `express-rate-limit`
- `hpp`
- `form-data`
- `@google/generative-ai`

Dev/runtime tools:
- `nodemon`

### Face Service (`face-service`)

- `fastapi`
- `uvicorn`
- `pydantic`
- `deepface`
- `opencv-python-headless` (`cv2`)
- `numpy`
- `motor` (async MongoDB driver)
- `httpx`
- `python-dotenv`
- `tf-keras`
- `pymongo` (imported in code)

### Chatbot Service (`chatbot-service`)

- `fastapi`
- `uvicorn`
- `sentence-transformers`
- `numpy`
- `scikit-learn` (`sklearn.metrics.pairwise.cosine_similarity`, imported in code)
- `pydantic`

## 4) APIs and External Services

- MongoDB Atlas / MongoDB - primary data store
- PayMongo API - checkout/payment session and verification
- Google Gemini API - AI-assisted KYC/document verification
- SMTP email provider (for OTP/password/email notifications)

## 5) Tooling, Build, and Deployment

- Node.js + npm (frontend/backend)
- Python + `pip` + virtual environments (Python services)
- Vite build pipeline
- ESLint for frontend linting
- Render (backend + Python service deployment docs)
- Vercel (frontend deployment docs)
- MongoDB Atlas (managed database deployment docs)

## 6) Architectural Fundamentals

- Monorepo with 4 runtime services:
  - `frontend` (React SPA)
  - `backend` (Express API + Socket.IO)
  - `face-service` (FastAPI + DeepFace KYC)
  - `chatbot-service` (FastAPI + semantic retrieval chatbot)
- REST APIs for app flows + internal service-to-service calls
- WebSocket events for real-time chat/notifications
- JWT-based auth and role-based authorization middleware
- MongoDB-backed booking and payment records
