import {handleContact} from './contact.mjs';
// The build injects the validated public files. No filesystem or Node runtime
// is required in Cloudflare. Keep routing independent of the future editor.
export function createWorker(files) {
  const canonical = 'www.freefloorplan3d.com';
  const security = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  };
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.hostname === 'freefloorplan3d.com' || (url.hostname === canonical && url.protocol !== 'https:')) {
        url.hostname = canonical; url.protocol = 'https:';
        return Response.redirect(url.href, 301);
      }
      if (url.pathname === '/api/contact') return handleContact(request, env);
      if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405, headers:{...security,Allow:'GET, HEAD'}});
      let path = url.pathname;
      if (path.endsWith('/index.html')) {
        url.pathname=path.slice(0,-10);
        return Response.redirect(url.href,301);
      }
      if (!files[path] && files[path+'/']) {url.pathname=path+'/'; return Response.redirect(url.href,301);}
      const found=files[path];
      const file=found || files['/404.html'];
      const headers={...security,'Content-Type':file.type,'Cache-Control':file.type.startsWith('text/html')?'public, max-age=0, must-revalidate':'public, max-age=3600','ETag':file.etag};
      if(url.hostname===canonical) headers['Strict-Transport-Security']='max-age=31536000';
      if(url.hostname!==canonical || !found) headers['X-Robots-Tag']='noindex';
      if(path.startsWith('/downloads/')) headers['Content-Disposition']='attachment; filename="measurement-checklist.txt"';
      if(found && request.headers.get('if-none-match')===file.etag) return new Response(null,{status:304,headers});
      const bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));
      return new Response(request.method==='HEAD'?null:bytes,{status:found?200:404,headers});
    }
  };
}
