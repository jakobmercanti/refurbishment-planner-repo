# Account recovery and privacy release — 21 November 2026

## Scope and evidence

This record covers the recovery-storage release, data minimisation, account-data
access controls, optional analytics and enquiry retention. It records verified
technical evidence separately from operator statements. It is not a certification
of all legal or operational obligations.

The operator is **JKM property investments**. Existing public address/contact
details and the **30-day maximum enquiry retention** remain unchanged.

## Recovery storage

Production project: Supabase `rlpofstbysqtmntfmnjf`, Frankfurt (`eu-central-1`),
verified in the authenticated project settings. Before this release,
`planner_resume`, `planner_privacy_settings` and the recovery RPCs did not exist.
The live `cloud_projects` table contained zero documents.

Applied through the authenticated SQL editor:

- `202611210001_planner_resume.sql`: private per-account recovery documents,
  revision checks, deletion tombstones, expiry and daily purge.
- `202611210002_recovery_privacy.sql`: account-wide preference; disabled accounts
  cannot write, including from another device. Deletion also disables recovery.
- `202611210003_cloud_data_minimisation.sql`: sanitising write triggers for both
  recovery and paid project documents, plus removal of direct browser execution
  privileges from the auth profile trigger function. Both document tables were
  empty immediately before this migration; no customer documents were erased.

`202611210004_private_hvac_snapshots.sql` is prepared but **not yet applied**.
It excludes historical HVAC packages whose embedded JSON strings could otherwise
retain free-text notes. Current measured inputs and shared scenarios remain in
recovery. Review affected document counts before applying any redaction to an
existing dataset.

The first migration returned cron job ID `1`, schedule `17 3 * * *`, invoking
`public.purge_planner_resume()`. A final metadata verification of table grants,
function execution permissions, write triggers and active cron state was submitted
but has not yet been read. Do not blindly rerun already-applied migrations.

The schema enables RLS, removes `PUBLIC`, `anon` and `authenticated` table/RPC
access, and grants only the server service role access. The server verifies the
bearer session and derives the account ID; the caller cannot supply another
account's ID. Writes use revision checks and per-account transaction locks.
The preference survives payload expiry so an old device cannot bypass a deletion
simply by waiting for a tombstone to expire. No service-role key enters the browser.

Payloads expire after 180 days without a save; reads exclude expired documents,
and the daily job removes expired rows. User deletion removes the payload at once.
A minimal on/off preference remains until changed or account closure.

## Data minimisation and local preservation

Cloud project copies keep geometry, shared scenarios and technical heating,
ventilation and insulation inputs. Known customer/contact fields and narrative
notes are blanked; quotation records, work programmes, electrical records,
annotations and historical HVAC packages stay local. Browser and server filters
apply before upload/storage, and database write triggers protect against older
API writers. The snapshot filter requires migration 004 for database enforcement.

When cloud inputs are restored into the same local project, local private fields
are preserved by entity ID. Full downloaded project files may contain those local
records; users must protect their downloads. Imported model/image binaries and
CFD results are separate from the recovery document. Paid cloud copies are also
separate from automatic recovery and follow the same minimisation boundary.

This is **not anonymisation**. Account emails/IDs, security and usage records,
technical locations, names/labels and information a user embeds in other fields
can still identify a person or property. Field filtering cannot prove that no
personal data exists. The service must not claim otherwise. Local IndexedDB is
not wiped on sign-out; the notice explains shared-device precautions.

## Analytics, notices and access controls

- Action counts are off by default. Explicit, versioned opt-in expires after
  180 days; rejection and legacy rejection are respected. Withdrawal is immediate.
- The existing relay accepts fixed aggregate events, does not forward browser
  identifiers/headers or project content, and disables PostHog person processing.
  Provider network/security records remain distinct from those event contents.
- Google advertising tags were removed from the planner. Its CSP excludes Google
  advertising destinations; public-site advertising remains behind consent.
- Recovery and preference routes are allowed through the production same-origin
  proxy, with authentication, origin checks and bounded request bodies.
- The proxy marks all account responses `private, no-store`, including early
  authentication errors. The live recovery authentication gate returned 401 with
  this header after publication.
- Public notices now describe account recovery, cloud copies, retention, relevant
  lawful bases, providers/transfers, local storage and rights-request contacts.

## Deployment evidence

Successful publications (superseding the initial rollout):

