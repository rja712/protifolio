/* =========================================================
   InboxIntelligence portfolio — vanilla JS
   Real code snippets pulled verbatim from the repo.
   ========================================================= */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* =========================================================
   ARCH INSPECTOR — why over what
   ========================================================= */
const ARCH = {
  gmail: {
    title: "Gmail API",
    why: "Source of truth. OAuth keeps the user in control — only refresh tokens stored.",
    whyNot: { label: "Why not IMAP?", text: "IMAP needs a long-lived connection per mailbox. Gmail's push notifications scale to many mailboxes from a single subscriber." },
  },
  pubsub: {
    title: "GCP Pub/Sub",
    why: "Gmail's watch endpoint pushes mailbox-change events here. Decouples Google's delivery from my consumer's processing.",
    whyNot: { label: "Why not poll Gmail?", text: "Polling every mailbox burns quota and adds latency. Push gives near-real-time arrival without hitting the rate limit." },
  },
  ingester: {
    title: "Ingester",
    why: "Only service holding Gmail credentials. Everything else stays Gmail-agnostic — easier to add Outlook/IMAP later.",
    whyNot: { label: "Why one Gmail-aware service?", text: "Spreading OAuth + Gmail SDK across services would multiply the credential surface and make rotation painful." },
  },
  processor: {
    title: "Processor",
    why: "Four isolated stages — sanitize (jsoup pipeline) → normalize (LLM summary + importance/category) → embed (Bedrock Titan v2, 1024-d) → cluster (incremental cosine vs centroids). Each stage is a Rabbit queue with its own consumer pool (4–8 threads, prefetch 10) and its own DLQ. Slow stages can't back-pressure fast ones.",
    whyNot: { label: "Why not one big consumer?", text: "A single consumer doing all four stages means one Bedrock timeout blocks unrelated emails — and one poison message kills the whole pipeline instead of one stage's DLQ." },
  },
  taxonomy: {
    title: "Taxonomy Engine",
    why: "Cold-path orchestrator. Per-mailbox: (1) acquire Redis lock, (2) <code>@Transactional</code> DBSCAN over all embeddings — flushes and re-creates cluster rows atomically, (3) fetch the user's existing Gmail labels via the ingester, (4) embed those label names so clusters can be matched by cosine, (5) run reuse→merge→create per cluster, (6) batch-apply label changes back to Gmail (one event per Gmail label id with N message ids). 4-thread pool runs different mailboxes in parallel.",
    whyNot: { label: "Why not label during ingest?", text: "Labels emerge from cluster shape, which only stabilises with enough data. Inline labelling would either label too early or block ingest while DBSCAN runs." },
  },
  postgres: {
    title: "Postgres + pgvector",
    why: "Vector search and relational data in one place. A cluster's centroid and its emails come from a single SQL join.",
    whyNot: { label: "Why not Pinecone / Weaviate?", text: "Double-writes, eventual consistency, one more thing to operate. pgvector is fast enough here." },
  },
  redis: {
    title: "Redis",
    why: "Sub-ms distributed lock so two processor/taxonomy replicas don't run overlapping batch jobs on the same mailbox.",
    whyNot: { label: "Why not Postgres advisory locks?", text: "They work, but Redis decouples coordination from the transactional store and survives DB schema migrations." },
  },
  rabbit: {
    title: "RabbitMQ",
    why: "Topic exchange + 4 queues + DLX. Per-stage prefetch and backoff. Right tool for durable point-to-point handoff.",
    whyNot: { label: "Why not Kafka?", text: "No replay or long retention needed — Kafka would be heavier ops for no win." },
  },
  storage: {
    title: "Object storage",
    why: "Email bodies are blobs, not relational data. Storing them as files keeps Postgres rows small and the vector index hot.",
    whyNot: { label: "Why not Postgres TOAST?", text: "Bloats indexes and backups. Filesystem/S3 gives cheap, separately-scalable storage with no DB pressure." },
  },
  persistence: {
    title: "persistence-lib",
    why: "Shared JPA entities via a private Maven package. One source of truth for the schema across three services.",
    whyNot: { label: "Why not duplicate entities?", text: "Drift. Two services would inevitably define EmailContent differently and break each other." },
  },
};
const EDGES = {
  e1: { title: "Gmail ⇄ Ingester", why: "Gmail API calls wrapped in Resilience4j gmailRetry — 3 attempts, exponential backoff, only retries RetryableGmailApiException." },
  e2: { title: "Pub/Sub → Ingester", why: "Push delivery; payload is just { emailAddress, historyId }. Ingester pulls the delta from Gmail using historyId." },
  e3: { title: "Ingester → Processor", why: "First hop. Message carries only the row id — bodies live in object storage. Keeps queue messages small." },
  e4: { title: "Processor → Postgres", why: "Each stage writes its own column on email_enrichments. processed_status acts as a state machine for idempotency." },
  e5: { title: "Processor → Redis", why: "BatchClusteringLock — setIfAbsent with TTL. Second replica's acquire fails fast." },
  e6: { title: "Processor → RabbitMQ", why: "Each stage publishes to the next queue. Failures route to email-events.dlx after 3 retries." },
  e7: { title: "Processor → Taxonomy", why: "When incremental cosine match is below threshold, the email waits for the next batch run rather than being force-fit." },
  e8: { title: "Taxonomy → Ingester", why: "Taxonomy doesn't hold Gmail credentials. It calls back via REST so credential handling stays in one place." },
  e9: { title: "Taxonomy → Storage", why: "Read-mostly. Raw HTML + sanitized text are deleted after normalization; the taxonomy engine works from the normalized summary and the 1024-d embedding stored in Postgres, not the original blob." },
};

