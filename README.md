# AlgoNext Frontend

## Overview
This is a Next.js (App Router) frontend for creating, enqueueing, and monitoring video analysis jobs.

## Local development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env.local` file with the backend API origin:
   ```bash
   API_ORIGIN=http://46.224.249.136:8000
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`.

## Environment variables
| Name | Required | Description |
| --- | --- | --- |
| `API_ORIGIN` | ✅ | Origin for the AlgoNext backend API (e.g. `https://YOUR_API_DOMAIN` or `http://46.224.249.136:8000`). |

## Deploy to Vercel
1. Import this repository into Vercel.
2. Add the environment variable `API_ORIGIN` (non-public) in the Vercel project settings.
3. Trigger a build & deploy.

## CORS note
The frontend uses Next.js route handlers as a proxy, so browser requests stay same-origin while the server forwards them to the backend API.
