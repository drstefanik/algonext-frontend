# AlgoNext Frontend

## Overview
This is a Next.js (App Router) frontend for creating, enqueueing, and monitoring video analysis jobs.

## Local development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env.local` file with the backend API base URL:
   ```bash
   NEXT_PUBLIC_API_BASE_URL=https://YOUR_API_DOMAIN
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`.

## Environment variables
| Name | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | ✅ | Base URL for the AlgoNext backend API (e.g. `https://YOUR_API_DOMAIN` or `http://46.224.249.136:8000`). |

If the variable is missing, the UI will show `Missing NEXT_PUBLIC_API_BASE_URL` and disable API requests.

## Deploy to Vercel
1. Import this repository into Vercel.
2. Add the environment variable `NEXT_PUBLIC_API_BASE_URL` in the Vercel project settings.
3. Trigger a build & deploy.

## CORS note
The frontend makes browser `fetch` requests directly to the backend API. If requests are blocked, ensure the backend CORS configuration allows the Vercel deployment origin (add the origin to `allow_origins`).