function renderInspector(d) {
  $("#inspector").innerHTML = `
    <h3>${d.title}</h3>
    <p>${d.why}</p>
    ${d.whyNot ? `<div class="why-not"><b>${d.whyNot.label}</b><br/>${d.whyNot.text}</div>` : ""}
  `;
}
function wireArch() {
  const select = (target, data) => {
    $$("#arch .active").forEach(x => x.classList.remove("active"));
    target.classList.add("active");
    renderInspector(data);
  };
  $$("#arch .node").forEach(n => n.addEventListener("click", () => select(n, ARCH[n.dataset.key])));
  $$("#arch .edge").forEach(e => e.addEventListener("click", () => select(e, EDGES[e.dataset.key])));
  $('#arch .node[data-key="processor"]').dispatchEvent(new Event("click"));
}

/* =========================================================
   DEMO — 3 real-looking emails through 5 lanes
   Each stage shows the REAL Java method that processes it.
   ========================================================= */
const DEMO_EMAILS = [
  { id: "m1", from: "newsletter@vercel.com", subj: "What's new in Vercel this week",    cluster: 1, sim: 0.91 },
  { id: "m2", from: "recruiter@bigtech.io",  subj: "Senior Backend role — quick chat?", cluster: 2, sim: 0.87 },
  { id: "m3", from: "noreply@medium.com",    subj: "Top stories for you this week",     cluster: 1, sim: 0.88 },
];
const CLUSTER_NAMES = {
  1: "Newsletters",
  2: "Recruiter Outreach",
};
const LANE_IDS = ["inbox", "sanitize", "normalize", "embed", "cluster"];

