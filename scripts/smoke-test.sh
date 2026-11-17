#!/usr/bin/env bash
# End-to-end check of a running `docker compose` stack: telemetry arrives over
# both AMQP and MQTT, anomalies become alerts, and nothing is dead-lettered.
set -euo pipefail

API="${API:-http://localhost:3000}"
RABBIT="${RABBIT:-http://localhost:15672}"
RABBIT_AUTH="${RABBITMQ_USER:-wayline}:${RABBITMQ_PASSWORD:-wayline}"
EXPECTED_DEVICES="${DEVICE_COUNT:-4}"
TIMEOUT_S="${TIMEOUT_S:-120}"

wait_for() {
  local description="$1" check="$2" deadline=$((SECONDS + TIMEOUT_S))
  until eval "$check"; do
    if ((SECONDS > deadline)); then
      echo "FAIL: timed out waiting for: $description" >&2
      return 1
    fi
    sleep 3
  done
  echo "ok: $description"
}

wait_for "API ready" "curl -fsS $API/health/ready > /dev/null"

wait_for "$EXPECTED_DEVICES devices online (AMQP and MQTT)" \
  "[ \"\$(curl -fsS $API/api/v1/devices | jq '[.[] | select(.status == \"online\")] | length')\" -ge $EXPECTED_DEVICES ]"

# In mixed mode odd-numbered vehicles publish over MQTT; make sure one of them arrived.
wait_for "an MQTT vehicle (vehicle-002) reported" \
  "curl -fsS $API/api/v1/devices | jq -e 'any(.[]; .deviceId == \"vehicle-002\")' > /dev/null"

wait_for "at least one alert raised" \
  "[ \"\$(curl -fsS '$API/api/v1/alerts?limit=1' | jq '.total')\" -ge 1 ]"

dlq=$(curl -fsS -u "$RABBIT_AUTH" "$RABBIT/api/queues/%2F/telemetry.ingest.dlq" | jq '.messages // 0')
if [ "$dlq" -ne 0 ]; then
  echo "FAIL: $dlq message(s) in the dead-letter queue" >&2
  exit 1
fi
echo "ok: dead-letter queue is empty"

curl -fsS -o /dev/null "$API/" && echo "ok: dashboard served"
echo "Smoke test passed."
