# Team enquiry retention

This Google Apps Script is restricted to `plannerbuildteam@gmail.com`. It reads
message metadata, not message bodies, and never sends mail or exports mailbox data.
Google requires the full Gmail scope for permanent deletion; `gmail.modify` only
moves messages to Trash and cannot enforce removal by day 30.

Install `enquiry-retention.gs` and `appsscript.json` in a private Apps Script project
owned by the team mailbox. Run `previewRetention`, review the counts, then approve
`enableThirtyDayRetention` only after the operator has accepted permanent deletion.
This installs a 15-minute trigger and runs the first purge. `disableRetention`
stops future purges; it cannot recover deleted messages. No web app is deployed.
Activation also creates the enquiry and legal-hold labels if missing.

The form's `[FreeFloorplan3D]` subject prefix and team addresses identify form
messages and their replies. Ordinary enquiries received by email must be labelled
`FFP3D-Enquiry`; apply that label on receipt, including forwarded/renamed enquiries.
Reply references inherit an earlier enquiry deadline when the parent is present.
Each message is evaluated separately, including Sent, Archive, Spam and Trash;
unrelated messages in the same conversation are not purged merely by thread ID.
Receipt times never reset when a thread receives a newer reply. No durable
customer/message-ID register is maintained. Copies arriving after an ancestor was
purged are bounded by their own receipt date and must retain the enquiry label or
subject prefix to be discovered.

`FFP3D-Retention-Hold` excludes a message and linked descendants for a documented
legal exception. Review holds and their legal basis regularly. Do not use a hold
to extend routine enquiry retention. The normal cutoff includes the final hour
of the 30-day maximum to allow scheduler delays/retries. Google outages, quotas
or disabled triggers still require operator intervention: check Executions and
`lastSuccessfulRun` daily, set immediate trigger-failure notifications, and purge
any backlog after resolving a failure. A script alone does not prove enforcement
of mailbox copies, forwarding destinations, local exports or provider backups.

No tests or synthetic enquiries are needed: preview is a metadata-only audit of
the actual mailbox. Preserve aggregate execution evidence without copying enquiry
content into the repository. Current activation/evidence is recorded in
`docs/PRIVACY_DEPLOYMENT_2026-11-21.md`.

References: [Gmail deletion scope](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/delete),
[advanced Gmail](https://developers.google.com/apps-script/advanced/gmail),
[scheduled triggers](https://developers.google.com/apps-script/guides/triggers/installable).
