# Cloudflare Workers + Durable Objects

This deployment keeps the existing LAN/Node server untouched and builds the server edition with a Workers WebSocket transport. Each 5-digit room has its own SQLite-backed Durable Object; the small global Durable Object allocates room IDs and applies the 100-room and 10-creations/hour limits.

The Worker also limits API traffic to 120 requests/minute per IP, room creation to 5 requests/minute per IP, anonymous feedback to 5 submissions/minute per IP, and new WebSocket connections to 20/minute per IP. Each WebSocket connection is closed after 120 incoming messages in a minute. The room-creation Durable Object limit remains in place as the stricter hourly cap.

The lobby's anonymous feedback endpoint stores only the submitted message and timestamp, retaining the latest 100 submissions in the global Durable Object. It does not store the submitter's IP address or other account identifiers.

## Local preview

From the repository root, install the frontend dependencies if needed, then run:

```powershell
npm run cloudflare:dev
```

This builds the Cloudflare-only frontend and starts Wrangler's local simulator. Open the local address it prints, create a room, then open that room URL in another browser or device. The LAN build and its Socket.IO transport are unchanged.

## Deploy

Install Wrangler or use `npx wrangler@latest`, authenticate the Cloudflare account, then:

```powershell
npm run frontend:build:cloudflare
npx wrangler@latest deploy --config cloudflare/wrangler.jsonc
```

The first deploy creates the SQLite Durable Object classes through the `v1` migration. A `workers.dev` hostname is enabled. Custom domains can be attached from the Cloudflare dashboard after deployment.

## Notes

- WebSocket rooms use the Durable Object hibernation API. Important room state and up to 50 undo/redo states are persisted; socket connections can sleep and reconnect.
- Edge rate limits are approximate and scoped to a Cloudflare location; the per-WebSocket message cap runs inside each room Durable Object.
- The client sends one low-frequency liveness message per minute. Durable Object incoming WebSocket messages are billed at the documented 20-to-1 ratio; Cloudflare's free allocation remains finite, so monitor usage in the dashboard.
- Free-plan usage exhaustion causes requests to fail until quota reset. Paid usage follows Cloudflare's current Workers and Durable Objects pricing.
- Cloudflare does not host the existing Express/Socket.IO server directly in this branch. This target uses the compatible browser event names over native WebSockets.
