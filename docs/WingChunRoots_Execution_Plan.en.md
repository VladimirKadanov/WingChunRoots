# WingChunRoots Execution Plan

Proposed for owner approval on 30 September 2026.

This plan turns the [English project specification](WingChunRoots_Project_Specification.en.md) into a phased delivery program. The recommendation is to establish a trustworthy lineage and school directory first, validate it with a small pilot, then add paid services, organizational administration, publishing, commerce and promotion.

**Current status: awaiting approval.** Only the source review, English specification and this plan have been completed. No agents have been created, no application scaffold or services have been configured, and no external account has been changed.

Approval of this plan authorizes the preparation phase below: create the project agents and prepare the working instructions, backlog, architecture, design direction, skills and test strategy. It does not instruct the team to start implementing the application or launch it publicly. This follows the owner's requested sequence: plan, approval, agent creation and execution preparation.

## 1. What is known

- The workspace currently contains a Bulgarian project discussion and a short Bulgarian Markdown summary, plus the two English documents created during this review.
- No application code, package manifest, repository metadata or project-specific `AGENTS.md` was found in this workspace.
- The source says a programmer is already engaged. The location and status of that work are unknown.
- The desired product is much broader than a single website: it includes a lineage archive, subscriptions, school administration, publishing, marketplace, community features and social distribution.
- The final source account structure has five commercial plans: Free Student, Premium Student, Free Sifu, Professional Sifu and Federation.
- Prices and budgets in the source are working examples, not approved commitments.

## 2. Recommended delivery scope

### Phase 0 Execution preparation

**Begins after this plan is approved.** Create the three specialist agents, with this chat remaining the coordinating agent. Give each a clear area of responsibility, shared inputs and a concrete deliverable. They prepare the implementation package without starting product development.

Deliverables:

1. Confirmed baseline requirements and decision register, with unresolved questions clearly marked.
2. Inventory of any existing implementation and a decision to extend it or start a new application.
3. Architecture proposal, data ownership model and module boundaries.
4. Screen inventory, user journeys and wireframe descriptions for the first release.
5. Prioritized backlog, dependencies and acceptance criteria.
6. Verification, privacy, moderation and billing state models.
7. Repository working instructions and narrow reusable skills where helpful.
8. Test, staging, recovery and release plans.
9. Service and access checklist, with placeholders rather than secrets.
10. An execution-readiness report identifying what can begin and what still depends on owner input or external access.

**Exit condition:** every first-release requirement has an owner, defined behavior and a testable acceptance criterion; architectural choices and unresolved decisions are visible; the team has no overlapping file ownership; no invented personal or historical data is treated as verified.

### Phase 1 Core archive and school directory

Build the first end-to-end product around adult pilot users, subject to approval of that launch scope. Preserve the design requirements for guardians and minors, but do not enroll minors until their dedicated phase and policy review are complete.

Included:

- Responsive interface, proposed initial English and Bulgarian translations, and Unicode-safe names with Chinese aliases.
- Registration, sign-in, account recovery and authorization.
- Separation of login account, person, school, organization and commercial plan.
- Basic profiles, evidence submission and archival records.
- Teacher requests, approval and rejection.
- Multiple active and historical teachers with independent verification and training periods.
- Searchable lineage visualization and a readable list alternative.
- School profiles, radius/lineage filtering and city-only privacy mode.
- Basic Sifu and administrator dashboards.
- Central entitlement rules for all five plans, with test grants where billing is not yet implemented.
- Essential transactional notifications through a test destination.
- Private evidence handling, moderation queue and audit history.
- A protected staging environment, backups and a demonstrated restore.

**Exit condition:** a pilot user can register, find a teacher, submit a request, receive approval, inspect supported relationships and discover an eligible school without private data leakage. A teacher with two active lineages works correctly. An unrelated user cannot approve a claim or access private evidence.

### Phase 2 Paid practitioner and school services

Included:

- Subscription checkout and billing management for approved payment methods.
- Upgrades, end-of-period cancellation, failed-payment handling and safe downgrade.
- Full passport, ranks, skills, exam records and private/public certificates.
- Server-enforced media and approval quotas.
- School activity reminders and hiding/restoring stale pins.
- Event calendar, Tier 3 publishing limits and premium notifications.
- Trial lesson inquiry flow and basic school analytics.
- Complete lifecycle notifications and quota prompts.

