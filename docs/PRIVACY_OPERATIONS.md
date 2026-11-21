# Privacy operations

Operator: JKM Property Investments Ltd, company 14362436.
Public contact: info@freefloorplan3d.com.
Release evidence and unresolved owner decisions are recorded in
[the deployment record](PRIVACY_DEPLOYMENT_2026-11-21.md). Keep customer records,
credentials, identity evidence and deletion manifests outside this repository.

## Processing inventory and retention

- Browser projects: geometry, scenarios and any local customer records remain in
  account-scoped IndexedDB until removed by the user/browser. Sign-out removes
  authentication, not local project data. Full exports can include private fields.
- Supabase authentication: account ID, email and authentication/security records
  support access and security. Account closure requires a separate verified
  erasure request; deleting a recovery copy is not account closure.
- Supabase recovery: one minimised document per account, revision marker and
  account-wide preference. Document/marker expiry is 180 days after the last
  write, followed by the next daily purge; reads exclude expired content. User
  deletion clears the payload immediately and disables writes across devices.
  The preference remains until changed or account closure.
- Paid cloud projects: minimised documents remain until deletion/account closure.
  Private assets and generated outputs are independent R2 objects; database
  cascade deletion does not remove them. Track object keys before removing rows.
- CFD worker: measured geometry/configuration/results expire at the selected job
  deadline, at most three days. Cleanup retains small account-linked usage and
  idempotency records. Review their necessity at account closure; financial or
  abuse-prevention exceptions require a recorded basis and review date.
- Enquiries: maximum 30 days from receipt, including related copies under the
  operator's control. Use the private retention script and label ordinary/renamed
  email enquiries `FFP3D-Enquiry` on receipt. A new reply never renews an older
  message's deadline. Document restricted legal holds separately.
- Optional action counts: consent is off by default and expires after 180 days.
  Only allowlisted aggregate events reach PostHog US with a constant aggregate
  identifier; no end-user identity/content is forwarded. Account-specific event
  retention/settings still require verification. Do not claim global anonymity.
- Optional advertising: public website only, prior opt-in. Provider advertising
  retention and international processing remain distinct from project recovery.
- Hosting records: Cloudflare delivery/security and Railway edge records are
  separate from application data. Persisted Worker logs/traces and Railway
  service tracing are off as verified on 21 November. Railway states that logs
  are stored for 90 days even when the plan's viewing window is shorter; early
  individual deletion/redaction is unavailable. Supabase Free API/database logs
  have a one-day published viewing/retention allowance, not proof that all
  provider-internal security or recovery records expire then.

This inventory describes the software's processing. The owner clarified on
21 November that the wider property records are paper-only, correcting an initial
electronic-processing answer. That does not remove the website's electronic
account/enquiry processing or establish an ICO fee exemption. Keep structured
paper files locked, restrict access, apply a justified retention schedule and
secure disposal, and include relevant files in rights/incident handling.
Review whenever a provider, feature, purpose, retention period or region changes.

## Daily and monthly controls

The mailbox/account administrator is responsible for the daily check; the
operator is accountable for arranging cover.

1. Check Apps Script Executions and `lastSuccessfulRun`. A missing successful
   enforcement run for over one hour requires investigation. Verify the 15-minute
   trigger and immediate failure notifications. Resolve errors, preview the
   actual candidate scope, then purge the authorised overdue backlog. Do not
   collect message bodies or addresses in the audit evidence.
2. Triage unlabelled ordinary enquiries and renamed/forwarded replies on receipt.
   Review Sent, Spam, Trash, forwarding destinations and local copies. Automation
   in one mailbox cannot erase independent exports or another recipient's mail.
3. Check `purge-planner-resume` in Supabase cron history after 03:17 GMT. Investigate
   a failed or missing daily execution. Verify metadata/counts before manually
   retrying a purge; do not copy live documents into diagnostic logs.
4. Monthly, review administrator memberships/MFA, token owners/scopes, legal
   holds, pending rights requests, actual provider contracts and subprocessor
   notices. Remove access when no longer needed. Rotate a credential immediately
   on suspected disclosure; never commit keys or auth headers.

## Rights requests and account erasure

1. Register receipt and response deadline privately using a random case ID. Use
   the existing authenticated account or a proportionate identity check; do not
   routinely request identity documents. Identify requested rights and scope.
   Target a response within 28 days to meet the normal one-month legal deadline.
   Record any justified extension/exception and inform the requester in time.
