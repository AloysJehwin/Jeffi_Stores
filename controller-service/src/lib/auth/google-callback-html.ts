// Google's registered redirect URI. A tiny HTML page whose inline script runs before anything else loads,
// so the root domain's storefront never flashes and the tab never waits on React:
//  - state "<nonce>|<return URL>" (same-tab, the default): go straight back to the page that started sign-in,
//    with the token in the hash. An opener is ignored here (a tab opened from another tab has one too, and
//    window.close() on it fails, which used to leave this page stuck).
//  - state "p.<nonce>|<return URL>" (popup, custom domains): post the token to the opener and close; if the
//    opener is gone or the window won't close, fall back to the same-tab redirect.
// Only our own hosts (or a same-site path) are honoured, so this can't be used as an open redirect.

export const CALLBACK_SCRIPT = `
(function () {
  var hash = location.hash.slice(1), p = new URLSearchParams(hash), state = p.get('state') || '';
  var own = function (h) { return /(^|\\.)jeffistores\\.in$/i.test(h) || /(^|\\.)localhost$/i.test(h) || h === '127.0.0.1'; };
  var back = null, pipe = state.indexOf('|');
  try {
    if (pipe !== -1) {
      var c = decodeURIComponent(state.slice(pipe + 1));
      if (c.charAt(0) === '/' && c.charAt(1) !== '/' && c.charAt(1) !== '\\\\') back = c;
      else { var u = new URL(c); if ((u.protocol === 'https:' || u.protocol === 'http:') && own(u.hostname)) back = u.origin + u.pathname + u.search; }
    }
  } catch (e) {}
  var go = function () {
    if (!back) {
      document.getElementById('m').textContent = 'This sign-in link is incomplete. Close this tab and sign in again.';
      return;
    }
    var target = back + '#' + hash;
    location.replace(target);
    // Safety net: some browsers drop a script navigation on a page reached by a cross-site redirect.
    // Still here after a moment: try again, then offer a link so the tab never sits on this page.
    setTimeout(function () {
      try { location.assign(target); } catch (e) {}
      var m = document.getElementById('m');
      if (m) m.innerHTML = 'Still here? <a id="c" href="#">Continue signing in</a>';
      var c = document.getElementById('c');
      if (c) c.setAttribute('href', target);
    }, 1500);
  };
  if (state.slice(0, 2) === 'p.' && window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage({ source: 'jeffi-google-oauth', accessToken: p.get('access_token'), error: p.get('error') }, '*');
      window.close();
    } catch (e) {}
    setTimeout(go, 1500);
    return;
  }
  go();
})();
`

export const CALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Signing you in…</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:14px system-ui,-apple-system,Segoe UI,sans-serif;color:#57534e;background:#fafaf9}
@media (prefers-color-scheme:dark){body{background:#1c1917;color:#d6d3d1}}</style>
<script>${CALLBACK_SCRIPT}</script></head><body><p id="m">Signing you in…</p></body></html>`