**Exit condition:** test payments and duplicate, delayed or out-of-order provider events cannot grant duplicate benefits, remove valid history or cancel another account. Downgrade retains existing records and applies the approved visibility policy. No real charge is necessary for these tests.

### Phase 3 Organizations, guardians and governance

Included:

- Federation application, review, scoped administration and bulk import.
- Trial setup, 14/7-day reminders and expiry without a card.
- Organization analytics and heatmap.
- Independence of child school/student subscriptions from federation billing.
- Organization separation rules, if approved.
- Guardian verification, child profiles, adult payer and parent dashboard.
- Age-appropriate privacy and approved jurisdiction rules.
- Succession nomination, acceptance and administrator review.
- Dispute procedures, appeals and protected historical stewardship.

**Exit condition:** imports cannot silently authenticate a person or bypass teacher approval; an organization cannot edit another organization's data; a lapsed federation leaves paying schools and students active; a guardian can manage only linked children; inactivity alone never transfers ownership or marks a person deceased.

Some governance foundations already belong in Phase 1. This phase expands them; it does not defer basic authorization, privacy or moderation until later.

### Phase 4 Publishing and commerce

Included:

- Lineage certificate and poster generation from an issued snapshot.
- Serial-number and QR lookup, current status and revocation/correction behavior.
- Country almanacs, lineage monographs and federation editions.
- Publication consent, media rights and print layout checks.
- Physical product workflow after a fulfillment partner and terms are established.
- Sifu product profiles and organization catalogs.
- Marketplace transactions only after seller onboarding, permitted products, refunds, fees and country coverage are settled.

**Exit condition:** an issued artifact maps to its actual snapshot and current validity; unresolved claims are not silently certified; revoked publication consent prevents new editions; orders and seller payouts follow the approved accounting flow.

### Phase 5 Community and social distribution

Included:

- Private birthday greetings and optional homepage display.
- Community greeting interaction with spam limits.
- Master of the Day and other fair rotation rules.
- Approved event announcements, weekly digests and media adaptation.
- Social connections validated channel by channel.
- Branded feature cards sent only after confirmed publication.
- Launch copy, video brief and campaign assets reflecting actual readiness.

**Exit condition:** withdrawn consent, ineligible age, unapproved media or disputed claims exclude a record before publication; retries do not duplicate posts; failures are visible; congratulatory cards link to actual published content.

The source's marketing and publishing features remain in the roadmap even though the first release is narrower. Deferring them is a proposed sequencing decision, not deletion of requirements.

## 3. Agent team and responsibilities

Use **four core agents including the coordinator**, with no more than three specialist agents working alongside the coordinator. This matches the four active-agent slots available in this session. The agents remain part of this project chat; separate user-owned chats are not required.

| Agent | Roles | Preparation deliverables | Implementation ownership later |
| --- | --- | --- | --- |
| Coordinator — this chat | Product lead, delivery lead and integrator | Scope, decision register, backlog, dependencies, working instructions and readiness report | Shared contracts, integration, final review and owner communication |
| `domain_backend` | Domain modeler, backend engineer and billing/integration engineer | Data model, verification and entitlement rules, architecture options, API contracts and service requirements | Backend, persistence, authentication integration, lineage logic, billing and job processing |
| `experience_frontend` | Product designer, frontend engineer and localization editor | User journeys, screen inventory, wireframes, design tokens, language/content inventory | Interface, graph/map presentation, forms, accessibility and translations |
| `quality_operations` | Independent QA engineer, security/privacy reviewer and release engineer | Risk review, acceptance tests, authorization matrix, test strategy and recovery/release runbooks | Independent testing, security checks, staging configuration, observability and recovery verification |

Publishing and growth work do not require permanently idle agents. In their later phases, the coordinator assigns scoped document/design tasks to the experience agent, rendering and integration tasks to the backend agent, and artifact/release review to the quality agent. Add a separate specialist only if a concrete workload justifies it and capacity permits.

### Human responsibilities

- **Project owner:** product decisions, authentic personal records, budgets, domain ownership and business priorities.
- **Existing programmer, if active:** share current code and implementation decisions; agree on change ownership with the coordinator.
- **Wing Chun archivists or trusted reviewers:** assess disputed lineage evidence and historical claims.
- **Qualified legal reviewer:** approve jurisdiction-specific child-data, subscription, copyright and marketplace policies.
- **Print or fulfillment partner:** validate print requirements, shipping and physical security features when that phase begins.