// Real code that runs at each lane — verbatim from the repo
const LANE_CODE = {
  inbox: {
    file: "ingester/.../GmailMessageProcessingService.java",
    code: `EmailContent emailContent = EmailContent.builder()
        .gmailMailboxId(mailboxId)
        .messageId(message.getId())
        .threadId(message.getThreadId())
        .subject(MimeContentUtil.getHeader(message, "Subject"))
        .fromAddress(MimeContentUtil.getHeader(message, "From"))
        .sentAt(messageDate)
        .processedStatus(EMAIL_RECEIVED)
        .build();

EmailContent savedEmail = emailContentService.save(emailContent);
rabbitTemplate.convertAndSend(
        queueProperties.exchange(),                  // "email-events"
        queueProperties.routingKey(),                // "email.sanitization"
        new EmailEvent(savedEmail.getId()));`,
  },
  sanitize: {
    file: "processor/.../HtmlToTextConverter.java",
    code: `Document document = Jsoup.parse(content);

document.select("script, style, head, meta, link").remove();
document.select("img[width=1], img[height=1]").remove();   // tracking pixels
document.select("img[src^=cid:]").remove();
document.select("[style*=display:none]").remove();
document.select("[style*=visibility:hidden]").remove();

return extractText(document);`,
  },
  normalize: {
    file: "processor/.../NormalizationPromptHelper.java",
    code: `// Reason-before-rate: model must write the justification BEFORE the rating.
// Cap each field at MAX_PROMPT_INPUT_CHARS (6000) so a hostile body
// can't blow the Bedrock prompt budget (MAX_PROMPT_CHARS = 24_000).
String userPrompt = "From: " + left(fromAddress, 6000) + "\\n"
                  + "Subject: " + left(subject, 6000) + "\\n"
                  + "Body: " + left(sanitizedBody, 6000);

String raw = provider.invokeLlm(SYSTEM_PROMPT, userPrompt);

// Defensive parsing: extract the JSON block even if the model adds prose.
Matcher m = JSON_BLOCK.matcher(raw.trim());
if (!m.find()) return null;

Map<String, Object> r = objectMapper.readValue(m.group(), MAP_TYPE);

// Unknown enum values fall back to LOW / PRIMARY — never throw.
Importance importance = requireNonNullElse(
        objectMapper.convertValue(r.get("importance"), Importance.class),
        Importance.LOW);
Category   category   = requireNonNullElse(
        objectMapper.convertValue(r.get("category"), Category.class),
        Category.PRIMARY);

return new NormalisedEmailResponse(
        left((String) r.get("summary"), 5000),
        importance,
        left((String) r.get("importance_reason"), 500),
        category,
        left((String) r.get("category_reason"), 500));`,
  },
  embed: {
    file: "processor/.../BedrockModelProvider.java",
    code: `@Override
@Retry(name = "aiRetry")
public float[] generateEmbedding(String text) {
    var props = modelProperties.bedrock().embedding();

    String input = text == null ? "" : text;
    if (input.length() > props.dimensions()) {
        int cutoff = input.lastIndexOf(' ', props.dimensions());
        input = input.substring(0, cutoff > 0 ? cutoff : props.dimensions());
    }

    URI url = buildModelUri(props.modelName(), "invoke");
    int dims = props.dimensions();           // 1024
    boolean normalize = props.normalize();   // true
    // → amazon.titan-embed-text-v2:0
    // → stored in email_enrichments.embedding (pgvector, HNSW)`,
  },
  cluster: {
    file: "processor/.../EmailClusteringService.java",
    code: `private Cluster findBestCluster(float[] embedding, List<Cluster> clusters) {
    Cluster best = null;
    double bestSimilarity = Double.NEGATIVE_INFINITY;

    for (Cluster cluster : clusters) {
        if (cluster.getCentroid() == null) continue;
        double similarity = cosineSimilarity(embedding, cluster.getCentroid());
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            best = cluster;
        }
    }
    return best;
}

// If similarity < minSimilarityThreshold → defer to batch DBSCAN.`,
  },
};

const LANE_META_FOR = (lane, email) => {
  switch (lane) {
    case "sanitize":  return "✓ HTML stripped";
    case "normalize": return "✓ chars normalized";
    case "embed":     return "✓ vec[1024]";
    case "cluster":   return `cluster ${email.cluster} · sim ${email.sim}`;
    default:          return `id=${email.id}`;
  }
};

function makeCard(email, lane) {
  const meta = LANE_META_FOR(lane, email);
  const node = el(`
    <div class="email-card c${email.cluster}">
      <div class="from"></div>
      <div class="subj"></div>
      <div class="meta"></div>
    </div>
  `);
  node.id = `card-${email.id}-${lane}`;
  node.querySelector(".from").textContent = email.from;
  node.querySelector(".subj").textContent = email.subj;
  node.querySelector(".meta").textContent = meta;
  return node;
}

function clearLanes() {
  LANE_IDS.forEach(id => { $(`#lane-${id}`).innerHTML = ""; });
  $("#finalClusters").innerHTML = "";
  $("#codeFile").textContent = "—";
  $("#codeBody").textContent = "Press “Run demo” to see the code that processes each email at every stage.";
}

function showStageCode(lane) {
  const entry = LANE_CODE[lane];
  if (!entry) return;
  $("#codeFile").textContent = entry.file;
  $("#codeBody").textContent = entry.code; // textContent = safe, no HTML injection
}

async function advanceEmail(email) {
  // Inbox lane
  $("#lane-inbox").appendChild(makeCard(email, "inbox"));
  showStageCode("inbox");
  $("#demoStatus").textContent = `${email.subj} → inbox`;
  await sleep(550);

  for (let i = 1; i < LANE_IDS.length; i++) {
    const prevLane = LANE_IDS[i - 1];
    const nextLane = LANE_IDS[i];

    const prevCard = $(`#card-${email.id}-${prevLane}`);
    if (prevCard) prevCard.classList.add("done");

    const newCard = makeCard(email, nextLane);
    newCard.classList.add("processing");
    $(`#lane-${nextLane}`).appendChild(newCard);

    showStageCode(nextLane);
    $("#demoStatus").textContent = `${email.subj} → ${nextLane}`;
    await sleep(650);
    newCard.classList.remove("processing");
  }
}

