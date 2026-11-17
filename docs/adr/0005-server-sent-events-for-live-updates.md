# 5. Server-Sent Events for live updates

- Status: accepted
- Date: 2026-11-18

## Context

The fleet dashboard needs position updates and alerts as they happen. The traffic
is one way, from server to browser.

## Options

- **Polling** is simple, but it trades latency against load.
- **WebSocket** is bidirectional, but needs a socket library and connection
  management on both sides, and two-way messaging is not needed here.
- **Server-Sent Events (SSE)** is one-way over plain HTTP. Browsers reconnect
  automatically through `EventSource`, NestJS supports it natively with `@Sse()`,
  and proxies and load balancers handle it like any other HTTP response.

## Decision

`GET /api/v1/stream` is an SSE endpoint. It emits `position` and `alert` events,
plus a `ping` every 25 seconds so idle connections stay open behind proxies. An
optional `deviceId` query parameter narrows the stream to one device.

Ingestion publishes to an in-process `LiveEvents` bus only after a batch is stored:

- a `position` event only for a newly created batch, never for a replay
- an `alert` event only for an alert that is new, not one that already existed

## Consequences

- The design adds no new dependencies, and the dashboard is a single static page.
- Clients that disconnect miss events, and SSE does not replay them. On load, the
  dashboard fetches the current state from REST (`/devices`, `/alerts`) and then
  subscribes, so a reconnect costs at most a few seconds of trail.
- **Fan-out is per instance.** With several API replicas, each client only sees
  the batches that its own replica consumed. The fix, when it is needed, is to
  publish live events to a RabbitMQ fanout exchange and give each replica an
  exclusive queue on it. The `LiveEvents` interface stays the same.
