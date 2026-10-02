# Architecture

## Scope and status

This document describes the implemented ingestion, analytical and authenticated
read API boundaries of Retail Data Platform, plus a web entry screen with OIDC
authentication. Business screens, verified production identity deployment and
multi-tenant authorization are outside the current implementation.
Authorized API readers have global access; store selection is a query filter.

The platform turns heterogeneous tabular source bundles into a validated,
traceable PostgreSQL dataset and exposes bounded authenticated reads without
placing operational data in the public repository.

## Frontend shell boundary

The isolated `frontend/` package uses React, strict TypeScript, Vite and Material UI.
Its French entry screen applies shared design tokens, explains unavailable sign-in
when configuration is missing and handles loading/render failures without displaying
exception content. A public
API-origin setting is validated but does not initiate business requests. Configured
personal sign-in uses `oauth4webapi` with Authorization Code, PKCE S256, state,
nonce, mandatory callback issuer and RS256 ID-token signature/claim validation.
Discovery, token and JWKS fetches stay on the configured issuer origin and refuse
redirects. Top-level authorization navigation remains under provider control.
The callback URL is replaced before exchange; its transient state is consumed once.
Only state, nonce and verifier use sessionStorage during redirect, with a ten-minute
acceptance deadline and cleanup on return or expired re-entry. Access tokens remain
in memory; refresh-token fields are rejected. ID tokens are never retained as API
credentials. A generation-bound memory session expires by timer and is checked
again on focus, visibility and page-show. Logout, replacement and document departure
clear credentials, cancel outstanding operations and unmount protected content.
Late OIDC responses cannot recreate an ended session. The session work boundary
rejects results and errors from old generations, including work that ignores cancellation.
Page-hide clears protected content synchronously before caching; persisted restoration
requires a new login. Intentional provider navigation preserves only transient PKCE
state. Redirect-state removal is best-effort if browser storage throws; memory
authority still ends and login/exchange refuse storage failures. The shell initiates
no business-data reads, telemetry or service worker.
It is not connected to the read API in the context diagram below.

The separate read transport provides fixed GET routes for the catalog, analytical
freshness and single pages of published resources. It validates the configured
origin, query values, JSON envelopes and consumer-supplied row projections. A store
selection projection is available; unused row fields are discarded. Dates and exact
decimal values remain strings, preserving null. Requests omit cookies and referrers,
disable caching, reject redirects and have a ten-second timeout. JSON is limited to
2,000,000 streamed bytes with strict UTF-8 decoding. Errors retain no response payload
or credential. Current 401 responses end the session; late refusals cannot end a
new session. A separate `ReadQueries` service deduplicates and caches reads in the
current memory session; authenticated store screens use that service. Consumer results
are cloned and retained state must be bound to the current generation and selection.
Every raw read shares a session queue with two active reads, thirty-two waiting jobs,
a thirty-second queue deadline, and sixty starts per rolling minute at one-second
spacing. Rate history is local and does not establish the server budget consumed by
other clients. An ignored abort cannot free a still-active transport slot.

