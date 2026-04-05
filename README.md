# GitSage

GitSage is a GitHub code ownership mapper for engineering teams. It connects to a user's GitHub account, lets them pick repositories they can access, and computes ownership across files and folders using recent commit history. The app highlights leading owners, bus factor, and high-risk modules so teams can answer questions like:

- Who should review this change?
- Who likely understands this area best right now?
- Which modules are overly concentrated around one engineer?

The product is split into a web app and a background analysis runtime:

- The `Next.js` app handles UI, auth, server actions, and read APIs.
- `Supabase` handles auth, Postgres storage, and queue-backed job dispatch.
- A separate worker processes repository analysis jobs and writes immutable snapshots.

## Why This Exists

Static ownership systems like `CODEOWNERS` are useful, but they are still manual. In fast-moving repositories, real ownership shifts over time as people refactor, extend, or replace code. GitSage uses Git activity to estimate current active ownership and surface risk signals such as bus factor and single-owner concentration.

## Tech Stack

### Application

- `Next.js 16` with App Router
- `React 19`
- `TypeScript`
- `pnpm`

### Styling and UI

- Tailwind CSS v4
- Radix UI primitives
- Lucide icons
- Framer Motion

### Auth, Database, and Queueing

- Supabase Auth
- Supabase Postgres
- Supabase Queues via `pgmq`

### GitHub Integration

- GitHub OAuth through Supabase
- Octokit for GitHub REST API access

### Background Processing

- Dedicated TypeScript worker started with `pnpm worker`
- Queue consumption via Supabase RPC wrappers over `pgmq`

## Why This Architecture

The key architectural rule in this codebase is:

- Mutations flow through `server actions -> service layer -> Supabase`
- Reads flow through `app/api/v1/* -> service layer -> Supabase`
- Supabase clients are only imported in service modules that own persistence
- GitHub API access lives in a separate integration layer

This keeps responsibilities clear:

- UI components do not directly talk to Supabase
- Route handlers stay thin
- GitHub logic does not leak into pages or React components
- The ownership algorithm remains a pure compute layer that is easier to test and evolve

### Why Queue + Worker

Repository analysis is not a request-response task. It can involve:

- fetching the repo tree
- paging through commit history
- fetching commit details concurrently
- computing ownership over many files
- persisting a snapshot and its related rows

Running that inside the web request path would make the app slow and fragile. The queue + worker split gives us:

- fast user-facing interactions
- retryable background work
- safe isolation for heavy GitHub fetches
- a clean path to horizontal worker scaling later

### Why GitHub OAuth

GitSage is GitHub-first. Using GitHub OAuth through Supabase gives us:

- a familiar login flow
- repository access scoped to the user's GitHub account
- no manual token entry in the UI
- a provider token that can be encrypted and reused by the worker for async analysis

## Product Flow

1. A user lands on the marketing site.
2. They sign in with GitHub.
3. Supabase completes OAuth and redirects back to the app.
4. The app stores connected-account metadata and the encrypted provider token.
5. The user visits `/repositories` and sees repositories they can access.
6. They enqueue an analysis run for a repository.
7. A worker picks up the job, analyzes the repository, and writes an immutable snapshot.
8. The insights page reads the latest successful snapshot and shows ownership data.

## Analysis Pipeline

### High-Level Flow

When a repository is analyzed, the worker does the following:

1. Fetch the current repository tree from the default branch.
2. Filter out irrelevant files so the analysis focuses on actual code paths.
3. Fetch commit history up to the configured commit cap.
4. Fetch commit details with bounded concurrency.
5. Convert commit activity into file-level author scores.
6. Roll those scores up into folder-level ownership.
7. Compute bus factor and risk labels.
8. Persist a snapshot plus node, owner, and edge rows.

### Relevant File Filtering

The worker filters the repository tree before analysis so that ownership is not dominated by noise like:

- lockfiles
- generated artifacts
- build output
- coverage files
- static assets and similar non-code paths

This keeps the results more meaningful for engineering teams.

### Commit Fetching Strategy

We fetch commit history from the default branch and cap the total number of commits analyzed.

Current behavior:

- one analysis mode: `full`
- maximum commits fetched: `1000`
- no day-window threshold
- full tree retained for normal repository navigation

We intentionally stop after the commit cap so large repos do not generate unbounded API work.

### Why We Use Bounded Concurrency

Fetching commit details one by one is too slow for active repositories. Fetching all of them at once risks rate limits and unstable worker behavior. Instead, we use bounded concurrency:

- multiple commit-detail requests run at the same time
- but only up to a fixed limit
- as one request finishes, the next one starts

This gives us a balanced tradeoff:

- much faster than sequential fetching
- safer than unbounded parallelism
- friendlier to GitHub rate limits

The concurrency level is configurable through `ANALYSIS_COMMIT_DETAIL_CONCURRENCY`.

## Ownership Logic

GitSage estimates current active ownership by combining:

- contribution size
- recency
- survival of that contribution over later edits

### Step 1: Weighted Change Size

We do not treat additions and deletions equally:

`weightedLines = additions * 1.0 + deletions * 0.6`

This gives slightly more credit to authored or added code while still counting deletions as meaningful work.

### Step 2: Base Contribution Score

We soften the effect of very large commits and apply recency decay:

`baseScore = ln(1 + weightedLines) * exp(-ageInDays / 45)`

Why this helps:

- very large commits matter, but do not dominate linearly
- recent changes matter more than older changes

### Step 3: Survival / Overwrite Effect

Commits are processed in chronological order per file.

When a new commit touches a file:

- the current author gains `baseScore`
- other existing owners on that file lose some prior score

The erosion factor is:

