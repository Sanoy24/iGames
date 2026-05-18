# Getting Started

## Requirements

- **Node.js**: `v20` or higher
- **MongoDB**: `v6.0` or higher
- **Redis**: `v7.0` or higher (for distributed locks and pub/sub)
- **Telegram Bot Token**: Created via [@BotFather](https://t.me/BotFather)

## Environment Setup

Create a `.env` file in the root directory:

```env
# Server
PORT=3000
JWT_SECRET=your_super_secret_jwt_key
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/igames

# Redis
REDIS_URL=redis://localhost:6379

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

## Installation

Install dependencies for both the backend API and the frontend application:

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
```

## Starting the Platform

Boot the backend API layer and the frontend development server:

```bash
# Terminal 1: Backend
npm run start:dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

Your API is now available at `http://localhost:3000` and the mini-app UI is running at `http://localhost:5173`.