The query service caches for thirty seconds, with thirty-two entries, a 1,000,000
serialized-character budget and 100,000 characters per retained projection. Session
changes and disposal cancel work and clear the cache. There are thirty-two distinct
jobs and at most sixty-four consumers per job; only the final consumer's cancellation
aborts shared work. Eligible retries are restricted to 429/503, with three transient
failures at most, bounded visible Retry-After or fallback waits, and no retry after
logout. A page halves limit on 413 down to one, with ten total attempts at most.
An explicitly requested collection is bounded to five pages, 1,000 rows and twenty-four
total attempts including freshness checks; repeated cursors fail and partial results
are identified. A freshness change discards the batch and invalidates the cache;
unchanged freshness is not a snapshot guarantee. No background/exhaustive loading,
persistent business storage or new backend endpoint is introduced.
Synthetic transport tests verify these boundaries. An opt-in local smoke additionally
uses Chromium with the production entry screen and a real Keycloak realm, then
exercises the query modules against the actual API and a disposable synthetic
PostgreSQL schema. It verifies web code exchange, two API pages, missing-scope/CORS/
callback refusal, wrong-client/audience/expired signed-token refusal, and the original
CLI token/vault contract with a test memory vault. Temporary identity/database objects
are removed after the run; the existing realm and CLI configuration are preserved.
The local smoke also renders the store list, opens a store, retains its selection
on return and removes its rows after logout. This does not verify a deployed provider,
native OS vault or analytical business-data flows. The [local recipe](local-identity.md#browser-and-api-integration-smoke) documents
the prerequisites and cleanup boundary.

Formatting, lint, strict typing, synthetic component/configuration tests and a
production build have been verified. Playwright Chromium tests exercise that build
at 360/768/1440 px, including keyboard expansion/collapse, retained focus, empty
browser storage and axe checks. Signed synthetic OIDC scenarios cover success,
issuer/state/nonce/signature failures, refused exchange, unexpected refresh tokens,
orphan callback cleanup and reload. Unit tests also verify replay, expiry and
configuration binding. Session tests cover late responses, synchronous abort handlers,
protected component state reset, suspended timers and persisted page events. Browser
scenarios verify expiry, logout, a second explicit login and history return; they do
not establish that Chromium chose to use its back/forward cache. A dedicated build
supplies public synthetic settings without reading local environment files;
the normal production build is checked separately.
The default harness aborts and fails unexpected requests; OIDC scenarios explicitly
intercept their synthetic provider and callback routes. Traces, video and
screenshots are disabled. These checks are not a complete accessibility audit.

The authenticated store list requests one cursor page at a time (initial limit 25).
Selection uses explicit IDs in component memory and survives page/detail navigation
only within the current session. Local sorting is labelled as applying to this page;
no network total, implicit all-store selection, unsupported filter or aggregation
request is introduced. Opening a store rereads its header by ID and distinguishes
an absent row from an invalid response. Duplicate IDs within a page, empty/repeated cursors and mismatched
detail IDs fail closed. Obsolete requests are cancelled and their results cannot
replace another view. The previous page remains reachable during a load or failure.
Logout/expiry unmount this state. The active detailed-data tab reads the full
published store reference only on explicit expansion, validates each field and
discards unknown fields. Closing it, changing tabs or leaving the detail cancels
its pending read. Null, zero, false and exact decimal strings remain distinct.
Draft and applied inclusive calendar months survive list/detail navigation in
session memory. The period starts empty and accepts at most 120 inclusive months
from 0001-01 through 9999-12 without timezone conversion. This is a client bound,
not evidence of observation coverage. Only the active store synthesis reads the
existing monthly analytical collection after an explicit period is applied;
other analytical tabs and shared navigation remain subsequent work.
The authenticated screen checks analytical publication status on entry and manual
request, without polling or starting a refresh. It distinguishes freshness from
coverage and the last refresh attempt from a failed status read. The last known
status survives a failed check with an explicit warning; logout/expiry remove it.
Current/stale status without a completion timestamp is rejected; an uninitialized
status may still report an older successful completion without implying readability.
Completion timestamps are displayed in UTC. The live store reference remains
independent of analytical initialization. Published decimal amounts and counts
use French formatting; identifiers keep their exact text. Decimal arithmetic uses
BigInt coefficients with bounded decimal scales, propagates null and treats zero
denominators as unavailable. Division rounds half away from zero with an explicit
0–18-place precision (default six); no business calculation uses binary numbers.
No currency or tax basis is inferred. Collection tests verify discard and reload
when publication changes across two pages; this is not a snapshot guarantee.
The single-store synthesis filters `analytics_store_month` by store and inclusive
months, checks initialization and surrounds its bounded collection with freshness
reads. It cancels on departure, and a changed or incomplete publication exposes
neither a total nor a false missing month. Explicit retry loads again. The full
read is projected into the expected calendar grid; null/missing remain distinct
from zero and negative sales. Exact sums state their own month coverage, and
non-ambiguous reported sales remain separate partial diagnostics. Revenue per
unit uses identical complete months and a nonzero denominator. No category or
nested detail is joined or summed. Decimal validation and summary arithmetic run
before the ready state; failures remain local and retryable.
The MUI X Charts Community curve uses binary
numbers only for finite geometry and axis span, preserves gaps with straight
segments, labels partial coverage and disables animation; its
exact tooltip and a keyboard-accessible scrollable table expose the source
values. Out-of-range geometry remains available in the table with a warning.
The read limits are five pages and 120 rows; separate pages remain separate
snapshots. Other analytical screens and full nested publication inspection are
not implemented by this increment.
A GitHub workflow runs locked installation and the same local quality command;
hosted execution has not yet been observed. Deployed provider/API compatibility,
remaining analytical screens and production hosting remain later increments.
Setup and actual scripts are in the
[frontend guide](../frontend/README.md).

## Context

```text
                  public repository
             +--------------------------+
private      | command-line interface   |
source ----> | dataset import adapter   | ----> PostgreSQL
bundle       | synthetic test fixtures  |         |
             +--------------------------+         +--> local inspection UI

                                             PostgreSQL --> read API
                                                               |
                                                authorized clients (external)
```

Private sources remain outside the repository and are supplied to the command
line interface as a local directory. The repository contains synthetic fixtures
that exercise the same contracts without reproducing real records.

PostgreSQL is the system of record. The browser-based database interface is a
development inspection tool, not an application write path.

## Import lifecycle

Each dataset owns an adapter with one public import entry point. The current
lifecycle is:

1. Discover the required files from their structural contract, with a formatted
   period in the filename where the period is part of the source contract.
2. Check file boundaries such as type, size, encoding and identifying headers.
3. Hash the ordered source bundle and check for a previous successful run.
4. Record a running import in `import_runs`.
5. Parse, normalise, reconcile and validate rows for the smaller adapters.
6. Acquire a dataset-scoped PostgreSQL advisory lock.
7. Publish domain rows and mark the run successful in one transaction. The large
   register adapter parses and validates one file at a time inside this
   transaction after acquiring the lock.
8. If processing fails, roll back publication and record a failed run separately.

An identical bundle that already has a successful run is skipped. The database
also prevents more than one successful run for the same dataset and bundle hash.
The advisory lock serialises publication for a dataset, while database
constraints remain the final protection for identities and invariants.

## Components and responsibilities

### Command-line interface

The CLI selects a dataset adapter and supplies its source directory. It reports
a small machine-readable summary; source parsing and business rules do not live
in the command layer.

### Dataset import adapters

Each adapter owns its source contract and the transformations needed to produce
domain records. Discovery does not depend on organisation-specific filenames;
it uses headers and, where relevant, a generic period format. Parsing and
validation finish before the publication transaction commits so that a malformed
bundle cannot produce a partially refreshed domain dataset.

Adapters never choose an arbitrary winner for ambiguous identities: they reject
the conflict or retain the source observation with an unresolved relationship.
Duplicate source business keys are rejected. Expected validation messages
describe the role, row and field without echoing the rejected value.

### Persistence

SQLAlchemy models define the application mapping. Alembic migrations are the
versioned database contract. PostgreSQL reinforces critical rules with foreign
keys, uniqueness constraints, check constraints and indexes.

`import_runs` is the audit boundary for an execution. It stores the dataset,
bundle hash, lifecycle status, row counts, timestamps and a bounded failure
message. Domain publication and the successful status transition share a
transaction.

### Local database inspection

The optional database UI is exposed only on the loopback interface. It is useful
for reviewing imported rows and running development queries. Manual changes made
there are disposable and are never a substitute for a migration or importer.

## Architectural guarantees

For the implemented adapters, the design aims to preserve these invariants:

- private source files are not required inside the repository;
- identical validated input produces deterministic domain business fields;
- a previously successful identical bundle is not republished;
- validation failure cannot publish a partial domain refresh;
- concurrent publication of the same dataset is serialised;
- schema evolution is explicit and reversible;
- durable identity and value rules are enforced by PostgreSQL where practical;
- tests rely only on synthetic data.

These ingestion guarantees do not cover distributed workers, remote object storage
or asynchronous orchestration. The separate read API boundary is described below;
production availability and deployment observability remain environment concerns.

## Verification

A change to this boundary is complete only after the relevant checks pass:

- formatting, linting and strict type checking;
- unit tests for valid, invalid, duplicate and conflicting inputs;
- PostgreSQL integration checks for transactional and idempotent behaviour;
- fresh migration upgrade and model-to-schema alignment;
- downgrade and re-upgrade of a new migration.

Architecture documentation changes with system boundaries or guarantees. Routine
implementation details remain in code and tests so that this document stays
stable and reviewable.

## Deliberate limitations

- Most adapters validate complete source bundles in memory. The large register
  adapter processes one source file at a time and streams records into a single
  PostgreSQL transaction; it is still a local ingestion design, not a
  warehouse-scale ingestion service.
- Idempotency is based on byte-level bundle hashes. Semantically equivalent files
  with different bytes are distinct inputs.
- Failed-run recording is best-effort after the publication transaction fails;
  it is audit information, not a distributed workflow engine.
- The local database credentials and inspection UI are development conveniences,
  not a production security model.

## Analytical read boundary

Versioned PostgreSQL materialized views provide a dense store-month calendar with independently
aggregated sales, activity, category and typology information. Companion views
retain product/source grain, explicit attribution failures and conservative
assortment candidates. Ambiguous facts are not silently summed, missing measures
remain distinct from zero, and current master attributes are labeled separately
from observed historical attributes.

The analytical refresh command calculates dependencies in order from one
repeatable-read snapshot and publishes all results and a success audit atomically.
Subsequent refreshes permit concurrent readers of the previous snapshot. Unique
indexes enforce analytical grains. Freshness is checked against successful import
run identities; manual source edits are outside this guarantee. Imports can opt
in to a post-publication refresh or a bundle can refresh once after its final
import. A refresh failure preserves the prior analytical snapshot and does not
undo a completed source import.

SQLAlchemy view mappings use separate metadata from the base tables. The refresh
audit is a normal mapped table. Migration lifecycle, analytical contracts,
concurrent readers, source snapshot consistency and failure rollback are verified
on synthetic PostgreSQL data. See [Monthly store analytics](monthly-analytics.md)
for grains, joins, refresh operations and temporal limitations.

## Authenticated read API boundary

The FastAPI resource server exposes explicit projections of all 13 application
tables and 11 analytical views through versioned, typed collection routes. A
checked-in registry fixes allowed columns. Nested analytical objects are validated
against explicit models, so additional database fields are not published implicitly.
Operational audit collections require an additional scope and exclude source
filenames, source hashes and failure messages, including at the SQL grant boundary.

JWT access tokens require an exact configured HTTPS issuer, a dedicated audience,
RS256 signature validation against configured JWKS, access-token type, lifetime
checks and the data:read scope. Credentials are issued externally. Authentication
and query validation precede database queries; no user, password or token-issuance
store was added. Access is global: there is no per-store or tenant isolation claim.

SQLAlchemy queries use explicit columns, bound filters and primary-key keyset
pagination. Every primary-key column is filterable for exact row selection; store
filters cover store-linked observations and analytics. Page length, response size,
pool size, concurrency in the local runner and statement duration are bounded.
A bounded per-process subject rate limiter
supplements mandatory ingress limits. No HTTP writes, arbitrary SQL, joins supplied
by clients, or refresh operations exist. Typology-value store filtering follows the
snapshot relationship. Analytical semantics and freshness remain those documented
in monthly-analytics.md. Separate pages are separate snapshots, not frozen exports.

A dedicated PostgreSQL login has explicit column SELECT grants. Startup checks
role flags, memberships, ownership, schema creation, write permissions and column
grants; importer/owner credentials are rejected. Every query transaction is read-only.
Provisioning privileges is an explicit administrator operation. No database schema
change or migration was introduced by the API.

Synthetic tests verify signatures and claim failures, protected discovery/OpenAPI,
query rejection, authorization, all resource routes, primary-key lookup,
composite pagination, exact serialization, nested-field exclusion, database failures,
size/rate limits and real
PostgreSQL write denial. Existing migration/import/analytics tests also run against
PostgreSQL. Swagger UI is available through a public authentication shell at `/docs`; fetching
the schema and executing API requests still require a valid token. Tokens are held
only in tab memory, and pinned CDN assets are checked with SRI.
An optional local Keycloak service has passed login and role-denial smoke checks
with disposable synthetic users. Production ingress and production-scale load
have not been exercised. Encoded response limits do not bound memory for a single
large nested database row. No production latency or availability guarantee is implied.

See [read API design](read-api-design.md), [operations and client contract](read-api-operations.md)
and [agent guide](api-agent-guide.md). The operations document records deployment
requirements and explicit limits; it is not a claim that deployment is complete.

## Personal authentication client

The `retail-auth` CLI and `PersonalClient` library implement interactive personal
access for local scripts and notebooks. Authorization Code with PKCE S256, random
state and callback issuer verification protect the loopback login handoff. Every
login requests `prompt=login` and `max_age=0`. The provider must enforce actual
credential entry and issue trusted authentication-time claims. Refresh-token
responses are rejected, and there is no renewal or client-credentials
implementation. An optional local Keycloak deployment is documented separately;
its application realm and client are provisioned locally. No personal user is
created by the provisioning script.

The API now requires `azp` to match its configured personal client and verifies the
signed `auth_time`. Tokens must be issued within 60 seconds of authentication, live
at most 86400 seconds and remain within 86400 seconds of authentication. The client
uses the same validation and stores only the access token and effective deadline
in an explicitly selected native OS vault. Plaintext fallback backends are not used.
Expired/missing credentials and HTTP 401 stop scripts with a new-login requirement;
requests never automatically open a browser or follow HTTP redirects with a token.
Local logout removes the saved credential without claiming to revoke copied JWTs.

Synthetic tests exercise the code exchange, callback state/issuer protections,
loopback HTTP flow, expiry, rejection of refresh tokens and nonpersonal claims,
request destinations, session deletion and CLI exit codes. Vault tests use an
in-memory substitute, not the user's credentials. Local Keycloak login was also
tested with disposable synthetic users; native-vault integration remains an
environment-specific check. See
[personal authentication](personal-authentication.md) for setup and usage.