`erosion = min(0.35, weightedLines / 500)`

For every previous owner other than the current author:

`newOwnerScore = oldOwnerScore * (1 - erosion)`

This means:

- if code stays, earlier ownership survives
- if later commits significantly replace earlier work, older ownership is reduced

This is more realistic than a purely additive churn model.

### Step 4: Final Ownership Share

After processing all commits for a file:

`ownershipShare(author) = authorScore / sum(allAuthorScores)`

That gives us the ownership percentage for each contributor.

### Step 5: Folder Rollups

Folder ownership is calculated by summing scores from descendant files. This lets us answer both:

- who owns this file?
- who owns this module or folder?

### Bus Factor and Risk

For each node, owners are sorted by share and we count how many top owners are needed to reach 70% cumulative ownership.

That count is the bus factor:

- `1` -> `critical`
- `2` -> `warning`
- `3+` -> `healthy`

This is a concentration metric, not a code-quality metric. A `critical` node means ownership is highly concentrated, not that the code is broken.

## Data Model

The core tables are:

- `profiles`
- `connected_accounts`
- `repositories`
- `analysis_runs`
- `analysis_snapshots`
- `analysis_nodes`
- `analysis_node_owners`
- `analysis_graph_edges`
- `repository_processing_locks`

### Important Concepts

- `analysis_runs` tracks queue state, processing state, retries, and progress
- `analysis_snapshots` are immutable completed analysis outputs
- `analysis_nodes` stores file/folder rows for a snapshot
- `analysis_node_owners` stores ownership breakdowns per node
- `repository_processing_locks` prevents duplicate concurrent processing of the same repository

Snapshots are immutable by design so re-runs never rewrite historical analysis.

## Deployment Model

### Web App

The Next.js app is intended to run on `Vercel`.

Responsibilities:

- public marketing pages
- authenticated application routes
- GitHub OAuth callback handling
- server actions for enqueueing analysis
- read APIs under `app/api/v1/*`

### Worker

The worker is intended to run outside Vercel as a separate long-running process.

Production target:

- AWS EC2 Spot instances
- Auto Scaling Group
- one worker process per instance initially

Responsibilities:

- read queued analysis jobs
- acquire repository lock
- fetch GitHub data
- compute ownership
- write snapshots and status updates

### Why Split Deployments

Vercel is a great fit for the web app, but heavy background analysis should not run inside Vercel functions. The separate worker runtime gives us:

- better control over long-running jobs
- retry-safe queue processing
- independent scaling from the frontend

## Autoscaling Strategy

Workers are queue consumers, so they should scale based on queue pressure, not web traffic.

Good autoscaling signals include:

- queue depth
- oldest queued message age
- optionally worker CPU / memory

Example production behavior:

- if several users enqueue analysis at once, queued jobs rise
- more worker instances are launched
- each worker claims one job and processes it independently

Spot instances are a good fit because:

- analysis jobs are interruptible and retryable
- queue leasing allows safe recovery if an instance disappears
- cost is much lower than always-on on-demand capacity

## Folder Structure

```text
app/
  (marketing)/              Public landing page
  (app)/repositories/       Authenticated repository views
  api/v1/                   Read-only API routes
  auth/callback/            Supabase OAuth callback finalization

src/
  actions/                  Server actions for auth and analysis mutations
  components/               Shared UI components and route-level clients
  integrations/github/      Octokit client, types, and GitHub API services
  lib/                      Pure utilities, env config, crypto helpers
  lib/analysis/             Ownership scoring and rollup logic
  services/
    _shared/                Shared service-layer helpers like Supabase clients
    auth/                   Session and connected-account persistence
    repositories/           Repository sync and summary reads
    analysis/               Queue, worker lifecycle, locks, status, errors
    ownership/              Ownership read models for the UI and APIs
  types/                    Database, domain, and validation types
  worker/                   Standalone worker entrypoint

supabase/
  migrations/               Database and queue/runtime migrations
```

## Important Runtime Files

- `src/actions/auth.ts` and `src/actions/analysis.ts`
- `src/services/auth/service.ts`
- `src/services/repositories/service.ts`
- `src/services/analysis/service.ts`
- `src/services/analysis/queue-service.ts`
- `src/services/ownership/service.ts`
- `src/integrations/github/service.ts`
- `src/lib/analysis/ownership.ts`
- `src/worker/index.ts`

## Environment Variables

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN_ENCRYPTION_KEY`

Optional tuning variables:

- `ANALYSIS_COMMIT_DETAIL_CONCURRENCY`
- `ANALYSIS_QUEUE_VT_SECONDS`
- `ANALYSIS_QUEUE_POLL_SECONDS`
- `ANALYSIS_LOCK_LEASE_SECONDS`
- `ANALYSIS_PROGRESS_BATCH_SIZE`

## Local Development

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Create your local env file with the variables listed above.

### 3. Apply database migrations

```bash
supabase db push
```

### 4. Start the web app

```bash
pnpm dev
```

### 5. Start the worker in another terminal

```bash
pnpm worker
```

## Available Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm worker
```

## Current Product Shape

Today the application is optimized around:

- GitHub-only v1
- queue-backed repository analysis
- user-scoped cached snapshots
- file and folder ownership browsing
- bus-factor-based risk signals

The current `/repositories/[repositoryId]` experience is tree-first rather than graph-first, with deeper folders expanded manually to keep navigation readable.

## Future Directions

Planned and likely next steps include:

- moving the worker runtime to Go for stronger concurrency and throughput
- richer legacy-code and dead-code graphing
- more advanced autoscaling signals for worker fleets
- further refinement of ownership heuristics
- broader provider support beyond GitHub
