export const turnstileSitekey = '0x4AAAAAAEpWnNwYy2OORIpg';

export function contactSection({page = false} = {}) {
  const heading = page ? 'h1' : 'h2';
  return `<section class="container section contact-section" id="contact">
    <div class="contact-copy">
      <span class="eyebrow">LET’S TALK ABOUT YOUR NEXT SPACE</span>
      <${heading}>Contact us.<br><span class="blue">We’re listening.</span></${heading}>
      <p>Have a question, an idea for the planner, or feedback to share? Send the FreeFloorplan3D team a message.</p>
      <div class="contact-address"><img src="/assets/brand-icon.png" width="48" height="48" alt=""><div><strong>FreeFloorplan3D team</strong><a href="mailto:plannerbuildteam@gmail.com">plannerbuildteam@gmail.com</a></div></div>
      <p class="contact-note">Your message goes straight to our team’s inbox. We’ll use your email address to reply.</p>
    </div>
    <form class="contact-form" id="contact-form" action="/api/contact" method="post" aria-label="Contact FreeFloorplan3D">
      <div class="contact-fields">
        <label>Your name<input name="name" autocomplete="name" required maxlength="100" placeholder="Your name"></label>
        <label>Your email<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>
      </div>
      <label>Subject<input name="subject" required maxlength="150" placeholder="What would you like to talk about?"></label>
      <label>Your message<textarea name="message" required minlength="10" maxlength="5000" rows="6" placeholder="Tell us what’s on your mind…" aria-describedby="message-hint"></textarea></label>
      <p id="message-hint" class="contact-hint">10–5,000 characters. Please don’t include passwords or sensitive personal information.</p>
      <div class="contact-trap" aria-hidden="true"><label>Leave this field empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <div id="contact-challenge" data-sitekey="${turnstileSitekey}"></div>
      <p class="contact-privacy">We use your details to respond to your enquiry. Spam protection is provided by Cloudflare Turnstile. <a href="/privacy/">Read our privacy notice.</a></p>
      <button class="button" type="submit" disabled>Send message <span aria-hidden="true">→</span></button>
      <p class="contact-feedback" id="contact-feedback" role="status" aria-live="polite" tabindex="-1">Loading spam protection…</p>
      <noscript><p>JavaScript is needed to verify and send this form. You can also <a href="mailto:plannerbuildteam@gmail.com">email plannerbuildteam@gmail.com directly</a>.</p></noscript>
    </form>
  </section>`;
}