2. For access/portability, collect only that account's records across Supabase,
   private R2 assets/outputs, Railway CFD jobs, billing provider and enquiry
   correspondence. Include relevant purposes, recipients and retention details.
   Review third-party information before delivering securely to the verified
   requester. Recovery download alone is not a complete account export.
3. For erasure, first record any lawful restricted exception and its review date.
   Disable recovery writes. Suspend access and revoke sessions while collecting
   a private, account-scoped manifest of job IDs and stored object keys. Cancel
   active background jobs and wait for terminal state to avoid recreation.
4. Remove requested cloud project content using the account-scoped project
   deletion path. Remove assets through the existing asset deletion path and
   confirm object deletion completed; a soft-deleted database row is insufficient.
   Include render outputs and temporary reference objects recorded in upload/job
   rows, including expired/failed reservations. Verify ownership of every key.
   Do not erase rows before collecting independent object keys.
5. Clear CFD results for every affected project/study with the authenticated
   clear-results operation. It refuses active jobs and reports incomplete file
   cleanup. Retry failures rather than treating hidden content as erased. For
   full account closure, review and remove independent worker ownership/usage
   records using the worker administrator after resolving any justified exception.
6. Remove the Supabase authentication user only after independent objects/jobs
   have been addressed. The schema cascades account-linked rows, including
   recovery/preferences; it does not cascade external storage. Revoke residual
   provider access. Handle billing/legal records under the documented exception,
   separated from optional service/marketing data.
7. Check zero remaining in-scope content/objects and paused jobs, using counts
   and ownership metadata. Record result, date, systems, exceptions and any
   provider limitation privately. Explain those limitations in the response.
   Tell shared-device users that site data and their downloaded copies must be
   cleared on their own device if they also want local removal.

No real customer's account was deleted as an audit exercise. Destructive action
requires a verified request and explicit approval for its concrete scope.

## Backups and restoration

The authenticated Supabase Free Plan page showed no scheduled project backups on
21 November 2026. Do not advertise a managed backup or guaranteed recovery point.
Document provider-internal copy lifetime with the provider; lack of a visible
backup is not evidence that no internal copy exists. Do not buy a backup plan or
export a production database into local development implicitly.

Before any future backup/region migration, record the purpose, encryption,
location, access, expiry and deletion process. Keep an access-restricted erasure
ledger outside backups with the minimal identifiers needed to enforce erasure.
For restoration, isolate the restored system from users/jobs, reapply erasures,
recovery-off preferences, current minimisers and access controls, purge expired
content, then verify counts/permissions before reconnecting. A restored backup
must not silently resurrect deleted data. Document and review any exception.

## Incident response

Contain access, stop the affected write/export path, revoke exposed credentials
and preserve minimal access-restricted evidence. Establish discovery time,
affected data/accounts, recipients and likely impact. Contact the provider's
security channel where needed. The operator records the assessment and remedy,
including incidents that are not reportable. Notify the ICO without undue delay
and within 72 hours of awareness when required; notify affected individuals
without undue delay if the breach is likely to cause high risk. Do not wait for
a complete investigation before an initially required notification. No incident
notification is sent automatically by this repository.

## Contracts, transfers and owner decisions

Retain the controller's registered/trading identity, actual accepted DPA versions
and dates, contracting account, processing scope/regions and subprocessor terms
in the private contract record. An owner's attestation and a public standard DPA
are different evidence. For US processing, document the applicable UK/EU transfer
mechanism and risk assessment, supplementary safeguards, necessity and review.
Do not infer a Workspace DPA merely from a consumer `@gmail.com` account.

Complete the ICO purpose-based fee assessment for all relevant business
processing. Authentication emails, network records and identifying project
labels can be personal data despite field minimisation. The asserted reason
“we don't store customer personal data” does not establish an exemption. Assess
EU representative, children/DPIA and company-disclosure obligations against the
actual business and intended users before making an unqualified legal claim.

## Primary references

- [ICO exemptions and self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee/exemptions/).
- [ICO response timing](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/right-of-access/what-should-we-consider-when-responding-to-a-request/).
- [ICO incident response](https://ico.org.uk/media2/migrated/2614816/responding-to-a-cybersecurity-incident.pdf).
- [Railway log documentation](https://docs.railway.com/observability/logs) and
  [employee clarification on storage versus visibility](https://station.railway.com/questions/can-http-request-logging-be-disabled-or-30c1f581).
- [Supabase plan allowances](https://supabase.com/pricing).
- [Retention installation and failure handling](../deployment/privacy-retention/README.md).
