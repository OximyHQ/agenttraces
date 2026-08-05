# ADR 0001: Cloud becomes canonical after durable acknowledgement

Accepted. Capture begins with an anonymous device identity. The machine retains encrypted pending batches, cursors, receipts, and a small cache. A configured cloud backend becomes canonical only after it returns a durable, idempotent receipt. This permits offline work and claim-later installation without pretending that an unavailable endpoint received data.
