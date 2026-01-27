# Job flow audit (select-track / target / enqueue)

## Routes audit

| Route FE | Endpoint BE | Method | Request/Response shape | Error handling | Problems found |
| --- | --- | --- | --- | --- | --- |
| `/api/jobs/[jobId]` | `${API_BASE_URL}/jobs/:jobId` | `GET` | **Request**: no body. **Response**: job payload, proxied upstream. | Returns `500` with `{ ok: false, error: "API_BASE_URL missing" }` if env missing. Otherwise uses proxy passthrough. | None in scope of enqueue flow. |
| `/api/jobs/[jobId]/select-track` | `${API_BASE_URL}/jobs/:jobId/select-track` | `POST` | **Request**: `{ trackId, selection: { time_sec, frame_time_sec, bbox: { x,y,w,h }}}` (built in `selectJobTrack`). **Response**: upstream selection response. | Validates payload and returns `400` on JSON/shape errors. Uses proxy passthrough for upstream errors. | None in route itself; upstream errors should be surfaced (now logged + passthrough). |
| `/api/jobs/[jobId]/target` | `${API_BASE_URL}/jobs/:jobId/target` | `POST` | **Request**: `{ selections: [{ frame_time_sec, frame_key?, x,y,w,h }] }` (built in `saveJobTargetSelection`). **Response**: upstream target payload. | Returns `500` if `API_BASE_URL` missing. Uses proxy passthrough for upstream errors. | Target selections from backend were missing `frame_key` mapping → UI could not match frames reliably. |
| `/api/jobs/[jobId]/enqueue` | `${API_BASE_URL}/jobs/:jobId/enqueue` | `POST` | **Request**: JSON body `{}` always present. **Response**: upstream job payload. | Returns `500` if `API_BASE_URL` missing. Uses proxy passthrough for upstream errors. | Enqueue now always sends valid JSON + blocks until player_ref + target are persisted. |
| `/api/frame-proxy` | `url` query param (direct upstream URL) | `GET` | **Request**: `?url=<encoded>` **Response**: upstream bytes as `image/jpeg`. | `400` on missing/invalid URL. `502` on upstream failure or network error. | If upstream fails, error response is generic JSON (not used for enqueue, but may obscure upstream details). |

## Standard error JSON location

No code paths in this repo generate the exact `{ ok: false, error: { code: "HTTP_ERROR", message: "Request failed" } }` payload. The closest behavior was the generic proxy fallback in `app/api/proxy.ts`, which masked upstream error details when fetch failed. The proxy now logs upstream status/body and passes the upstream response through so the real error body is visible to the UI.

## Issues addressed

1. **Upstream error passthrough**: proxy now logs upstream status + body and returns the upstream response body unchanged, preserving status codes.
2. **Start analysis gating**: enqueue is now blocked unless `player_ref` is present and the target is confirmed (or at least persisted in selections).
3. **Frame mapping robustness**: target selections now preserve `frame_key` and time fields to avoid float mismatches when resolving frames (with warning when falling back to time tolerance).
4. **Result visibility**: completed jobs now render overall/role score + radar breakdown; missing results are surfaced as explicit errors.
