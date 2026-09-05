const CONTACT_ORIGIN = 'https://www.freefloorplan3d.com';
const CONTACT_RECIPIENT = 'plannerbuildteam@gmail.com';
const CONTACT_SENDER = 'contact@freefloorplan3d.com';
const MAX_BODY_BYTES = 32768;

function json(status, message, extra = {}) {
  return Response.json({ok: status === 200, message}, {status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex', ...extra,
  }});
}

async function boundedJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new RangeError('Body too large');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {await reader.cancel(); throw new RangeError('Body too large');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handleContact(request, env = {}, verifyFetch = fetch) {
  if (request.method !== 'POST') return json(405, 'Please use the contact form to send your message.', {Allow:'POST'});
  if (request.headers.get('origin') !== CONTACT_ORIGIN) return json(403, 'Please send your message from the contact form on our website.');
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(415, 'Please send your message using the website form.');
  let data;
  try {data = await boundedJson(request);} catch (error) {
    return json(error instanceof RangeError ? 413 : 400, 'Your message could not be read. Please check its length and try again.');
  }
  if (!data || Array.isArray(data) || typeof data !== 'object') return json(400, 'Please complete all the form fields.');
  const {name, email, subject, message, token, website = ''} = data;
  if ([name,email,subject,message,token,website].some(value => typeof value !== 'string')) return json(400, 'Please complete all the form fields.');
  if (website.trim()) return json(400, 'The spam check failed. Please refresh the page and try again.');
  const clean = {name:name.trim(), email:email.trim(), subject:subject.trim(), message:message.trim()};
  if (!clean.name || clean.name.length > 100 || !clean.subject || clean.subject.length > 150 || clean.message.length < 10 || clean.message.length > 5000) return json(400, 'Enter your name, a subject, and a message between 10 and 5,000 characters.');
  if (/[\r\n\x00-\x1f\x7f]/.test(clean.name + clean.email + clean.subject) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(clean.message)) return json(400, 'Please remove unsupported characters from your message.');
  if (clean.email.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(clean.email)) return json(400, 'Please enter a valid email address so we can reply.');
  if (!token || token.length > 2048) return json(400, 'Please complete the spam check and try again.');
  if (!env.TURNSTILE_SECRET || !env.CONTACT_EMAIL?.send || !env.CONTACT_RATE_LIMIT?.limit) return json(503, 'Sending is temporarily unavailable. Please email plannerbuildteam@gmail.com directly.');
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const limited = await env.CONTACT_RATE_LIMIT.limit({key:'freefloorplan3d:contact:' + ip});
    if (!limited.success) return json(429, 'You’ve made several attempts. Please wait a minute before trying again.', {'Retry-After':'60'});
    const response = await verifyFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:env.TURNSTILE_SECRET, response:token, remoteip:ip}),
      signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) return json(503, 'We couldn’t complete the spam check. Please try again shortly.');
    const verification = await response.json();
    if (!verification.success || verification.hostname !== 'www.freefloorplan3d.com' || verification.action !== 'contact') return json(400, 'The spam check expired or failed. Please complete it again.');
    await env.CONTACT_EMAIL.send({
      from:{email:CONTACT_SENDER, name:'FreeFloorplan3D contact form'},
      to:CONTACT_RECIPIENT,
      replyTo:clean.email,
      subject:'[FreeFloorplan3D] ' + clean.subject,
      text:`New website enquiry\n\nName: ${clean.name}\nEmail: ${clean.email}\nSubject: ${clean.subject}\n\nMessage:\n${clean.message}\n\n---\nSent from the contact form at ${CONTACT_ORIGIN}/contact/\nVisitor-supplied contact details are not verified.`,
    });
    return json(200, 'Thanks! Your message has been sent to the FreeFloorplan3D team. We’ll reply to the email address you provided.');
  } catch {
    // Do not log the request body, email address, token or provider error text.
    return json(503, 'We couldn’t confirm that your message was sent. Please try again later or email plannerbuildteam@gmail.com directly.');
  }
}
