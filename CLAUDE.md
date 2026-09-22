# CLAUDE.md — rja712.click portfolio

Static site. `index.html` + `styles.css` + `script.js`, plus `systems.html` (the architecture
write-up) and the `inbox-intelligence.*` project page.

`systems.html` carries sanitised versions of the two architecture diagrams. Vendor names and
company internals are deliberately left out of it. Keep it that way. The diagrams are inline
SVG that theme themselves from the CSS custom properties, so never hardcode a colour in them. Push to `main` runs a GitHub Action that syncs the repo to the S3 bucket
`rja712.click` and invalidates CloudFront. So a merge to main is a deploy.

---

## The one rule

**This site must not say anything the resume does not say.** A recruiter reads both. If a
number here is different from the number there, the whole thing stops being believable. The
resume was audited line by line in Sept 2026 and is frozen. This file carries the result of
that audit. When the two disagree, the resume wins.

---

## How to write here

- Simple, plain English. Short sentences. Ankit's first language is not English and he does
  not want the site to read like it was written by an AI.
- **Never use an em dash.** Use a comma, a full stop, or a middle dot.
- Never claim a decision Ankit did not make, or a system he did not build.
- If a claim cannot be defended in a technical interview for ten minutes, it does not belong
  on the site.
- No invented numbers. A smaller made-up number is still made up.

---

## Numbers that are allowed

Only these. They are measured or defensible. Everything else must be removed, not softened.

| Number | Where | What it actually is |
|---|---|---|
| 10K+ events/sec | Jaggaer, event data sync | Micrometer counter at inbound, summed across queues, at peak business hours. A rate over the scrape window, not a raw count |
| 100+ migrated tenants | Jaggaer | out of 1000+ tenants in the org |
| 30+ per month down to 2-3 per month | Jaggaer | production incidents. Say the raw numbers, never a percentage |
| 10K+ notifications/sec | LeadSquared, notification service | peak ingestion |
| 1000+ emails/sec | LeadSquared, email communication | peak, on large payloads |
| 100GB/day | HighRadius, SFTP clearance pipeline | measured from SFTP file sizes |
| 1000+ internal users | HighRadius, internal product | users, NOT daily active users |
| under 100 to 1500+ consultants | HighRadius | the team growth that created the need for that product |

---

## Claims that must NOT appear (audited and rejected)

**Jaggaer**
- "~99% reduction in incidents". Wrong. It is 30+/month to 2-3/month, stated as raw numbers.
- "2,000+ events/sec". Wrong number. It is 10K+.
- "ExecutorService + RabbitMQ" for the sync pipeline. ExecutorService was HighRadius, not here.
- "Designed for idempotency and ordering". Ordering does not matter in this pipeline, and the
  consuming modules do the dedupe, not the pipeline.
- "Built a shared resilience library adopted across microservices". Resilience4j was mandated
  by the org. He used it, he did not build a shared library.
- "Backpressure handling and fallback mechanisms". Never built.
- "1,000+ RPS" on the admin console. Never measured.
- "cross-platform". Catelyze is the platform. The things it connects are modules. Say
  cross-module.

**LeadSquared**
- "Protected email IP reputation / quarantined abusive accounts". Ankit cannot defend this.
  Dropped on purpose.
- "10K+ emails/day" and "50K+ notifications/day". Both wrong and both inconsistent with the
  resume, which states peaks per second.
- "Automated retry using EventBridge, SNS and SQS". There is no retry inside the service. A
  failed process waits for an admin replay API. EventBridge belongs to reminders and SLA,
  which were another team's.
- "Redis caching" for drafts or deliverability. The Redis-cached drafts claim was false.
- "Bucket4j". Not verified. The real rate limit is 10 per minute per FROM address.
- "Usage-based pricing from client usage tracking". Not verified.
- Anything claiming ownership of the SLA module. Another team owned it.

