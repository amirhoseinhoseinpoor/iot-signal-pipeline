# 6. Anomaly detection at ingest time

- Status: accepted
- Date: 2026-11-18

## Context

Fleet operators care about two kinds of events:

- **Speeding**, which is a safety and liability issue.
- **Impossible position jumps**, which come from multipath reflections in cities,
  cold-start fixes, or spoofing. Left unflagged, they corrupt distance totals and
  route history.

## Decision

Detection is a pure function, `detectAnomalies`, that runs on every batch before
the batch is stored:

- **overspeed**: reported speed above `OVERSPEED_LIMIT_MPS` (default 33.3 m/s,
  which is 120 km/h). Consecutive readings over the limit form one episode, which
  produces one alert at its peak. A minute of speeding is one alert, not sixty.
- **gps_jump**: the speed implied by two consecutive fixes is above
  `MAX_IMPLIED_SPEED_MPS` (default 70 m/s). Moves under 25 m are treated as noise
  and ignored. Two different positions with the same timestamp count as a jump,
  with an unbounded (`null`) value.

Alerts are stored in an `alerts` collection with a unique index on
`(messageId, type, detectedAt)`. Alert writes also run for replays. If a crash
happened between storing a batch and storing its alerts, the redelivery fills in
the missing alerts, and the unique index keeps everything else from being
duplicated.

## Consequences

- Alerts appear within one batch of the event, with no separate stream-processing system.
- The logic is deterministic and unit-tested without a database.
- Detection only sees one batch at a time. A jump that spans the boundary between
  two batches is missed. Cross-batch rules, such as comparing against the
  device's previous last fix, or stale-device alerts, would need per-device state
  and are a natural next step. Device staleness is reported today as a `status`
  field on `/devices`.
