# RentifyPro

A full-stack vehicle rental platform with face verification KYC, built with React, Node.js, and Python.

---

## Prerequisites

Make sure you have the following installed before running the project:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | v18 or higher | [nodejs.org](https://nodejs.org/) |
| Python | v3.10 or higher | [python.org](https://www.python.org/) |
| MongoDB | v6 or higher | [mongodb.com](https://www.mongodb.com/try/download/community) |
| Git | Latest | [git-scm.com](https://git-scm.com/) |

---

## Project Structure

```
RentifyPro/
├── frontend/          # React + Vite (User & Owner UI)
├── backend/           # Node.js + Express (API server)
└── face-service/      # Python + FastAPI (Face verification)
```

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/RentifyPro.git
cd RentifyPro
```

### 2. Start MongoDB

Make sure MongoDB is running on your machine:

```bash
# Windows (if installed as a service, it starts automatically)
# To start manually:
mongod

# Or if using MongoDB as a Windows service:
net start MongoDB
```

Verify MongoDB is running:

```bash
mongosh
```

You should see the MongoDB shell. Type `exit` to leave.

---

### 3. Setup & Run the Backend (Node.js)

```bash
# Navigate to the backend folder
cd backend

# Install dependencies
npm install

# Create your environment file
cp .env.example .env
```

Edit the `.env` file with your credentials:

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/rentifypro
JWT_SECRET=your-secret-key-here
JWT_EXPIRE=7d
FRONTEND_URL=http://localhost:5173
FACE_SERVICE_URL=http://localhost:8000
INTERNAL_API_KEY=rentifypro-internal-secret
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

Start the backend server:

```bash
npm run dev
```

You should see:

```
🚀 Server running on port 5000
📦 MongoDB connected
```

---

### 4. Setup & Run the Face Service (Python)

Open a **new terminal** window:

```bash
# Navigate to the face service folder
cd face-service

# Create a virtual environment
python -m venv venv

# Activate the virtual environment
# Windows (Command Prompt):
venv\Scripts\activate
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# macOS / Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

Create your environment file:

```bash
cp .env.example .env
```

Edit the `.env` file:

```env
MONGO_URI=mongodb://localhost:27017/rentifypro
FRONTEND_URL=http://localhost:5173
NODE_BACKEND_URL=http://localhost:5000
INTERNAL_API_KEY=rentifypro-internal-secret
```

Start the face service:

```bash
python main.py
```

You should see:

```
==================================================
  RentifyPro KYC API v3.0
==================================================
  Model:    ArcFace
  Detector: retinaface
  MongoDB:  mongodb://localhost:27017/rentifypro
  Docs:     http://localhost:8000/docs
==================================================
```

> **Note:** The first startup takes a few minutes because it downloads the ArcFace and RetinaFace AI models (~500MB). Subsequent starts are much faster.

---

### 5. Setup & Run the Frontend (React + Vite)

Open a **new terminal** window:

```bash
# Navigate to the frontend folder
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

You should see:

```
  VITE v5.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

---

### 6. Open the App

Open your browser and go to:

```
http://localhost:5173
```

---

## All Three Services at a Glance

You need **3 terminal windows** running simultaneously:

| Terminal | Service | Command | URL |
|----------|---------|---------|-----|
| Terminal 1 | Backend (Node.js) | `cd backend && npm run dev` | http://localhost:5000 |
| Terminal 2 | Face Service (Python) | `cd face-service && python main.py` | http://localhost:8000 |
| Terminal 3 | Frontend (React) | `cd frontend && npm run dev` | http://localhost:5173 |

---

## Quick Start (All Commands)

```bash
# Terminal 1 — Backend
cd RentifyPro/backend
npm install
npm run dev

# Terminal 2 — Face Service
cd RentifyPro/face-service
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
python main.py

# Terminal 3 — Frontend
cd RentifyPro/frontend
npm install
npm run dev
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `MongoServerError: connect ECONNREFUSED` | MongoDB is not running. Start it with `mongod` |
| `ModuleNotFoundError: No module named 'fastapi'` | Activate the virtual environment first: `venv\Scripts\activate` |
| `EADDRINUSE: port 5000 already in use` | Another process is using port 5000. Kill it or change the PORT in `.env` |
| Face service takes long to start | First startup downloads AI models (~500MB). Wait for it to finish. |
| `Invalid login: 535-5.7.8 Username and Password not accepted` | Your Gmail app password is wrong. Generate a new one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) |
| PowerShell: `running scripts is disabled` | Run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| `WARNING: You must pass the application as an import string` | Make sure `main.py` uses `uvicorn.run("main:app", ...)` not `uvicorn.run(app, ...)` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Lucide Icons |
| Backend | Node.js, Express.js, MongoDB, Mongoose |
| Face Verification | Python, FastAPI, DeepFace (ArcFace), OpenCV, RetinaFace |
| Authentication | JWT, bcrypt, OTP via email |
| Database | MongoDB |

---

## Team

| Name | Role |
|------|------|
| | |
| | |
| | |

---

## License

This project is for academic purposes only — BSIT Capstone Project.