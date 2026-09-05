// Load spam protection only on pages that include the contact form.
const contactForm = document.querySelector('#contact-form');
if (contactForm) {
  const button = contactForm.querySelector('button[type="submit"]');
  const feedback = document.querySelector('#contact-feedback');
  const challenge = document.querySelector('#contact-challenge');
  let token = '';
  let widget;
  let sending = false;
  let sent = false;
  const show = (message, state = '') => {feedback.textContent = message; feedback.dataset.state = state;};
  const reset = () => {token = ''; button.disabled = true; if (widget !== undefined) window.turnstile?.reset(widget);};
  window.onContactChallengeReady = () => {
    widget = window.turnstile.render(challenge, {
      sitekey:challenge.dataset.sitekey, action:'contact', theme:'light', size:'flexible',
      callback(value) {token = value; button.disabled = sending; if (!sending && !sent && feedback.dataset.state !== 'error') show('Ready when you are.');},
      'expired-callback'() {token = ''; button.disabled = true; if (!sent && !sending) show('Please complete the spam check again.');},
      'error-callback'() {token = ''; button.disabled = true; if (!sent) show('Spam protection could not load. Please refresh or email plannerbuildteam@gmail.com directly.', 'error');},
    });
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onContactChallengeReady&render=explicit';
  script.async = true;
  script.onerror = () => show('Spam protection could not load. Please refresh or email plannerbuildteam@gmail.com directly.', 'error');
  document.head.append(script);
  contactForm.addEventListener('input', () => {if (sent) {sent = false; show('Ready for your next message.');}});
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !contactForm.reportValidity()) return;
    if (!token) {show('Please complete the spam check.', 'error'); return;}
    sending = true; sent = false; button.disabled = true; button.textContent = 'Sending…';
    show('Sending your message…');
    const fields = new FormData(contactForm);
    try {
      const response = await fetch('/api/contact', {
        method:'POST', headers:{'Content-Type':'application/json'},
        signal:AbortSignal.timeout(25000),
        body:JSON.stringify({name:fields.get('name'),email:fields.get('email'),subject:fields.get('subject'),message:fields.get('message'),website:fields.get('website'),token}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Your message could not be sent. Please try again later.');
      contactForm.reset(); sent = true;
      show(result.message, 'success');
    } catch (error) {
      show(['TypeError','TimeoutError','AbortError','SyntaxError'].includes(error.name) ? 'We couldn’t confirm delivery. Check your connection or email plannerbuildteam@gmail.com directly.' : error.message, 'error');
    } finally {
      sending = false; button.textContent = 'Send message →'; reset(); feedback.focus();
    }
  });
}