async function renderFinalClusters() {
  const grouped = {};
  DEMO_EMAILS.forEach(e => {
    grouped[e.cluster] = grouped[e.cluster] || [];
    grouped[e.cluster].push(e);
  });

  const container = $("#finalClusters");
  for (const [cid, emails] of Object.entries(grouped)) {
    const box = el(`
      <div class="cluster-box c${cid}">
        <span class="label-name">🏷 ${CLUSTER_NAMES[cid]}</span>
        <ul>${emails.map(e => `<li></li>`).join("")}</ul>
      </div>
    `);
    // Inject text safely
    const lis = box.querySelectorAll("li");
    emails.forEach((e, idx) => { lis[idx].textContent = e.subj; });
    container.appendChild(box);
    await sleep(50);
    box.classList.add("visible");
    await sleep(450);
  }
}

let demoRunning = false;

async function runDemo() {
  if (demoRunning) return;
  demoRunning = true;
  clearLanes();
  $("#playBtn").textContent = "Running…";

  for (const email of DEMO_EMAILS) {
    await advanceEmail(email);
    await sleep(180);
  }

  // Taxonomy step: switch code panel to DBSCAN
  $("#codeFile").textContent = "taxonomy-engine/.../BatchClusteringAlgorithmHelper.java";
  $("#codeBody").textContent =
`int[] clusterIndices = DBSCAN.fit(
        matrix,                              // float[N][1024]
        VectorUtils::cosineDistance,
        dbscanProperties.minPts(),           // 2
        dbscanProperties.radius()).y;        // 0.1

// Noise points re-attached to nearest cluster if cosine ≥ 0.55
// Cluster centroids saved → "cluster.centroid" (pgvector)`;
  $("#demoStatus").textContent = "Taxonomy: DBSCAN over all embeddings…";
  await sleep(1200);

  $("#codeFile").textContent = "taxonomy-engine/.../ClusterLabelingService.java";
  $("#codeBody").textContent =
`// 1. Send 8 most-representative samples + existing label pool to the LLM.
//    Model is biased toward suggesting an EXISTING name.
String suggestion = labelGenerationHelper.suggestLabel(samples, existingLabelNames);

// 2. Case-insensitive string match → REUSE existing label.
Label existing = existingLabelSet.stream()
    .filter(l -> suggestion.equalsIgnoreCase(l.getDisplayName())
              || suggestion.equalsIgnoreCase(l.getFullName()))
    .findFirst().orElse(null);
if (existing != null) { saveClusterLabelMap(mailbox, cluster, existing); return; }

// 3. Else embed the suggestion (Titan v2) and find nearest existing by cosine.
float[] embedding = modelProvider.generateEmbedding(suggestion);
Label nearest = findNearestLabel(labelPool, embedding); // bestSim seeded at MERGE_THRESHOLD = 0.80

if (nearest != null) {                  // MERGE into nearest existing label
    saveClusterLabelMap(mailbox, cluster, nearest);
} else {                                // CREATE new label with the embedding as reference
    Label created = labelService.save(Label.builder()
        .gmailMailboxId(mailbox.getId())
        .displayName(suggestion).fullName(suggestion)
        .referenceEmbedding(embedding).build());
    labelPool.add(created);             // pool grows monotonically across runs
    saveClusterLabelMap(mailbox, cluster, created);
}`;
  $("#demoStatus").textContent = "Taxonomy: LLM naming + cosine dedup…";
  await sleep(1200);

  await renderFinalClusters();

  $("#demoStatus").textContent = `✓ Done — ${DEMO_EMAILS.length} emails into ${Object.keys(CLUSTER_NAMES).length} labels`;
  $("#playBtn").textContent = "▶ Run again";
  demoRunning = false;
}

function resetDemo() {
  if (demoRunning) return;
  clearLanes();
  $("#demoStatus").textContent = "Idle";
  $("#playBtn").textContent = "▶ Run demo";
}

function wireDemo() {
  $("#playBtn").addEventListener("click", runDemo);
  $("#resetBtn").addEventListener("click", resetDemo);
}

/* =========================================================
   REAL CODE — tabs showing verbatim repo excerpts
   ========================================================= */