- Website Worker `freefloorplan3d`: `9389057c-49fe-4ab3-83d1-0b2698c51205`.
- Planner Worker `freefloorplan3d-planner-test` (production `/planner/` routes):
  `11bbeea7-35ea-4fbe-9658-bc95cf5dadfd` (snapshot filter and account cache headers).
- Original Railway API service `31789d11-d7e6-471c-81bf-665edfb634c2`:
  deployment `f66af749-b218-4749-8b07-b44f6b60a142`, **SUCCESS**, one running
  replica and no recent failures, verified after the pause.

The historical replacement API remains cancelled. Railway API/CFD services are
in the US region; no infrastructure-region migration was attempted. Live checks
confirmed API health, current public privacy copy, planner HTML without Google
advertising tags, and authentication-required responses from the recovery route.
The browser and server snapshot filters are live; database enforcement still
requires migration 004. All account-proxy paths now retain the same private,
non-cacheable response policy.

## Enquiry retention — activation outstanding

The contact form sends to the operator's team Gmail account and includes a
deletion-deadline header. It has no enquiry database and does not log form bodies.
Headers alone are not a deletion mechanism. Read-only mailbox inspection found
form copies older than 30 days, so the existing policy was not fully enforced.
No message content is copied into this record and no messages have been deleted.

`deployment/privacy-retention/` contains a private, team-account-only Apps Script:
metadata-only preview; per-message permanent deletion; related reply handling;
explicit legal holds; aggregate logs; a 15-minute trigger and a one-hour scheduler
margin within the 30-day maximum. It never deletes an entire conversation solely
because one enquiry appears in it. Ordinary enquiries must be labelled on receipt.
Operator triage, failure monitoring, forwarding/exported copies and documented
legal exceptions remain operational responsibilities.

The script is **not installed or enabled**. Its syntax check passed. The Google
Apps Script create-project action failed in the account's multi-login session;
Google documents this limitation. Browser control also became unavailable after
resumption; the desktop fallback also could not access the minimised Chrome window.
Resolve access, upload the reviewed script/manifest, run preview, then
obtain action-time approval for Gmail access and permanent deletion before enabling
the scheduled purge. Moving mail to Trash does not meet permanent deletion at day 30.

## Operator assertions and unresolved evidence

The operator stated on 21 November that provider DPAs/UK transfer terms have been
accepted and that the enquiry policy is enforced. The mailbox finding above is
contrary evidence for the latter. The current Supabase, Railway and Cloudflare
standard DPAs were read; they include international-transfer/UK provisions, and
the Supabase/Railway documents supplement their service agreements. This verifies
available terms, **not** the identity/date/version or completeness of this entity's
accepted agreements. No new agreement was accepted during this audit.

The asserted ICO fee-exemption reason was "we don't store customer personal data".
That is not established by the actual data flows. Record the result of the ICO
purpose-based fee self-assessment or a registration reference before asserting an
exemption. An exemption from the fee would not remove data-protection duties.

Still requiring owner evidence or authenticated verification:

- Applicable provider agreements, customer identity and versions; UK transfer
  assessment/safeguards for actual US processing, and subprocessor change reviews.
- Applicable business processing terms for the `@gmail.com` mailbox; do not
  assume a Google Workspace DPA or Vault retention policy applies.
- Actual Supabase backup retention/restore-erasure procedure and administrator MFA;
  no backup configuration or MFA change was made or claimed verified.
- Active provider log/analytics retention settings, rights-request and account
  erasure procedures, incident response and any applicable EU representation duty.
- Active mailbox retention execution evidence and the final database metadata check.

## Validation

Frontend lint/source usage passed (557 modules, no orphans), and the clean
production frontend build passed TypeScript and static export. Website build,
Ruff and relevant Node syntax checks passed. The release was built from a reviewed
HEAD overlay, preserving unrelated changes and excluding credentials/local data.
The follow-up frontend build and lint also passed; the metadata-only retention
script passed its Node syntax check. No production account document was fetched
or used as a test fixture.

**No tests, synthetic accounts, CFD jobs or synthetic enquiries were run.**

## Primary references

- [ICO fee exemptions](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee/exemptions/)
  and [fee self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee-self-assessment/).
- [ICO data protection by design/default](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/).
- [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum),
  [Railway DPA](https://railway.com/legal/dpa),
  [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/).
- [Google Apps Script multi-account limitation](https://developers.google.com/apps-script/guides/projects),
  [Gmail permanent deletion scope](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/delete).
