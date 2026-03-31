# ClearPath

Serverless agentic AI pipeline for automated asset decision-making, built using Cloudflare and Terraform.

Assets (PDFs, images, documents) are ingested, vectorized, and evaluated by an AI agent that decides whether to approve, reject, flag for fraud, or escalate to a human reviewer — with configurable autonomy levels controlling how much the AI acts independently.

## Prerequisites

- Node.js 18+
- npm 9+
- Terraform >= 1.5
- A Cloudflare account with Workers, R2, D1, Vectorize, and Queues enabled

## Setup

```bash
# Clone and install
git clone <repo-url> && cd clearpath
npm install

# Configure environment
cp .env.local.example .env.local
# Fill in your Cloudflare account ID, API token, and desired autonomy level

# Configure Terraform variables
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Fill in your Cloudflare credentials
```

## Build & Deploy

```bash
# Build all workers
npm run build

# Deploy infrastructure + workers
npm run deploy
```

This runs `scripts/build-workers.sh` (esbuild per worker) then `terraform apply` against your Cloudflare account.

## CLI

### Install globally

```bash
cd cli
npm run build
npm link
```

This makes `clearpath` available as a global command.

### Interactive mode

```bash
clearpath
```

Launches an interactive REPL:

```
ClearPath CLI v0.1.0
Connected to https://your-worker.workers.dev
Type 'help' for commands, 'exit' to quit.

clearpath> health
clearpath> ingest ./mortgage_application.pdf
clearpath> analyse mortgage_application.pdf --autonomy=2
clearpath> audit --limit=10
clearpath> exit
```

### One-shot mode

```bash
clearpath ingest ./mortgage_application.pdf
clearpath analyse asset_001
clearpath analyse asset_001 --autonomy=2
clearpath audit --limit=10
clearpath health
```

### Configuration

The CLI automatically loads `.env.local` from the project root on startup. Set your deployed worker URL there once and it applies to every session:

```bash
# In .env.local
CLEARPATH_API_URL=https://clearpath-dev-orchestrator.your-subdomain.workers.dev
```

You can find your worker URL in the Terraform outputs after `npm run deploy`. An explicit `export CLEARPATH_API_URL=...` in your shell will override the file.

## Autonomy Levels

Set via `TF_VAR_autonomy_level` in your `.env.local`:

| Level | Behaviour                                           |
| ----- | --------------------------------------------------- |
| 1     | No AI review — human decides everything             |
| 2     | AI recommends, human decides                        |
| 3     | AI acts on high-confidence decisions, defers on low |
| 4     | Full AI autonomy with real-time notifications       |
| 5     | Full autonomy, periodic audit log only              |

## Local Development

```bash
# Run a worker locally
cd workers/orchestrator-worker
npx wrangler dev
```

## License

All rights reserved. Written consent from Lewis Joachim Spruce is required to use, copy, modify, or distribute this software in any capacity.