const REAL_CODE = [
  {
    id: "pubsub",
    title: "Pub/Sub listener · fault classification",
    path: "ingester/src/main/java/.../inbound/GmailPubSubSubscriber.java",
    why: "<b>Why interesting?</b> Three distinct outcomes from one entrypoint: (1) <b>unknown mailbox</b> → ack (don't redeliver forever); (2) <b>revoked OAuth token</b> (<code>invalid_grant</code> walked through the cause chain) → mark mailbox <code>DISCONNECTED</code> and ack; (3) <b>everything else</b> → nack and let Pub/Sub redeliver. Permanent and transient failures are routed to the right place — not one big catch-and-retry.",
    code:
`public void handleMessage(PubsubMessage message, AckReplyConsumer consumer) {
    GmailMailbox gmailMailbox = null;
    try {
        GmailEvent event = objectMapper.readValue(message.getData().toStringUtf8(), GmailEvent.class);
        Optional<GmailMailbox> mailboxOptional = gmailMailboxService.findByEmailAddress(event.emailAddress());

        if (mailboxOptional.isEmpty()) {
            log.warn("Mailbox not found for email {}", event.emailAddress());
            consumer.ack();                              // unknown mailbox — ack, no redelivery
            return;
        }

        gmailMailbox = mailboxOptional.get();
        gmailMessageSyncService.triggerSyncJob(gmailMailbox, event.historyId());
        consumer.ack();

    } catch (Exception e) {
        // Permanent failure: refresh token revoked. Don't let Pub/Sub redeliver this forever.
        if (gmailMailbox != null && hasInvalidGrant(e)) {
            log.error("Refresh token revoked for {}", gmailMailbox.getEmailAddress());
            gmailMailbox.setSyncStatus(DISCONNECTED);
            gmailMailbox.setLastSyncError("Refresh token revoked");
            gmailMailboxService.save(gmailMailbox);
            consumer.ack();
            return;
        }
        // Transient (network, 5xx, Redis blip) → nack → Pub/Sub redelivers with backoff.
        consumer.nack();
    }
}

// Walk the cause chain — wrapped exceptions hide the real reason at the top level.
private boolean hasInvalidGrant(Throwable t) {
    while (t != null) {
        if (t.getMessage() != null && t.getMessage().contains("invalid_grant")) return true;
        t = t.getCause();
    }
    return false;
}`,
  },
  {
    id: "sync-coalesce",
    title: "Per-mailbox sync coalescing",
    path: "ingester/src/main/java/.../message/GmailMessageSyncService.java",
    why: "<b>Why interesting?</b> Gmail Pub/Sub fires many events per mailbox in seconds. Naively syncing each one wastes API quota and races. This collapses them into one paginated sync per mailbox using a <code>ConcurrentHashMap&lt;email, ReentrantLock&gt;</code> + a <code>Math::max</code> watermark — later events see the lock is held and exit immediately, while the in-progress sync keeps catching up to the highest watermark it sees.",
    code:
`// One lock + one watermark per mailbox.
private final ConcurrentHashMap<String, ReentrantLock> mailboxLocks = new ConcurrentHashMap<>();
private final ConcurrentHashMap<String, Long>          mailboxMaxHistory = new ConcurrentHashMap<>();

public void triggerSyncJob(GmailMailbox mailbox, Long eventHistoryId) {
    String email = mailbox.getEmailAddress();

    // 1. Always advance the per-mailbox watermark — multiple in-flight events
    //    converge on the same target.
    mailboxMaxHistory.merge(email, eventHistoryId, Math::max);

    // 2. Stale event? Drop it.
    if (mailbox.getHistoryId() > eventHistoryId) {
        mailboxMaxHistory.remove(email);
        return;
    }

    // 3. Only the first event acquires the lock. Others log "already running" and exit.
    ReentrantLock lock = mailboxLocks.computeIfAbsent(email, k -> new ReentrantLock());
    if (!lock.tryLock()) { log.info("Sync already running for {}", email); return; }

    try { runSyncLoop(mailbox); } finally { lock.unlock(); }
}

// Bounded catch-up: even pathological bursts can't loop forever.
private static final int MAX_SYNC_ITERATIONS = 50;

private void runSyncLoop(GmailMailbox mailbox) throws IOException {
    for (int i = 0; i < MAX_SYNC_ITERATIONS; i++) {
        long lastSynced  = mailbox.getHistoryId();
        long latestEvent = mailboxMaxHistory.getOrDefault(mailbox.getEmailAddress(), lastSynced);
        if (lastSynced >= latestEvent) return;       // caught up
        syncGmailMailbox(mailbox);                   // paginated Gmail history.list
    }
}`,
  },
  {
    id: "publish",
    title: "Pipeline entry point",
    path: "ingester/src/main/java/.../outbound/EmailEventPublisher.java",
    why: "<b>Why interesting?</b> The status flip (<code>PUBLISHED_FOR_SANITIZATION</code>) happens after the publish — so even if the DB write fails, the message is in flight and idempotent.",
    code:
`public void publishEmailProcessed(EmailContent emailContent) {
    EmailEvent event = new EmailEvent(emailContent.getId());

    rabbitTemplate.convertAndSend(
            queueProperties.exchange(),       // "email-events"
            queueProperties.routingKey(),     // "email.sanitization"
            event);

    emailContent.setProcessedStatus(PUBLISHED_FOR_SANITIZATION);
    emailContentService.save(emailContent);
}`,
  },
  {
    id: "retry",
    title: "Gmail retry policy",
    path: "ingester/src/main/resources/application.yaml",
    why: "<b>Why interesting?</b> Retries only on a <i>custom</i> exception — so genuine 4xx errors (malformed request, revoked token) fail fast instead of burning the budget.",
    code:
`resilience4j:
  retry:
    instances:
      gmailRetry:
        max-attempts: 3
        wait-duration: 1s
        enable-exponential-backoff: true
        exponential-backoff-multiplier: 2
        randomized-wait-factor: 0.5
        retry-exceptions:
          - com.inboxintelligence.ingester.exception.RetryableGmailApiException`,
  },
  {
    id: "rabbit",
    title: "RabbitMQ topology",
    path: "processor/src/main/java/.../config/RabbitMQConfig.java",
    why: "<b>Why interesting?</b> Every stage queue is built with DLX arguments at declaration time — so a poison message routes itself to a stage-specific DLQ. No coupling between consumer logic and failure handling.",
    code:
`@Bean
public TopicExchange emailEventExchange() {
    return new TopicExchange(properties.exchange());      // "email-events"
}

@Bean public TopicExchange deadLetterExchange() {
    return new TopicExchange(dlxName());                  // "email-events.dlx"
}

private Queue buildQueue(String queueName, String routingKey) {
    return QueueBuilder.durable(queueName)
            .withArgument("x-dead-letter-exchange", dlxName())
            .withArgument("x-dead-letter-routing-key", routingKey + ".dlq")
            .build();
}

private Binding bindToExchange(Queue q, TopicExchange ex, String routingKey) {
    return BindingBuilder.bind(q).to(ex).with(routingKey);
}

// 4 queues built this way: sanitization · normalization · embedding · clustering
// Each gets a matching ".dlq" sibling.`,
  },
  {
    id: "embed",
    title: "Bedrock embedding call",
    path: "processor/src/main/java/.../model/factory/BedrockModelProvider.java",
    why: "<b>Why interesting?</b> Annotated with <code>@Retry(name = \"aiRetry\")</code> so transient Bedrock 5xx errors retry transparently. Truncation respects word boundaries, not byte cutoffs.",
    code:
`@Override
@Retry(name = "aiRetry")
public float[] generateEmbedding(String text) {
    var props = modelProperties.bedrock().embedding();

    String input = text == null ? "" : text;
    if (input.length() > props.dimensions()) {
        int cutoff = input.lastIndexOf(' ', props.dimensions());
        cutoff = cutoff > 0 ? cutoff : props.dimensions();
        input = input.substring(0, cutoff);
    }

    String modelId = props.modelName();          // amazon.titan-embed-text-v2:0
    URI url = buildModelUri(modelId, "invoke");
    int dims = props.dimensions();               // 1024
    boolean normalize = props.normalize();       // true
    // ... HTTP call to Bedrock runtime ...
}`,
  },
  {
    id: "dbscan",
    title: "DBSCAN batch clustering",
    path: "taxonomy-engine/src/main/java/.../clustering/BatchClusteringAlgorithmHelper.java",
    why: "<b>Why interesting?</b> Cosine distance is passed as a method reference — Smile's DBSCAN takes any <code>Distance&lt;T&gt;</code>. Noise points get re-attached to the nearest cluster instead of being silently dropped.",
    code:
`public Map<Integer, ClusterResult> invokeAlgorithm(
        Long mailboxId, List<EmailEmbeddingDTO> dtos) {

    float[][] matrix = dtos.stream()
            .map(EmailEmbeddingDTO::embedding)
            .toArray(float[][]::new);

    int[] clusterIndices = DBSCAN.fit(
            matrix,
            VectorUtils::cosineDistance,
            dbscanProperties.minPts(),     // 2
            dbscanProperties.radius()).y;  // 0.1 (cosine distance threshold)

    Map<Integer, ClusterResult> clusterMap = new HashMap<>();
    List<EmailEmbeddingDTO> noisePoints = new ArrayList<>();

    for (int i = 0; i < clusterIndices.length; i++) {
        if (clusterIndices[i] == NOISE_LABEL) {
            noisePoints.add(dtos.get(i));
            continue;
        }
        clusterMap
            .computeIfAbsent(clusterIndices[i], ClusterResult::new)
            .getMembers().add(dtos.get(i));
    }

    return assignNoiseToNearestCluster(clusterMap, noisePoints);
}`,
  },
  {
    id: "dedup",
    title: "Label dedup: reuse → merge → create",
    path: "taxonomy-engine/src/main/java/.../labeling/ClusterLabelingService.java",
    why: "<b>Why interesting?</b> The LLM is shown the existing label pool and biased toward suggesting an existing name. Then a three-stage decision keeps the user's Gmail sidebar from growing forever: <b>(1)</b> case-insensitive string match → reuse, <b>(2)</b> embed the suggestion and find nearest existing label by cosine — if ≥ <code>MERGE_THRESHOLD = 0.80</code>, merge, <b>(3)</b> else create a new label with the embedding as its <code>reference_embedding</code>. The pool grows monotonically across runs.",
    code:
`private static final int    MAX_EMAILS_PER_CLUSTER_PROMPT = 8;
private static final double MERGE_THRESHOLD = 0.80;

// 1. Pick the 8 emails closest to the centroid as prompt samples.
List<String> samples = emailEnrichmentService.findByClusterId(cluster.getId()).stream()
    .filter(e -> e.getEmbedding() != null)
    .filter(e -> StringUtils.hasText(e.getNormalizedContent()))
    .sorted(comparingDouble((EmailEnrichment e) ->
        VectorUtils.cosineSimilarity(cluster.getCentroid(), e.getEmbedding())).reversed())
    .limit(MAX_EMAILS_PER_CLUSTER_PROMPT)
    .map(EmailEnrichment::getNormalizedContent).toList();

// 2. LLM suggests a label (sees the existing pool).
String suggestion = labelGenerationHelper.suggestLabel(samples, existingLabelNames);

// 3. String match? REUSE.
Label existing = existingLabelSet.stream()
    .filter(l -> suggestion.equalsIgnoreCase(l.getDisplayName())
              || suggestion.equalsIgnoreCase(l.getFullName()))
    .findFirst().orElse(null);
if (existing != null) { saveClusterLabelMap(mailbox, cluster, existing); return; }

// 4. Else embed the suggestion; if nearest existing has cosine ≥ 0.80 → MERGE; else CREATE.
float[] embedding = modelProviderFactory.getEmbeddingProvider().generateEmbedding(suggestion);
Label nearest = findNearestLabel(labelPool, embedding); // seeded at MERGE_THRESHOLD
if (nearest != null) {
    saveClusterLabelMap(mailbox, cluster, nearest);
} else {
    Label created = labelService.save(Label.builder()
        .gmailMailboxId(mailbox.getId())
        .displayName(suggestion).fullName(suggestion)
        .referenceEmbedding(embedding).build());
    labelPool.add(created);
    saveClusterLabelMap(mailbox, cluster, created);
}`,
  },
  {
    id: "prompt",
    title: "LLM normalization prompt",
    path: "processor/src/main/java/.../normalization/NormalizationPromptHelper.java",
    why: "<b>Why interesting?</b> Reason-before-rate ordering: the model must write <code>importance_reason</code> before <code>importance</code> — so the rating is justified, not picked first and rationalized after.",
    code:
`private static final String SYSTEM_PROMPT = """
## Task
Analyse the email and output ONE JSON object. DO NOT add any preamble,
commentary, or markdown fences.

## Output Schema
(Write the reasons FIRST so you justify the rating before assigning it.)
{
  "summary": string,
  "importance_reason": string,
  "importance": "LOW" | "MEDIUM" | "HIGH",
  "category_reason": string,
  "category": "PRIMARY" | "SOCIAL" | "PROMOTIONS" | "UPDATES" | "FORUMS"
}

## Importance Rules — default is LOW
The user has already received the email. Do NOT invent urgency from
words like "verify", "alert", "action", "confirm". Pick the LOWEST
level whose criteria are met.

## Override Rules (these beat every other rule above)
- ALL bank transaction alerts → LOW UPDATES. No exceptions.
- ALL bank/credit-card statements → LOW UPDATES.
- ALL OTPs and verification codes → LOW UPDATES.
""";`,
  },
  {
    id: "entity",
    title: "pgvector JPA mapping",
    path: "persistence-lib/src/main/java/.../entity/EmailEnrichment.java",
    why: "<b>Why interesting?</b> Hibernate 6.5 maps a Java <code>float[]</code> directly to pgvector via <code>@JdbcTypeCode(SqlTypes.VECTOR)</code> + <code>@Array(length = 1024)</code> — no custom converter, no dialect hack.",
    code:
`@JdbcTypeCode(SqlTypes.VECTOR)
@Array(length = 1024)
@Column(name = "embedding")
private float[] embedding;`,
  },
  {
    id: "ddl",
    title: "pgvector HNSW index",
    path: "db-migrations/src/main/resources/db/migration/V1.005__create_email_enrichment.sql",
    why: "<b>Why interesting?</b> HNSW + <code>vector_cosine_ops</code> means top-K cluster-centroid search is sub-10ms even on hundreds of thousands of rows. <code>WHERE embedding IS NOT NULL</code> keeps the index lean during the gap between insert and embed.",
    code:
`embedding vector(1024),

-- later in the same migration:

CREATE INDEX idx_email_enrichments_embedding
ON email_enrichments
USING hnsw (embedding vector_cosine_ops)
WHERE embedding IS NOT NULL;`,
  },
  {
    id: "lock",
    title: "Redis distributed lock",
    path: "taxonomy-engine/src/main/java/.../clustering/BatchClusteringLock.java",
    why: "<b>Why interesting?</b> <code>setIfAbsent</code> with a TTL is the entire lock. If the holder crashes, the TTL releases it automatically — no orphaned locks.",
    code:
`public boolean acquire(Long mailboxId) {
    String key = mailboxKey(mailboxId);
    Boolean acquired = redisTemplate
            .opsForValue()
            .setIfAbsent(key, "true", LOCK_TTL);
    boolean result = Boolean.TRUE.equals(acquired);

    if (result) log.debug("acquired lock [{}] ttl={}", key, LOCK_TTL);
    else        log.warn("lock [{}] already held — rejecting", key);

    return result;
}

public void release(Long mailboxId) {
    redisTemplate.delete(mailboxKey(mailboxId));
}`,
  },
  {
    id: "storage",
    title: "Storage abstraction",
    path: "persistence-lib/src/main/java/.../storage/EmailStorageProvider.java",
    why: "<b>Why interesting?</b> One interface, two implementations (Local for dev, S3 for prod). The rest of the codebase never sees a filesystem path or an S3 URI — only a <code>storagePath</code> string.",
    code:
`public interface EmailStorageProvider {

    String readContent(String storagePath);

    String writeContent(String email, String messageId,
                        String fileName, String content);

    String writeBytes(String email, String messageId,
                      String folder, String fileName, byte[] data);

    void deleteContent(String storagePath);

    String providerName();
}`,
  },
];

