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
   API_BASE_URL=http://46.224.249.136:8000
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`.

## Environment variables
| Name | Required | Description |
| --- | --- | --- |
| `API_BASE_URL` | ✅ | Base URL for the AlgoNext backend API (e.g. `https://YOUR_API_DOMAIN` or `http://46.224.249.136:8000`). |

## Deploy to Vercel
1. Import this repository into Vercel.
2. Add the environment variable `API_BASE_URL` (non-public) in the Vercel project settings.
3. Trigger a build & deploy.

## Verification checklist
1. Create a job from the UI.
2. Enqueue the job.
3. Confirm the status transitions from `RUNNING` → `COMPLETED`.
4. Confirm `progress.pct` reaches `100`.
5. Confirm `result` is not `{}`.

### Database debug command
```bash
docker compose exec db psql -U postgres -d app -c "
select id,status,progress,result is not null as has_result,updated_at
from analysis_jobs
order by updated_at desc
limit 5;
"
```

## CORS note
The frontend uses Next.js route handlers as a proxy, so browser requests stay same-origin while the server forwards them to the backend API.