**HighRadius**
- "Reduced payment failures by 10-12%". Never measured.
- "1B+ records/year" and "1M+ records/year". Never measured. Use 100GB/day.
- "Concurrent rule engine". Ankit asked for this to be dropped.
- "1,000+ DAU". They were users, not daily active users.
- "Improved bandwidth utilisation by 10% and implementation speed by 5%". Never measured.
  Ankit explicitly refused to publish a guessed figure. Do not put any percentage here.

**Skills list in the hero**
- Remove **Python**. He has not written Python professionally.
- Remove **OpenTelemetry**. He read Grafana dashboards and added Micrometer counters. He did
  not set up tracing.
- **Clustering** is fine, it is backed by the DBSCAN work on the Inbox Intelligence project.
- Keep pgVector only as a side-project skill. At LeadSquared the embedding store sat inside
  another team's Python wrapper.

---

## What is actually true, and worth saying

**Jaggaer, Catelyze (Aug 2025 to now).** Jaggaer grew by acquiring companies. Each product
arrived with its own platform layer, and the products were wired to each other pair by pair
with inconsistent contracts. Catelyze is the platform that replaces that, and the modules now
talk to Catelyze instead of to each other. Ankit owns three things: an event-driven data sync
service over RabbitMQ, the configuration console, and several per-vendor third-party
integration services.

The good details:
- Inbound is one fanout exchange with exactly one queue bound, so that side is a plain work
  queue. Outbound is one exchange per business object with routing keys from tenant config,
  and the queues and bindings are declared as beans at application startup, which means adding
  a new business object is a config change and not an infrastructure ticket.
- Supplier offboarding is a real fanout, because every module has to know.
- The pipeline is purely technical. It holds no business keys. The modules dedupe on business
  ids, because the business meaning belongs to them.
- Persist or publish before you ack. At-least-once with redelivery on nack.
- The policy he set: business objects shared across modules move asynchronously through the
  pipeline, and latency-sensitive data stays on synchronous APIs.
- His design document is the team's reference for onboarding new business objects.

**LeadSquared, Service CRM (Mar 2023 to Jul 2025).** The communication side of a ticketing and
helpdesk product.
- Notification service, built end to end. Every other module publishes into it over Redis
  Streams. Templates resolved through per-channel factories, dispatched to the channel service
  by configuration. Email, SMS and WhatsApp.
- Email processing. Attaches inbound mail to the right ticket, applies reopen rules, thread
  level vendor affinity, and a two-tier AI layer on AWS Bedrock: a cheap classification pass
  on every inbound mail, and user-triggered RAG with embedding search over the tenant's own
  documents and past resolved cases. Suggestions are shown and then gone, nothing is stored.
- Email communication. SendGrid, SES and Gmail, three completely different ingestion
  mechanisms, normalised into one internal model. Persists to the database and the raw mail to
  S3 before acknowledging the vendor. Dedupes on the email Message-ID. Two spam layers on
  purpose: the vendor's own technical score first, then an AI content pass for what got
  through. There is a DB and S3 dual write that was never solved, and he says so.
- Documented the team's trunk-based development and release process.

**HighRadius (May 2019 to Feb 2023). Product Analyst, then Software Engineer.**
- Cash reconciliation. Payment and remittance file parsers on a scheduled SFTP clearance
  pipeline, parsed in parallel on an ExecutorService pool, reconciled into settled invoices.
- Invoice presentment. Replaced the legacy SOAP/RPC integration with REST, and fixed Level 3
  card payments that were silently downgrading to Level 2.
- Product ownership. Owned an internal delivery-tracking product from problem to MVP after the
  implementation team grew from under a hundred to over fifteen hundred. Replaced spreadsheet
  tracking. This is his legacy and he wants it kept, but kept small.

---

## Things he is happy to admit on the site

These make him look more senior, not less. Do not hide them.
- The DB and S3 dual write at LeadSquared that was not solved.
- The single inbound queue at Jaggaer has no isolation between modules.
- Webhook endpoints for the vendor integrations sit behind a web filter only.
- He did not set up the observability stack, he used it and added counters to it.
- Deployment at Jaggaer is not something he has been close to. Kubernetes and Argo CD belong
  to the LeadSquared years.