function renderRealCode() {
  const tabs = $("#codeTabs");
  REAL_CODE.forEach((c, i) => {
    const btn = el(`<button class="code-tab" data-id="${c.id}">${c.title}</button>`);
    if (i === 0) btn.classList.add("active");
    btn.addEventListener("click", () => {
      $$(".code-tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      showRealCode(c.id);
    });
    tabs.appendChild(btn);
  });
  showRealCode(REAL_CODE[0].id);
}

function showRealCode(id) {
  const c = REAL_CODE.find(x => x.id === id);
  if (!c) return;
  const node = el(`
    <div>
      <div class="meta">
        <span class="title"></span>
        <span class="path"></span>
      </div>
      <div class="why"></div>
      <pre><code></code></pre>
    </div>
  `);
  node.querySelector(".title").textContent = c.title;
  node.querySelector(".path").textContent = c.path;
  node.querySelector(".why").innerHTML = c.why;     // trusted hand-written content
  node.querySelector("code").textContent = c.code;  // textContent = no XSS
  const show = $("#codeShow");
  show.innerHTML = "";
  show.appendChild(node);
}

/* =========================================================
   THEME TOGGLE — persisted in localStorage, default dark
   ========================================================= */
function wireTheme() {
  const root = document.documentElement;
  const btn  = document.querySelector(".theme-toggle");
  const apply = (t) => {
    root.setAttribute("data-theme", t);
    if (btn) btn.setAttribute("aria-pressed", t === "light");
  };
  apply(localStorage.getItem("ii-theme") || "dark");
  btn?.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    apply(next);
    localStorage.setItem("ii-theme", next);
  });
}

/* =========================================================
   BOOT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  wireTheme();
  wireArch();
  wireDemo();
  renderRealCode();
});
