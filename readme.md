Design trade-offs (why I chose this)
Postgres as queue

Pros: durable, restart-safe, easy to query for dashboard/metrics

Cons: polling can load the DB; not ideal for very high throughput

Polling workers

Pros: simple and reliable for a prototype

Cons: higher latency than push-based queues; needs tuning (poll interval, indexes)

Redis for rate limiting

Pros: fast, clean sliding-window implementation

Cons: extra dependency; decide fail-open vs fail-closed if Redis is down