# ClearPath

> A serverless agentic asset decision pipeline built on Cloudflare Workers, RAG-powered vector search, and Terraform-provisioned infrastructure for automated compliance workflows.

---

## Vision

ClearPath is a simple MVP agentic AI backend that automates decision-making using agentic AI — starting with mortgage application processing as a simulation. Assets (documents, images, PDFs, and eventually any binary) are ingested, vectorized (in near real-time), and evaluated by an AI agent that decides whether to approve, reject, flag for fraud, or escalate to a human reviewer.

The core design principle is **controllable autonomy** — a configurable parameter that determines how much the AI acts independently vs. defers to a human in the loop. This makes ClearPath applicable beyond mortgages to any compliance-heavy domain: insurance, legal, etc.

---

## Status

Fresh repository. Building from scratch.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Infrastructure as Code | Terraform |
| Compute | Cloudflare Workers (TypeScript) |
| Object Storage | Cloudflare R2 |
| Event Triggers | R2 Event Notifications → Cloudflare Queues |
| Vector DB | Cloudflare Vectorize |
| Embeddings & LLM calls | Cloudflare Workers AI |
| Audit Trail | Cloudflare D1 |
| Observability | Cloudflare AI Gateway |
| CLI Client | Local TypeScript CLI (tsx) |

---

## Architecture

```
Object uploaded to R2
       ↓
R2 Event → Queue → vectorize-worker
       ↓
   chunks embedded + upserted to Vectorize
       ↓
   vectorize-worker publishes to SECOND queue
   (analysis-queue) once vectorization complete
       ↓
orchestrator-worker (Queue consumer)
   → pulls object from R2
   → RAG search
   → decision
   → autonomy check
   → auto-act or notify human etc.
```

---

## Autonomy Levels

Configured via Terraform as a Worker environment variable (`AUTONOMY_LEVEL`). Can be changed per environment without redeploying Worker code.

| Level | Behaviour |
|---|---|
| `1` | No AI review triggered. Asset ingested and stored only. All decisions made by human |
| `2` | AI analyses and produces a recommendation with reasoning. Human makes all final decisions |
| `3` | AI makes low-confidence or ambiguous decisions, defers to human. High-confidence decisions acted on automatically |
| `4` | AI acts autonomously on all decisions. Human receives real-time notification of every action taken |
| `5` | Full AI autonomy. Human receives periodic audit log only. No interruptions (likely never used) |

---

## Workers

| Worker | Trigger | Responsibility |
|---|---|---|
| `vectorize-worker` | Queue consumer | Chunk, embed, upsert or delete vectors |
| `orchestrator-worker` | HTTP POST `/analyse/:id` | Agentic loop, tools, decision output |
| `rag-worker` | Service Binding | Embed query + Vectorize semantic search |
| `search-worker` | Service Binding | Web search tool for agent |
| `actions-worker` | HTTP POST | Handle approve/reject/flag/review + D1 audit log |

---

## Action Endpoints (Simulated)

- `POST /approve` — approve asset/application
- `POST /reject` — reject with reason
- `POST /flag-fraud` — escalate as fraud
- `POST /human-review` — send to human review queue
- `POST /human-feedback` — human overrides AI decision, logged to audit trail

All actions write to the D1 audit table:

```
asset_id | decision | actor  | confidence | timestamp | notes
---------|----------|--------|------------|-----------|------
a_001    | APPROVE  | ai     | 0.91       | ...       | auto
a_002    | REJECT   | human  | -          | ...       | override
```

---

## Infrastructure (Terraform)

Terraform manages all Cloudflare resources. Each environment (`dev`, `staging`, `prod`) is fully isolated via the `${var.environment}` variable suffix.

**Resources provisioned:**
- R2 bucket
- Cloudflare Queue
- R2 Event Notification rules (create & delete)
- Vectorize index (768 dimensions, cosine similarity)
- D1 database
- All Worker scripts with bindings
- AI Gateway instance
- Service bindings between Workers
- Environment variables (including `AUTONOMY_LEVEL`)

**Terraform provider:** `cloudflare/cloudflare ~> 4.x` (pinned to v4 for stability — v5 still stabilising as of early 2026)

---

## Project Structure

```
clearpath/
├── infra/                        # Terraform
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── modules/
│       ├── r2/
│       ├── queues/
│       ├── workers/
│       ├── vectorize/
│       └── d1/
│
├── workers/                      # Cloudflare Workers (TypeScript)
│   ├── ingest-worker/
│   ├── vectorize-worker/
│   ├── orchestrator-worker/
│   ├── rag-worker/
│   ├── search-worker/
│   └── actions-worker/
│
├── cli/                          # Local CLI client
│   └── index.ts
│
└── CLEARPATH.md                  # This file
```

---

## Key Design Decisions

- **Assets not documents** — the ingest pipeline handles any binary (PDF, image, DOCX, etc.) to support future expansion beyond mortgage docs
- **`doc_id` metadata on every vector chunk** — enables clean full-asset deletion from Vectorize when an asset is removed from R2
- **Service Bindings for sub-agents** — Workers call each other internally, no HTTP overhead, no extra billing
- **Autonomy as an env var** — change behaviour per environment via `terraform apply`
- **D1 audit trail** — every decision (AI or human) is logged with actor, confidence, and timestamp (and more if needed)
- **Terraform-first** — all infrastructure is reproducible and version-controlled, no manual dashboard clicks

---

## CLI Usage (Target)

```bash
# Upload and ingest an asset
$ clearpath ingest ./mortgage_application.pdf

# Analyse an asset (uses autonomy level from env)
$ clearpath analyse asset_001

# Override with explicit autonomy level
$ clearpath analyse asset_001 --autonomy=1

# View audit log
$ clearpath audit --limit=10
```

---

## Notes for Development

- Workers are TypeScript, compiled with `esbuild` before `terraform apply`
- Terraform `content` for Worker scripts points to compiled `dist/index.js`
- All secrets (API tokens etc.) passed via Terraform variables, never hardcoded
- Start with `dev` environment, single Vectorize index, single D1 database
- Vectorize index dimensions must match the embedding model output — `@cf/baai/bge-base-en-v1.5` outputs 768 dimensions