# Account recovery and privacy release — 21 November 2026

## Scope and evidence

This record covers the recovery-storage release, data minimisation, account-data
access controls, optional analytics and enquiry retention. It records verified
technical evidence separately from operator statements. It is not a certification
of all legal or operational obligations.

The operator is **JKM Property Investments Ltd**, company **14362436**. The owner
supplied that identity and the Companies House overview confirmed it is active,
with registered office **28 Villiers Close, Surbiton, United Kingdom, KT5 8DL**.
The website now distinguishes that office from the existing Shelton Street
correspondence address. The contact email and **30-day maximum enquiry retention**
remain unchanged.

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

`202611210004_private_hvac_snapshots.sql` was also applied. It excludes historical
HVAC packages whose embedded JSON strings could otherwise retain free-text notes.
Current measured inputs and shared scenarios remain in recovery. The immediate
preflight found zero recovery documents, cloud documents or snapshot-bearing
documents; no customer content was erased by this migration.

Final authenticated metadata verification confirmed RLS on both recovery tables,
no anonymous/authenticated SELECT grants, no publicly executable unsafe
security-definer functions, both minimising write triggers and active cron job
`purge-planner-resume`, schedule `17 3 * * *`, timezone GMT. The snapshot filter
is present in the database minimiser; only service_role can execute that helper.
Do not blindly rerun already-applied migrations. A scheduled execution after this
installation has not yet been observed.

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
API writers. Migration 004 now enforces the snapshot exclusion in the database.

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

- Website Worker `freefloorplan3d`: `e4437049-b594-4d77-af0a-966a44d40609`
  (company disclosures plus verified retention/backup wording; supersedes `86fb2525`).
- Planner Worker `freefloorplan3d-planner-test` (production `/planner/` routes):
  `11bbeea7-35ea-4fbe-9658-bc95cf5dadfd` (snapshot filter and account cache headers).
- Original Railway API service `31789d11-d7e6-471c-81bf-665edfb634c2`:
  deployment `a9cadff6-ceb0-4b30-ba67-9f46c4861f82`, **SUCCESS**, one running
  replica and no recent failures, verified after the pause.

The historical replacement API remains cancelled. Railway API/CFD services are
in the US region; no infrastructure-region migration was attempted. Live checks
confirmed API health, current public privacy copy, planner HTML without Google
advertising tags, and authentication-required responses from the recovery route.
The browser, server and database snapshot filters are live. All account-proxy paths retain the same private,
non-cacheable response policy.

Follow-up code review found that asset deletion swallowed private storage errors
and still returned success. The API now reports incomplete deletion as 503 and
keeps the existing object keys/cleanup marker for the commercial worker retry.
Only successful object removal records `objects_deleted_at`. Namespace-invalid
keys also fail closed. No actual customer asset was deleted for verification;
the dedicated worker's runtime schedule is not established by this source fix.

Authenticated Cloudflare overview pages show persisted Workers Logs and Workers
Traces **disabled** for both published Workers. Railway's connector confirms
tracing **off** for the API and CFD worker. These switches do not disable provider
edge/security records. Railway's published employee clarification distinguishes
90-day log storage from the shorter plan-dependent viewing window; individual
edge records cannot be redacted or deleted early. Do not describe a dashboard's
viewing window as proof of deletion.

The authenticated Supabase Backups page explicitly states that the Free Plan
does not include project backups. No scheduled project backup is configured;
this does not establish the lifetime of the provider's internal recovery copies.
No paid backup plan was purchased. The owner completed administrator MFA setup.
Follow-up authenticated verification found the Supabase authenticator added on
21 November and Cloudflare's **Two-Factor Authentication Active** indicator.
No authentication seed or recovery code was accessed or copied.

## Enquiry retention — active and verified

The contact form sends to the operator's team Gmail account and includes a
deletion-deadline header. It has no enquiry database and does not log form bodies.
Headers alone are not a deletion mechanism. Read-only mailbox inspection found
form copies older than 30 days, so the existing policy was not fully enforced.
No message content is copied into this record. The authorised purge described
below subsequently removed the expired form copies.

`deployment/privacy-retention/` contains a private, team-account-only Apps Script:
metadata-only preview; per-message permanent deletion; related reply handling;
explicit legal holds; aggregate logs; a 15-minute trigger and a one-hour scheduler
margin within the 30-day maximum. It never deletes an entire conversation solely
because one enquiry appears in it. Ordinary enquiries must be labelled on receipt.
Operator triage, failure monitoring, forwarding/exported copies and documented
legal exceptions remain operational responsibilities.

