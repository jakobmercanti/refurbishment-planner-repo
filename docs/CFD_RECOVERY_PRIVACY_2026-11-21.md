# CFD setup recovery and privacy review

## Implemented

- IndexedDB remains the first save destination, scoped to the signed-in account. Pending local edits are flushed before explicit sign-out. A stale guest draft no longer displaces newer account work.
- A single optional account recovery document stores the latest project containing CFD studies, including geometry, scenarios, HVAC/insulation inputs, electrical layouts, quotes, work programmes and notes. It is separate from paid cloud project storage. No model binaries, electrical image binaries, CFD result files, passwords or session tokens are uploaded through this feature.
- The browser reads recovery before writing and compares project timestamps. Recovered documents are schema-validated; the prior local project is retained. Serialized writes use server revisions, pause on conflict, and preserve local edits on network/authentication/storage errors. Account changes are checked before and after authenticated requests.
- `/commercial/resume` accepts only a server-verified account. Identity comes from the bearer token, never a request-supplied user ID. Existing bounded project validation applies; requests are capped at 9 MiB and documents at 8 MiB. Responses are private/no-store. SQL tables/functions are denied to anonymous/authenticated direct clients; only the server service role can use them.
- Privacy and local saving provides a recovery switch, document download and deletion. Deletion erases the document immediately and keeps only a revision tombstone to reject stale writes. The record cascades on account deletion. Recovery expires after 180 days without a save; a daily database cron purges expired rows, including tombstones.
- Solar exposure is off by default. Turning it on selects a labelled clear-sky estimate when no solar forcing was configured. Simplified Solis uses reference aerosol optical depth 0.1 and precipitable water 1 cm, with site elevation pressure and date-dependent extraterrestrial radiation. It is not observed weather. EPW/manual forcing remains available. Irradiance is independent of U-value/heat-balance validation; night-time zero is intentional. CFD execution remains subject to the worker's thermal solver capability.

## Deployment requirements

Apply `database/migrations/202611210001_planner_resume.sql` to the intended Supabase database with a migration administrator, then deploy the backend and frontend together. The migration enables `pg_cron` and schedules `purge-planner-resume` at 03:17 UTC daily. Confirm the job succeeds and alert on failures. Until the migration/backend rollout is complete, local saving remains available and the UI reports that cloud recovery is unavailable.

The current execution environment has no database administrator connection or Supabase management credential. This migration, production RLS state, hosting region, backup retention and the cron execution have **not** been verified or applied to the live database. The local backend health endpoint responds, but the browser's account/worker entitlement check was unavailable, preventing inspection inside the signed-in CFD workbench.

Document downloads contain the project JSON, not its separately stored binaries. Full `.floorplan3d` packages remain available from File. On another device, recover model/image assets separately; account recovery is not a replacement for a complete package backup.

## Data inventory and remaining operator actions

This is a technical review, not certification of UK GDPR or EU GDPR compliance. The ICO requires technical **and organisational** measures throughout processing, and documented decisions about purpose, minimisation and retention. The operator must complete and maintain:

- A processing register covering Supabase authentication/contact information, account recovery, paid cloud documents, private R2 assets/results, worker geometry/jobs, billing records, hosting/security logs and optional analytics/advertising. Existing cloud-project deletion clears its document payload; private model deletion removes stored objects. Financial records may have separate statutory retention.
- An accurate public privacy notice identifying the controller/contact, purposes and lawful bases, recipients, recovery behaviour, retention (including backup expiry), rights and the route to request access, rectification, restriction, portability and account-wide erasure. The new recovery controls erase only that copy; they must not be described as erasing the whole account.
- Processor agreements, subprocessor review, actual storage/backup regions and any UK/EU transfer mechanism/transfer-risk assessment for Supabase, Cloudflare, Railway, payment and analytics providers. A vendor name or selecting a UK region alone does not establish compliance.
- A justified retention schedule for all stores and logs, verified backup rotation, and an erasure runbook that covers R2/worker jobs and billing/legal exceptions when an account is removed. Cascade deletion of the recovery row alone does not purge those independent stores.
- Documented access review, MFA for administrators, credential rotation, encryption/TLS verification, restore/breach-response exercises, incident reporting, data-subject request handling and DPIA/children's-service assessment where applicable. Confirm whether an ICO data-protection fee is due.
- Browser/device guidance: account databases remain on the device for recovery and offline use. Sign-out removes the session and hides the prior account but is not a device wipe. Shared-device users should export needed work and clear site storage through browser controls.

Do not advertise the service as fully compliant until the controller has verified these operational and legal requirements.

## Sources

- [ICO: data protection by design and default](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/) (updated February 2026, including DUAA changes).
- [ICO: storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/).
- [ICO: processor contracts](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/contracts).
- [ICO: international transfers](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-brief-guide-to-international-transfers/).
- [Supabase: Cron installation](https://supabase.com/docs/guides/cron/install) and [scheduling](https://supabase.com/docs/guides/cron/quickstart).

## Validation

No tests, new mesh jobs or solver runs were executed, as requested. Validation is limited to source review, TypeScript, frontend lint/source checks and Python lint/syntax checks. Deployment and signed-in visual verification remain outstanding as described above.