Agents can prepare research, evidence and drafts for these people. They cannot turn an unverified lineage into fact or provide an authoritative legal sign-off.

### First assignments after approval

**Domain agent:** read the specification, review D02–D14 and D20–D25, and propose the smallest data/authorization model that supports multiple teachers, historical records and independent billing. Compare the source's Neo4j plus PostgreSQL architecture against a simpler single-store approach through documented requirements; do not install either yet.

**Experience agent:** map the visitor, student, Sifu and administrator journeys for Phase 1; define how uncertainty, privacy and multiple teachers appear; prepare English/Bulgarian screen and content structure using fictional fixtures.

**Quality agent:** independently review the source conflicts, map failures to acceptance scenarios, and define boundaries for private evidence, administrative permissions, minors, subscriptions, certificates and social consent. Produce a readiness review rather than a claim that unbuilt software has passed tests.

**Coordinator:** combine these outputs, settle routine choices, maintain the decision register, and raise only questions that materially block readiness.

## 4. Skills and tools

An agent is a worker with a responsibility; a skill is reusable guidance for a particular workflow. Keep skills focused and load them only when the task needs them. Official OpenAI guidance recommends clear independent subagent tasks and coordination when agents edit shared files; skills supply workflow instructions and resources. See [multi-agent guidance](https://developers.openai.com/api/docs/guides/agents-api/multi-agent) and [skills concepts](https://developers.openai.com/plugins/concepts/skills).

### 4.1 Available skills to use as needed

| Skill | Intended use | When needed |
| --- | --- | --- |
| `documents:documents` | Read source Word documents; later create reviewed Word policy or partner materials | Source conversion already used; later document deliverables |
| `openai-docs` | Validate Codex agent/skill setup and any OpenAI-specific implementation | Team preparation; only if OpenAI features are added later |
| `skill-creator` | Create and validate narrow project-specific skills | After plan approval if recurring rules justify them |
| `computer-use:computer-use` | Inspect and exercise the application through supported browser tools | Browser validation when a running application exists |
| `pdf:pdf` | Build and visually inspect lineage certificates, posters and catalogs | Publishing phase |
| `spreadsheets:Spreadsheets` | Create/review import templates and a realistic financial model | Federation preparation and business modeling |
| `imagegen` | Optional brand illustration and campaign image exploration | Design/growth work requiring raster artwork |
| `visualize:visualize` | Optional interactive explanation or prototype for a complex decision | When it helps the owner assess graph or workflow behavior |
| `sites:sites-building` and `sites:sites-hosting` | Website creation and hosting through Sites if that is the chosen project path | Read before a Sites build or deployment; not selected merely by this plan |

Standard coding, schema design, localization and testing use the agents' engineering capabilities and official framework documentation; a new plugin is not required for every role. No plugin installation is required to prepare the plan. External integrations can use approved service APIs later, once accounts and scope are established.

### 4.2 Proposed project-specific skills

Create only the workflows that prove useful during preparation, using `skill-creator`. These are proposed skills, not currently installed capabilities.

| Proposed skill | Content | Intended users |
| --- | --- | --- |
| `wingchun-lineage-review` | Evidence provenance, independent teacher approval, parallel relationships, historical uncertainty and dispute handling | Domain, quality and coordinator |
| `wingchun-entitlements` | Five-plan matrix, server authorization, quota boundaries, downgrade preservation and federation independence | Domain, frontend and quality |
| `wingchun-publication-review` | Consent, guardian restrictions, media rights, certificate scope and publication verification | Domain, experience and quality |

Put simple one-off decisions in the specification or `AGENTS.md` rather than creating a skill for each feature. A generic “developer,” “designer” or “tester” skill adds little value.

## 5. Technical preparation decisions

### 5.1 Architecture baseline

Use the source stack as a candidate, not a commitment: a responsive React/Next.js application, PostgreSQL for accounts and transactions, a lineage graph represented through a deliberate storage model, private media storage, background jobs, maps and provider-hosted billing.

The key decision is whether the first release needs a separate Neo4j database. Preparation must compare query needs, consistency, operational cost, backup/restore and developer familiarity. Multi-teacher relationships require a graph-shaped domain; they do not by themselves settle the database product.

A short implementation spike belongs to later authorized execution. During preparation, document the alternatives, benchmark plan and recommended decision without claiming unrun performance results.

### 5.2 Boundaries that should hold under either architecture

- Login identity is separate from the historical person record.
- A person's training relationships are separate from organization membership.
- Verification is separate from paid status and brand administration.
- Private evidence is separate from public profile media.
- Subscription ownership is separate from a guardian-managed beneficiary.
- Teaching history survives subscription expiry and administrative separation.
- Certificate issuance records a defined snapshot instead of relying only on a mutable profile.
- Publication consent and delivery records are explicit and reviewable.
- Any two-database design defines a source of truth, retry behavior and reconciliation process.

### 5.3 Service selection

Before integrating, check current official documentation, eligibility, recurring-payment support, licensing and cost for each selected service. Do not assume all payment methods, map usage, social post types or video hosting features are available in one plan.

Confirm a spending limit before any paid resource is created. Use local or test substitutes during development where practical. Real social publishing, outreach, domain purchases and paid advertising require explicit instructions for those actions.

## 6. Files to prepare after approval

The following structure is proposed. These files and directories have not yet been created. Adapt it to any existing implementation rather than replacing a working project structure.

```text
AGENTS.md
README.md
docs/
  decisions.md
  backlog.md
  architecture.md
  data-model.md
  authorization-and-entitlements.md
  api-contracts.md
  design/
    journeys.md
    screens.md
    content-and-localization.md
  quality/
    acceptance-criteria.md
    test-strategy.md
    privacy-and-security-review.md
  operations/
    services-and-access.md
    staging-and-release.md
    backup-and-restore.md
  agents/
    domain-backend.md
    experience-frontend.md
    quality-operations.md
  execution-readiness.md
```

The coordinator owns shared decisions, backlog and contracts. During preparation the domain agent owns its architecture/data drafts; the experience agent owns design documents; the quality agent owns quality/operations drafts. Each agent proposes changes to shared files through the coordinator.

Repository instructions will identify source precedence, approved scope, ownership, validation commands once known, and requirements for preserving private data. Agent briefs will include inputs, outputs, dependencies and what counts as done. Proposed skill folders will use the supported project skill location verified during setup.

Do not initialize a replacement repository or scaffold application code until the existing programmer's work has been accounted for. No remote repository, project board or paid service is necessary just to make these preparation files reviewable.

## 7. Backlog format and initial work packages

Each work item records its requirement reference, phase, owner, dependencies, acceptance criteria, status and review evidence. “Done” means the relevant behavior has been checked, not merely that code was written.

| Package | Main dependency | Owner | Completion evidence |
| --- | --- | --- | --- |
| Foundation and access | Existing code inventory and stack decision | Coordinator + domain | Clean setup instructions and authorization boundaries |
| Profiles and languages | Identity/person model | Experience + domain | English/Bulgarian flows and alias/name tests |
| Verification and lineage | Evidence policy and relationship model | Domain | Independent approvals, historical and parallel-teacher scenarios |
| Graph and map | Stable read contracts and privacy rules | Experience | Mobile/desktop browsing, keyboard access and private-address checks |
| Billing and quotas | Approved plans and merchant setup | Domain | Lifecycle, replay, downgrade and quota tests |
| Passport and events | Verified identity/relations and entitlements | Domain + experience | Complete user journeys and visibility tests |
| Federation and import | Scoped organization permissions | Domain | Dry run, row errors, duplicate and authority checks |
| Guardians and succession | Approved policy and review workflow | Domain + quality | Boundary, consent and transfer tests |
| Publishing and marketplace | Rights, billing and operating model | Domain + experience | Reviewed artifacts and test order lifecycle |
| Social and birthdays | Consent, moderation and provider capability | Domain + experience | Dry-run selection, retry and actual-publication checks |
| Release and recovery | Passing feature checks | Quality + coordinator | Restore drill, release checklist and rollback path |

Agents may work in parallel only after their shared contracts are stable enough. A frontend mock can use fixtures while the backend is built, but mock behavior is not evidence that a real integration works.

## 8. Acceptance and quality gates

### 8.1 Domain correctness

- Two active Sifus can independently approve one practitioner, including across lineages.
- Historical training remains visible according to policy after a teacher change.
- Self-relationships, duplicate claims and unintended cycles are handled explicitly.
- Approvals and archival edits record who acted and on what evidence.
- Disputed or uncertain history is labelled appropriately.

### 8.2 Access and privacy

- Direct API calls cannot bypass quotas or permission checks.
- Exact private addresses, birth dates and private documents do not appear in public responses.
- One organization or guardian cannot manage unrelated records.
- Revoked consent blocks pending publication as well as new scheduling.
- Evidence and media uploads enforce approved type, size and access restrictions.

### 8.3 Billing and state changes

- Duplicate and reordered provider notifications are safe.
- Cancellation respects the paid-through date.
- Failed payment follows the approved retry/grace policy.
- Federation expiry does not reduce independently paid student or school benefits.
- Downgrade does not erase training history or previously verified relationships.
- Media and student-approval limits hold under concurrent requests.

### 8.4 Interface and localization

- Registration, teacher requests and school discovery work on mobile and desktop.
- Keyboard and touch interaction cover behavior otherwise described as hover-only.
- Status is understandable without relying on color alone.
- Empty, loading, denied, error and retry states are designed and tested.
- Cyrillic, Latin, Chinese characters and long names display correctly.
- Dates, event times and messages follow the selected locale and time zone.

### 8.5 Operations

- A clean environment can be set up from written instructions.
- Test and live keys and data are separated.
- Administrators use two-factor authentication.
- A backup has actually been restored and its relationships checked.
- Logs identify failures without exposing secrets or unnecessary personal data.
- Jobs can retry safely and failed deliveries are visible.
- Before launch, define measurable performance, availability, recovery and support targets based on the pilot workload.

The three-week source beta remains a useful user exercise, but it supplements these checks. It is not a substitute for authorization, billing and recovery testing.

## 9. Owner decisions and dependencies

These do not all need answers before the agents can prepare their documents. The coordinator should gather them in one concise decision request after the first independent preparation outputs make the tradeoffs concrete.

| Decision | Proposed default or required information | Blocks |
| --- | --- | --- |
| Existing code | Locate the engaged programmer's repository, branch and current work | Application scaffold and overlapping code changes |
| First-release scope | Phase 1 adult pilot, then the sequence above | Final backlog baseline |
| Initial languages | English and Bulgarian UI; Unicode/Chinese aliases from the start | Final copy and localization acceptance |
| Pilot data | Five to ten adult volunteers; owner-confirmed Sifu details and evidence | Real pilot import; fictional fixtures can proceed |
| Geography and business | Operating entity, merchant country, intended launch markets | Live payments and public policies |
| Budget | Monthly service ceiling and any paid development/design limits | Paid provisioning |
| Prices | Approve or revise the proposed tier prices, annual rate and seller model | Live billing configuration |
| Governance | Who can verify historical claims, decide disputes and approve succession | Public verification operations |
| Children and guardians | Approved market-specific policy; resolve promotion exclusion | Enrollment of minors |
| Hosting and domain | Existing assets and deployment preference | Public deployment |
| Historical/publication rights | Approved sources, photos, signatures and partner logos | Real seed data and published artifacts |

Routine reversible preparation should continue while these answers are pending. Do not invent missing account credentials, biography, prices or legal approvals to make a checklist look complete.

## 10. Effort and completion expectations

Do not carry over the source's $5,200–$7,600 and approximately two-month estimate as a promise for the expanded project. Preparation should produce milestone estimates only after the existing code, first-release scope and service choices are known.

Use the source's three-week pilot as an initial coordination proposal with real participants, not a guaranteed engineering schedule. Multi-agent work helps independent design, implementation and review; it does not remove dependencies between data contracts, features, integrations and operational testing.

The preparation report will list:

- Decisions completed and remaining.
- Agents and skill files actually created.
- Deliverables and their review status.
- First implementation tasks that are ready to start.
- External accounts, evidence or policy decisions still needed.
- A clear distinction between prepared, implemented, tested and deployed.

## 11. Approval statement

Suggested approval wording:

> I approve this phased plan and the four-agent team. Create the specialist agents and prepare the project for execution. Use the proposed Phase 1 scope as the planning baseline and flag unresolved decisions before implementation.

This approval starts Phase 0. The next handoff is a reviewable execution package, not a public launch or an unrequested purchase.