The reviewed script and manifest are now installed in the private team-owned
Apps Script project `FreeFloorplan3D enquiry retention`
(`1WGT8RukLWtB7CQ4d1jJZ6n4ZNLFdO1_bRotnOUDuL6RXnCWtNUVKN-GK`). The owner explicitly
approved full Gmail permission and the permanent 30-day enquiry/reply purge,
then completed Google's phone verification. A metadata preview found seven
candidate messages, four matching enquiries, no holds and three expired form
copies. The earlier sender-restricted Gmail search had found only two; header
review established the third was another older contact-form copy. Unrelated
delivery and domain-registration correspondence remained excluded.

The first enforcement completed at **19:43:32 GMT on 21 November 2026**:
three matching expired messages permanently deleted. One Head/time-driven trigger
was verified at **every 15 minutes**, with **immediate failure notification** saved.
Fifteen automatic time-driven runs were subsequently observed as Completed, most
recently the 23:27 GMT run. Script properties confirmed `retentionEnabled=yes`
and a successful scheduled-run timestamp. A separate metadata-only preview at
23:26:25 GMT found four candidates, one matching current enquiry and **zero due**;
it deleted nothing. No customer/message-ID registry is persisted. No public web
app is deployed. External copies, holds, quotas and outages still require the
operator's monitoring process; a successful run does not prove future enforcement.

## Operator assertions and unresolved evidence

The operator stated on 21 November that provider DPAs/UK transfer terms have been
accepted and that the enquiry policy is enforced. Initial mailbox evidence showed
a backlog; that backlog and the missing automation were addressed as above.
The current Supabase, Railway and Cloudflare
standard DPAs were read; they include international-transfer/UK provisions, and
the Supabase/Railway documents supplement their service agreements. This verifies
available terms, **not** the identity/date/version or completeness of this entity's
accepted agreements. No new agreement was accepted during this audit.

The asserted ICO fee-exemption reason was "we don't store customer personal data".
That is not established by the actual data flows. Record the result of the ICO
purpose-based fee self-assessment or a registration reference before asserting an
exemption. The owner subsequently clarified that the wider property business's
tenant/property records are **paper-only**, correcting an initial "yes" to an
electronic-processing question. Do not record that corrected answer as electronic
tenant processing. Manual processing can be fee-exempt, but the website's account
emails, enquiries and security processing remain electronic. Their purposes
still require assessment; paper-only property records do not by themselves
establish an exemption for the entire controller. An exemption from the fee would
not remove other data-protection duties, including relevant structured paper files.

Still requiring owner evidence or authenticated verification:

- Applicable provider agreements, customer identity and versions; UK transfer
  assessment/safeguards for actual US processing, and subprocessor change reviews.
- Applicable business processing terms for the `@gmail.com` mailbox; do not
  assume a Google Workspace DPA or Vault retention policy applies.
- Provider-internal backup lifetime. The absence of scheduled Supabase Free Plan
  backups and both administrator MFA configurations have been verified.
- Account-specific PostHog settings/retention (its browser session is signed out),
  other provider-internal records and any applicable EU representation duty.
- Owner adoption and continuing execution of the rights/erasure, incident and
  monitoring procedures. No real account was erased or breach exercise run.
- A completed ICO fee assessment/reference covering the actual electronic
  website processing and the owner's corrected paper-only property activity.

The operational inventory, rights/erasure handling, restore safeguards and incident
procedure are maintained in `docs/PRIVACY_OPERATIONS.md`. They are operating
instructions, not evidence that an owner-only legal decision or exercise occurred.

## Validation

Frontend lint/source usage passed (557 modules, no orphans), and the clean
production frontend build passed TypeScript and static export. Website build,
Ruff and relevant Node syntax checks passed. The release was built from a reviewed
HEAD overlay, preserving unrelated changes and excluding credentials/local data.
The follow-up frontend build and lint also passed; the metadata-only retention
script passed its Node syntax check. No production account document was fetched
or used as a test fixture.

The follow-up asset-deletion change passed Ruff and Python compilation. The
updated website build passed and its published privacy text was read in Chrome.
The new Railway deployment is healthy. No destructive deletion scenario was run.
The final company-disclosure build and JavaScript syntax checks passed. The live
website footer was read in Chrome and confirmed the company number, registered
office and separate correspondence address. Scheduled-mail execution evidence is
from actual approved operations, not synthetic enquiries.

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
- [Railway employee clarification on edge logs and 90-day storage](https://station.railway.com/questions/can-http-request-logging-be-disabled-or-30c1f581).
- [Companies House company overview](https://find-and-update.company-information.service.gov.uk/company/14362436)
  and [company website disclosures](https://www.gov.uk/government/publications/incorporation-and-names/incorporation-and-names).
