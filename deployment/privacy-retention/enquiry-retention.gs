// Runs only inside the operator's Google Apps Script account. No message bodies are read.
const ENQUIRY_ACCOUNT = 'plannerbuildteam@gmail.com';
const ENQUIRY_DAYS = 30;
const ENQUIRY_LABEL = 'FFP3D-Enquiry';
const HOLD_LABEL = 'FFP3D-Retention-Hold';
const RETENTION_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'References', 'In-Reply-To', 'X-FreeFloorplan3D-Delete-After'];

function previewRetention() { return retention_(false); }

// Run only after reviewing previewRetention and approving permanent message deletion.
function enableThirtyDayRetention() {
  assertMailbox_();
  const labels = Gmail.Users.Labels.list('me').labels || [];
  for (const name of [ENQUIRY_LABEL, HOLD_LABEL]) {
    if (!labels.some(label => label.name === name)) Gmail.Users.Labels.create({name, labelListVisibility: 'labelShow', messageListVisibility: 'show'}, 'me');
  }
  PropertiesService.getScriptProperties().setProperty('retentionEnabled', 'yes');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'purgeExpiredEnquiries').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('purgeExpiredEnquiries').timeBased().everyMinutes(15).create();
  return purgeExpiredEnquiries();
}

function disableRetention() {
  PropertiesService.getScriptProperties().deleteProperty('retentionEnabled');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'purgeExpiredEnquiries').forEach(t => ScriptApp.deleteTrigger(t));
}

function purgeExpiredEnquiries() {
  if (PropertiesService.getScriptProperties().getProperty('retentionEnabled') !== 'yes') throw new Error('Retention is not enabled.');
  return retention_(true);
}

function assertMailbox_() {
  if (Gmail.Users.getProfile('me').emailAddress.toLowerCase() !== ENQUIRY_ACCOUNT) throw new Error('Wrong mailbox: no changes made.');
}

function retention_(erase) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another retention run is active.');
  try {
    assertMailbox_();
    const labels = Gmail.Users.Labels.list('me').labels || [];
    const enquiryLabel = labels.find(l => l.name === ENQUIRY_LABEL)?.id;
    const holdLabel = labels.find(l => l.name === HOLD_LABEL)?.id;
    const threadIds = new Set();
    let pageToken;
    // Broad search is only candidate discovery. Every individual message is checked below.
    do {
      const page = Gmail.Users.Messages.list('me', {
        q: 'in:anywhere {subject:FreeFloorplan3D label:' + ENQUIRY_LABEL + '}',
        includeSpamTrash: true, maxResults: 500, pageToken,
        fields: 'messages(id,threadId),nextPageToken',
      });
      (page.messages || []).forEach(m => threadIds.add(m.threadId));
      if (threadIds.size > 1000) throw new Error('Mailbox review required: candidate volume exceeds the bounded run.');
      pageToken = page.nextPageToken;
    } while (pageToken);
    const messages = [];
    for (const threadId of threadIds) {
      const thread = Gmail.Users.Threads.get('me', threadId, {
        format: 'metadata', metadataHeaders: RETENTION_HEADERS,
        fields: 'messages(id,internalDate,labelIds,payload(headers))',
      });
      for (const message of thread.messages || []) {
        const headers = {};
        for (const h of message.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;
        const received = Number(message.internalDate);
        if (!Number.isFinite(received) || received <= 0) throw new Error('Message date unavailable; review required.');
        const subject = (headers.subject || '').replace(/^(?:(?:re|fw|fwd):\s*)+/gi, '');
        const participants = [headers.from, headers.to, headers.cc].join(' ').toLowerCase();
        const tagged = /^\[FreeFloorplan3D\]\s/i.test(subject)
          && /(?:plannerbuildteam@gmail\.com|info@freefloorplan3d\.com)/.test(participants);
        const selected = tagged || !!enquiryLabel && (message.labelIds || []).includes(enquiryLabel);
        const maximum = received + ENQUIRY_DAYS * 86400000;
        const supplied = Date.parse(headers['x-freefloorplan3d-delete-after'] || '');
        // A malformed or forward-dated header can never extend retention.
        const deadline = Number.isFinite(supplied) && supplied >= received ? Math.min(maximum, supplied) : maximum;
        messages.push({id: message.id, rfcId: headers['message-id'], refs: (headers.references || '') + ' ' + (headers['in-reply-to'] || ''),
          selected, deadline, received, held: !!holdLabel && (message.labelIds || []).includes(holdLabel)});
      }
    }
    messages.sort((a, b) => a.received - b.received);
    const ancestors = new Map();
    for (const message of messages) {
      for (const ref of message.refs.match(/<[^>]+>/g) || []) {
        const parent = ancestors.get(ref);
        if (parent?.selected) { message.selected = true; message.deadline = Math.min(message.deadline, parent.deadline); message.held ||= parent.held; }
      }
      if (message.rfcId) ancestors.set(message.rfcId, message);
    }
    // Leave one hour for scheduler delays/retries within the maximum 30-day window.
    const cutoff = Date.now() + 3600000;
    const due = messages.filter(m => m.selected && !m.held && m.deadline <= cutoff);
    let deleted = 0;
    for (const message of due) {
      if (!erase) continue;
      const current = Gmail.Users.Messages.get('me', message.id, {format: 'minimal', fields: 'id,labelIds'});
      if (holdLabel && (current.labelIds || []).includes(holdLabel)) continue;
      Gmail.Users.Messages.remove('me', message.id); // Permanently delete one message, never a thread.
      deleted++;
    }
    const report = {mode: erase ? 'enforce' : 'preview', checked: messages.length,
      selected: messages.filter(m => m.selected).length, held: messages.filter(m => m.selected && m.held).length,
      due: due.length, deleted, completedAt: new Date().toISOString()};
    console.log(JSON.stringify(report)); // Counts only; no names, addresses, subjects, IDs or bodies.
    if (erase) PropertiesService.getScriptProperties().setProperty('lastSuccessfulRun', report.completedAt);
    return report;
  } finally { lock.releaseLock(); }
}
