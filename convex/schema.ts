import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The manager product's data model (PRD.md "Data model", docs/BUILD-CONTRACT.md).
// Convex has no RLS: every public function asserts membership via `requireRole`
// in convex/lib/access.ts. `connector_credentials` is only touched by internal functions.

/** Embedding width for every vector index. Mubit `text-embedding-3-large` is requested with
 * `dimensions: 1536`; the offline hashed stand-in produces the same width. */
export const EMBEDDING_DIMS = 1536;

export const role = v.union(v.literal("owner"), v.literal("manager"), v.literal("hire"));

export const spaceStatus = v.union(v.literal("created"), v.literal("scanning"), v.literal("ready"), v.literal("error"));

export const stageName = v.union(
  v.literal("crawl"),
  v.literal("extract_design"),
  v.literal("analyse"),
  v.literal("seed_brain"),
  v.literal("generate_courses"),
  v.literal("sync_connector"),
  v.literal("cascade"),
  v.literal("deploy"),
  v.literal("ready"),
);

export const jobStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("stalled"),
);

export const level = v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error"));

export const connectorType = v.union(
  v.literal("github"),
  v.literal("slack"),
  v.literal("notion"),
  v.literal("jira"),
  v.literal("linear"),
  v.literal("drive"),
  v.literal("webapp"),
  v.literal("files"),
  v.literal("website"),
);

export const connectorStatus = v.union(
  v.literal("pending"),
  v.literal("authing"),
  v.literal("syncing"),
  v.literal("ready"),
  v.literal("error"),
  v.literal("stale"),
);

export const sourceKind = v.union(
  v.literal("page"),
  v.literal("file"),
  v.literal("doc"),
  v.literal("message"),
  v.literal("issue"),
  v.literal("pr"),
  v.literal("asset"),
  v.literal("screenshot"),
);

export const entityType = v.union(
  v.literal("person"),
  v.literal("tool"),
  v.literal("term"),
  v.literal("ritual"),
  v.literal("policy"),
  v.literal("product"),
  v.literal("org_unit"),
  v.literal("doc"),
);

export const relation = v.union(
  v.literal("owns"),
  v.literal("uses"),
  v.literal("mentions"),
  v.literal("related_to"),
  v.literal("depends_on"),
);

export const factCategory = v.union(
  v.literal("Glossary"),
  v.literal("People"),
  v.literal("Tools"),
  v.literal("Rituals"),
  v.literal("Docs & History"),
  v.literal("Policy"),
  v.literal("Product"),
  v.literal("Other"),
);

export const factStatus = v.union(v.literal("draft"), v.literal("approved"), v.literal("rejected"), v.literal("stale"));

export const courseStatus = v.union(v.literal("draft"), v.literal("published"), v.literal("stale"), v.literal("archived"));

export const brandField = v.union(v.literal("primary"), v.literal("accent"), v.literal("radius"), v.literal("headline"));

