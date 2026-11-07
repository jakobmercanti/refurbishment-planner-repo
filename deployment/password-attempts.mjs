const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const stateKey = 'attempts';

function locked(until) {
  return Response.json({
    error_code: 'password_attempt_limit',
    message: 'Too many sign-in attempts. Wait before trying again or request a password reset.',
  }, { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((until - Date.now()) / 1000))) } });
}

export async function passwordSignIn(env, key, body) {
  let input;
  try { input = JSON.parse(new TextDecoder().decode(body)); }
  catch { return Response.json({ message: 'Invalid sign-in request.' }, { status: 400 }); }
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!email || email.length > 320 || !email.includes('@') || typeof input?.password !== 'string' || !input.password)
    return Response.json({ message: 'Enter an email address and password.' }, { status: 400 });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  const name = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (!env.PASSWORD_ATTEMPTS?.getByName) throw new Error('Password limiter unavailable');
  return env.PASSWORD_ATTEMPTS.getByName(name).fetch('https://password-attempts.internal/sign-in', {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: input.password }),
  });
}

/** A single Durable Object owns each email's counter across IPs and regions. */
export class PasswordAttempts {
  #tail = Promise.resolve();

  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
  }

  #serialize(operation) {
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  fetch(request) {
    return this.#serialize(async () => {
      const saved = await this.storage.get(stateKey);
      const active = saved?.until > Date.now() ? saved : undefined;
      if (active?.failures >= MAX_FAILURES) return locked(active.until);

      const response = await fetch(new URL('/auth/v1/token?grant_type=password', this.env.SUPABASE_URL), {
        method: 'POST',
        headers: { apikey: request.headers.get('apikey'), 'Content-Type': 'application/json' },
        body: new Uint8Array(await request.arrayBuffer()),
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
      if (response.ok) {
        await this.storage.delete(stateKey);
        return response;
      }
      if (![400, 401, 403].includes(response.status)) return response;
      const details = await response.json().catch(() => null);
      // This provider error occurs after the correct password was verified.
      if (details?.error_code === 'email_not_confirmed')
        return Response.json({ error_code: 'email_not_confirmed' }, { status: 400 });
      const failures = (active?.failures ?? 0) + 1;
      const until = failures >= MAX_FAILURES ? Date.now() + WINDOW_MS : active?.until ?? Date.now() + WINDOW_MS;
      await this.storage.setAlarm(until);
      await this.storage.put(stateKey, { failures, until });
      if (failures >= MAX_FAILURES) return locked(until);
      return Response.json({ message: 'The email address or password is incorrect.' }, { status: 400 });
    });
  }

  alarm() {
    return this.#serialize(async () => {
      const state = await this.storage.get(stateKey);
      if (state?.until > Date.now()) await this.storage.setAlarm(state.until);
      else await this.storage.delete(stateKey);
    });
  }
}
