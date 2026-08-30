-- 029 — SMS as an outbox channel
--
-- One-time codes sent by SMS go through the same outbox as email: queued, then
-- drained by the worker with the same retry and abandonment rules. Sending
-- inline would mean somebody asking for a login code waits on a gateway that
-- may be slow or down, and a provider outage would look like the login flow
-- being broken rather than the message being late.
--
-- Widening the enum only adds a value; every existing row keeps its channel.

ALTER TABLE outbox
  MODIFY COLUMN channel ENUM('email','push','sms') NOT NULL;