export const fontSpec = v.object({ family: v.string(), weight: v.optional(v.string()), fallback: v.optional(v.string()) });

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.id("users"),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  spaces: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    slug: v.string(),
    host: v.string(),
    status: spaceStatus,
    brandProfileId: v.optional(v.id("brand_profiles")),
    publishedAt: v.optional(v.number()),
    /** Facts at or above this confidence enter the brain approved (PRD open question 6). */
    autoApproveThreshold: v.number(),
    /** "live" when real providers ran, "offline" when stand-ins did — shown as a badge. */
    mode: v.optional(v.union(v.literal("live"), v.literal("offline"))),
    /** Generate → deploy (per-company onboarding app). `deployUrl` is absolute for a Vercel
     * deployment, or the app-relative `/o/<slug>` path for the labelled stand-in. */
    deployUrl: v.optional(v.string()),
    deployMode: v.optional(v.union(v.literal("vercel"), v.literal("stand-in"))),
    deployState: v.optional(v.union(v.literal("building"), v.literal("ready"), v.literal("error"))),
    deployedAt: v.optional(v.number()),
    deployProjectId: v.optional(v.string()),
    deployError: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerId"]),

  space_members: defineTable({
    spaceId: v.id("spaces"),
    userId: v.id("users"),
    role,
  })
    .index("by_space", ["spaceId"])
    .index("by_user", ["userId"])
    .index("by_space_user", ["spaceId", "userId"]),

  hire_invites: defineTable({
    spaceId: v.id("spaces"),
    email: v.string(),
    token: v.string(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_space", ["spaceId"])
    .index("by_token", ["token"]),

  // ---- scan pipeline ----------------------------------------------------------------------

  scans: defineTable({
    spaceId: v.id("spaces"),
    url: v.string(),
    status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed")),
    progress: v.number(),
    pageCount: v.number(),
    error: v.optional(v.string()),
    /** Analyse output: validated findings citing crawled URLs (F6). */
    findings: v.optional(v.any()),
    /** What this crawl changed vs the stored pages (content hashes). Re-scans with nothing new
     * reuse the previous analysis/brand instead of calling the model again. */
    changes: v.optional(
      v.object({ added: v.number(), changed: v.number(), unchanged: v.number(), removed: v.number(), home: v.optional(v.string()) }),
    ),
  }).index("by_space", ["spaceId"]),

  crawl_pages: defineTable({
    scanId: v.id("scans"),
    spaceId: v.id("spaces"),
    url: v.string(),
    title: v.optional(v.string()),
    text: v.string(),
    contentHash: v.string(),
    artifactRef: v.optional(v.id("_storage")),
    screenshotRef: v.optional(v.id("_storage")),
    fetchedAt: v.number(),
  })
    .index("by_scan", ["scanId"])
    .index("by_scan_url", ["scanId", "url"])
    .index("by_space_url", ["spaceId", "url"]),

  brand_profiles: defineTable({
    spaceId: v.id("spaces"),
    scanId: v.optional(v.id("scans")),
    tokensVersion: v.number(),
    palette: v.array(
      v.object({
        name: v.string(),
        hex: v.string(),
        role: v.union(v.literal("primary"), v.literal("accent"), v.literal("surface"), v.literal("text")),
      }),
    ),
    typography: v.object({ heading: fontSpec, body: fontSpec, notes: v.string() }),
    logoRefs: v.array(
      v.object({
        kind: v.union(v.literal("mark"), v.literal("wordmark"), v.literal("favicon")),
        url: v.string(),
        format: v.string(),
        /** Ink of the logo (src/lib/brand/themes.ts svgLogoTone); decides whether it needs a chip. */
        tone: v.optional(v.union(v.literal("light"), v.literal("dark"))),
      }),
    ),
    voice: v.string(),
    radius: v.optional(v.string()),
    /** "partial" when dembrandt could not run and the HTML/CSS fallback produced the tokens. */
    quality: v.optional(v.union(v.literal("full"), v.literal("partial"), v.literal("offline"))),
    /** Every candidate value extract_design saw, with where it was found and usage counts
     * (`BrandCandidates` in src/lib/brand/candidates.ts). The final tokens are picked from these. */
    candidates: v.optional(v.any()),
    /** Scan-time learned recommendation (src/lib/brand/types.ts StoredRecommendation, D-27). */
    recommendation: v.optional(v.any()),
    /** Theme options built from the extracted identity (src/lib/brand/themes.ts Theme[], D-34). */
    themes: v.optional(v.any()),
    /** The theme the manager picked; its palette/radius/style are applied to the tokens above. */
    themeId: v.optional(v.string()),
    themeStyle: v.optional(v.union(v.literal("flat"), v.literal("glass"), v.literal("bold"), v.literal("gradient"))),
  })
    .index("by_space", ["spaceId"])
    .index("by_scan", ["scanId"]),

  /** F37 / D-27: every Design-tab pick, with the evidence the brand ranker and Mubit learn from. */
  brand_decisions: defineTable({
    spaceId: v.id("spaces"),
    field: brandField,
    candidates: v.array(v.object({ value: v.string(), evidence: v.string() })),
    recommended: v.string(),
    recommendedSource: v.union(v.literal("mubit"), v.literal("learned"), v.literal("heuristic")),
    chosen: v.string(),
    accepted: v.boolean(),
    companyProfile: v.object({
      host: v.string(),
      name: v.optional(v.string()),
      category: v.optional(v.string()),
      industry: v.optional(v.string()),
      voice: v.optional(v.string()),
      description: v.optional(v.string()),
      paletteSummary: v.string(),
    }),
    /** Per candidate: role hints, usage, saturation/lightness, contrast, where found (features.ts). */
    features: v.array(v.object({ value: v.string(), f: v.record(v.string(), v.number()) })),
    chosenFeatures: v.record(v.string(), v.number()),
    featureVersion: v.number(),
    mubitRequestId: v.optional(v.string()),
    /** brand_profiles.tokensVersion after this decision was applied. */
    tokensVersion: v.number(),
    actor: v.string(),
    embedding: v.optional(v.array(v.float64())),
    embeddingMode: v.optional(v.union(v.literal("live"), v.literal("offline"))),
    /** Outcome of the Mubit loop (feedback + memory), written by convex/brandLoop.ts. */
    loop: v.optional(v.any()),
  })
    .index("by_space", ["spaceId"])
    .index("by_field", ["field"]),

  /** Sliced pipeline work (BUILD-CONTRACT "The pipeline is the unit of long work"). */
  jobs: defineTable({
    spaceId: v.id("spaces"),
    /** The scan or connector this job belongs to. */
    scanId: v.optional(v.id("scans")),
    connectorId: v.optional(v.id("connectors")),
    /** Background enrichment of a scan (ENRICH_CHAIN): the stage reads this scan, the scan never waits on it. */
    sourceScanId: v.optional(v.id("scans")),
    stage: stageName,
    status: jobStatus,
    progress: v.number(),
    attempt: v.number(),
    cursor: v.any(),
    heartbeatAt: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    /** Not claimable before this time (retry backoff). */
    runAfter: v.optional(v.number()),
    /** Worker process holding the job while `running`. */
    workerId: v.optional(v.string()),
  })
    .index("by_space", ["spaceId"])
    .index("by_status_run", ["status", "runAfter"])
    .index("by_scan", ["scanId"])
    .index("by_connector", ["connectorId"])
    .index("by_status", ["status"]),

  job_events: defineTable({
    jobId: v.id("jobs"),
    spaceId: v.id("spaces"),
    scanId: v.optional(v.id("scans")),
    stage: stageName,
    level,
    message: v.string(),
    data: v.optional(v.any()),
  })
    .index("by_job", ["jobId"])
    .index("by_scan", ["scanId"])
    .index("by_space", ["spaceId"]),

  // ---- connectors -------------------------------------------------------------------------

  connectors: defineTable({
    spaceId: v.id("spaces"),
    type: connectorType,
    status: connectorStatus,
    /** Opaque reference into connector_credentials (or a Nango connection id). Never a secret. */
    authRef: v.optional(v.string()),
    cursor: v.optional(v.any()),
    lastSyncedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** Human label, e.g. the GitHub org or Slack workspace. */
    label: v.optional(v.string()),
    config: v.optional(v.any()),
  })
    .index("by_space", ["spaceId"])
    .index("by_space_type", ["spaceId", "type"])
    .index("by_status", ["status"]),

  /** Write-only. Only internal functions read this table; nothing returns or logs its contents. */
  connector_credentials: defineTable({
    spaceId: v.id("spaces"),
    ref: v.string(),
    kind: v.union(v.literal("pat"), v.literal("oauth"), v.literal("login")),
    secret: v.string(),
  }).index("by_ref", ["ref"]),

  source_items: defineTable({
    spaceId: v.id("spaces"),
    connectorId: v.optional(v.id("connectors")),
    kind: sourceKind,
    externalId: v.string(),
    url: v.optional(v.string()),
    title: v.string(),
    rawRef: v.optional(v.id("_storage")),
    meta: v.optional(v.any()),
    /** Hash of the normalised text; a changed hash is a `changed` diff_event. */
    contentHash: v.string(),
    version: v.number(),
    removedAt: v.optional(v.number()),
    fetchedAt: v.number(),
  })
    .index("by_space", ["spaceId"])
    .index("by_connector", ["connectorId"])
    .index("by_space_external", ["spaceId", "externalId"]),

  doc_chunks: defineTable({
    spaceId: v.id("spaces"),
    sourceItemId: v.id("source_items"),
    /** source_items.version the chunk was cut from. */
    version: v.number(),
    idx: v.number(),
    text: v.string(),
    tokens: v.number(),
    embedding: v.optional(v.array(v.float64())),
    extractedAt: v.optional(v.number()),
  })
    .index("by_source", ["sourceItemId"])
    .index("by_source_version", ["sourceItemId", "version", "idx"])
    .index("by_space", ["spaceId"])
    .index("by_space_extracted", ["spaceId", "extractedAt"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["spaceId"] })
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: EMBEDDING_DIMS, filterFields: ["spaceId"] }),

  // ---- brain ------------------------------------------------------------------------------

  entities: defineTable({
    spaceId: v.id("spaces"),
    type: entityType,
    name: v.string(),
    /** Lower-cased canonical key used for hard-key resolution (email, login, URL, name). */
    key: v.string(),
    aliases: v.array(v.string()),
    fields: v.optional(v.any()),
    version: v.number(),
    mergedInto: v.optional(v.id("entities")),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_space", ["spaceId"])
    .index("by_space_key", ["spaceId", "type", "key"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: EMBEDDING_DIMS, filterFields: ["spaceId"] }),

  edges: defineTable({
    spaceId: v.id("spaces"),
    sourceId: v.id("entities"),
    targetId: v.id("entities"),
    relation,
    evidence: v.optional(v.string()),
    rule: v.optional(v.string()),
    version: v.number(),
  })
    .index("by_space", ["spaceId"])
    .index("by_source", ["sourceId"])
    .index("by_target", ["targetId"]),

  entity_mentions: defineTable({
    spaceId: v.id("spaces"),
    entityId: v.id("entities"),
    chunkId: v.id("doc_chunks"),
    span: v.object({ start: v.number(), end: v.number() }),
    confidence: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_chunk", ["chunkId"]),

  facts: defineTable({
    spaceId: v.id("spaces"),
    entityId: v.optional(v.id("entities")),
    category: factCategory,
    text: v.string(),
    confidence: v.number(),
    sourceChunkIds: v.array(v.id("doc_chunks")),
    status: factStatus,
    createdBy: v.union(v.literal("agent"), v.literal("manager")),
    version: v.number(),
    /** Normalised text of the fact as first extracted (kept across manager edits): the dedupe key,
     * and how a rejected fact is recognised so it never resurfaces (F16). */
    dedupeKey: v.optional(v.string()),
  })
    .index("by_space", ["spaceId"])
    .index("by_space_status", ["spaceId", "status"])
    .index("by_entity", ["entityId"])
    .index("by_space_dedupe", ["spaceId", "dedupeKey"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["spaceId", "status"] }),

  /** Join table so "facts citing chunk X" is an index lookup (drift cascade, F35). */
  fact_citations: defineTable({
    spaceId: v.id("spaces"),
    factId: v.id("facts"),
    chunkId: v.id("doc_chunks"),
    sourceItemId: v.id("source_items"),
  })
    .index("by_fact", ["factId"])
    .index("by_chunk", ["chunkId"])
    .index("by_source", ["sourceItemId"]),

  /** F34: append-only change log per space; the cascade cursor walks it in creation order. */
  diff_events: defineTable({
    spaceId: v.id("spaces"),
    kind: v.union(v.literal("added"), v.literal("changed"), v.literal("removed")),
    sourceItemId: v.id("source_items"),
    summary: v.string(),
    processedAt: v.optional(v.number()),
  })
    .index("by_space", ["spaceId"])
    .index("by_space_processed", ["spaceId", "processedAt"]),

  // ---- courses, hires, rewards ------------------------------------------------------------

  courses: defineTable({
    spaceId: v.id("spaces"),
    packType: v.string(),
    title: v.string(),
    icon: v.string(),
    building: v.string(),
    game: v.union(v.literal("quiz"), v.literal("inbox"), v.literal("road"), v.literal("scenario")),
    spec: v.any(),
    status: courseStatus,
    needsRefresh: v.boolean(),
    version: v.number(),
    /** "offline" when the labelled stand-in built the spec instead of the model (D-26). */
    mode: v.optional(v.union(v.literal("live"), v.literal("offline"))),
    /** What hires play once published: the spec + version stamped at publish, rebuilt when a
     * published course regenerates (F36, audit `course.republished`). Edits to `spec` don't touch it. */
    publishedSpec: v.optional(v.any()),
    publishedVersion: v.optional(v.number()),
    /** F36 step-level drift: ids of CourseSpec steps whose facts went stale; cleared on regeneration. */
    staleStepIds: v.optional(v.array(v.string())),
  })
    .index("by_space", ["spaceId"])
    .index("by_space_pack", ["spaceId", "packType"]),

  /** Join table: which course teaches which fact (F36 lookup). */
  course_facts: defineTable({
    spaceId: v.id("spaces"),
    courseId: v.id("courses"),
    factId: v.id("facts"),
    /** The CourseSpec step teaching the fact (step-level refresh, F36). */
    stepId: v.optional(v.string()),
  })
    .index("by_course", ["courseId"])
    .index("by_fact", ["factId"]),

  hires: defineTable({
    spaceId: v.id("spaces"),
    userId: v.optional(v.id("users")),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    status: v.union(v.literal("invited"), v.literal("onboarding"), v.literal("complete")),
    joinedAt: v.optional(v.number()),
    coins: v.number(),
  })
    .index("by_space", ["spaceId"])
    .index("by_space_email", ["spaceId", "email"]),

  attempts: defineTable({
    spaceId: v.id("spaces"),
    hireId: v.id("hires"),
    courseId: v.id("courses"),
    stepId: v.string(),
    result: v.any(),
    score: v.number(),
  })
    .index("by_hire", ["hireId"])
    .index("by_course", ["courseId"])
    .index("by_space", ["spaceId"]),

  rewards: defineTable({
    spaceId: v.id("spaces"),
    name: v.string(),
    costCoins: v.number(),
    active: v.boolean(),
  }).index("by_space", ["spaceId"]),

  redemptions: defineTable({
    spaceId: v.id("spaces"),
    rewardId: v.id("rewards"),
    hireId: v.id("hires"),
    status: v.union(v.literal("requested"), v.literal("fulfilled"), v.literal("declined")),
  }).index("by_space", ["spaceId"]),

  /** F32: every agent action, extraction decision, sync and manager override. */
  audit_events: defineTable({
    spaceId: v.optional(v.id("spaces")),
    actor: v.string(),
    kind: v.string(),
    payload: v.optional(v.any()),
  }).index("by_space", ["spaceId"]),
});
