-- Abonelik (Polar) — Subscription + Usage düğümleri için kısıt/index.
CREATE CONSTRAINT subscription_subject_unique IF NOT EXISTS
  FOR (s:Subscription) REQUIRE (s.subjectType, s.subjectId) IS UNIQUE;

CREATE INDEX usage_subject_period IF NOT EXISTS
  FOR (u:Usage) ON (u.subjectId, u.periodKey);
