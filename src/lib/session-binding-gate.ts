import { NextResponse, type NextRequest } from 'next/server'
import type { PrincipalType } from './auth-sessions'
import { adminCookieNameForHost } from './admin-cookie'
import { BIND_COOKIE, BIND_ENDPOINT, PROOF_HEADER, normHost } from './session-binding-shared'
import { bindingMode, sidHashOf, verifyBindCookie } from './session-binding'

// Page loads cannot carry a signed header, so under enforcement they are judged on the short-lived
// cookie alone, and that cookie lapses after a few idle minutes. Before such a navigation reaches
// the app, this gate answers with a tiny page that re-earns the cookie using the browser's key and
// reloads. The login browser passes in one round trip; a browser holding only a copied *_sid has
// no key, fails, and goes on to be refused by resolveSession.

const RETRY_MARKER = '_vr'
const MARKER_TTL_S = 600
const MARKER_TTL_TRANSIENT_S = 30
const SESSIONLESS_APPS = new Set(['forms', 'quotation', 'invoice', 'purchaseorder'])
const INITIAL: Record<PrincipalType, string> = { customer: 'c', business: 'b', admin: 'a', owner: 'o' }

// *_sid cookies are shared across every subdomain but a key lives in one origin, so only the
// session this surface actually uses is worth re-binding here.
function surfacePrincipals(hostname: string, hostApp: string | null, pathname: string): PrincipalType[] {
  if (hostname.startsWith('ecom.')) return ['owner']
  if (hostApp === 'admin') return ['admin']
  if (hostApp === 'business') return ['business']
  if (hostApp && SESSIONLESS_APPS.has(hostApp)) return []
  const p = pathname.startsWith('/api/') ? pathname.slice(4) : pathname
  if (p === '/admin' || p.startsWith('/admin/')) return ['admin']
  if (p === '/business' || p.startsWith('/business/')) return ['business']
  if (p === '/ecom' || p.startsWith('/ecom/')) return ['owner']
  return ['customer']
}

function isDocumentNavigation(request: NextRequest): boolean {
  if (request.method !== 'GET') return false
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? ''
  if (/prefetch|prerender/i.test(purpose)) return false
  const dest = request.headers.get('sec-fetch-dest')
  if (dest) return dest === 'document'
  return (request.headers.get('accept') ?? '').includes('text/html')
}

export function bindingGate(request: NextRequest, hostname: string, hostApp: string | null): NextResponse | null {
  if (bindingMode() !== 'enforce') return null
  const pathname = request.nextUrl.pathname
  if (pathname === BIND_ENDPOINT || !isDocumentNavigation(request)) return null

  // Must be derived exactly as the verifier and the bind endpoint derive it: a cookie minted for
  // one spelling of the host and checked against another would re-bind forever.
  const host = normHost(request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? hostname)
  const sidCookie: Record<PrincipalType, string> = {
    customer: 'user_sid',
    business: 'business_sid',
    owner: 'owner_sid',
    admin: adminCookieNameForHost(hostname),
  }
  const pending = surfacePrincipals(hostname, hostApp, pathname).filter(type => {
    const sid = request.cookies.get(sidCookie[type])?.value
    if (!sid) return false
    return !verifyBindCookie(request.cookies.get(BIND_COOKIE[type])?.value, sidHashOf(sid), host)
  })
  if (pending.length === 0) return null

  const alreadyFailed = request.cookies.get(RETRY_MARKER)?.value ?? ''
  if (pending.every(type => alreadyFailed.includes(INITIAL[type]))) return null

  return new NextResponse(rebindPage(pending.map(t => INITIAL[t]).join('')), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex',
      Vary: 'Cookie',
    },
  })
}

function rebindPage(need: string): string {
  const types: Record<string, string> = { c: 'customer', b: 'business', a: 'admin', o: 'owner' }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loading</title><style>html,body{height:100%;margin:0;background:#fff}</style></head><body><script>setTimeout(function(){document.cookie=${JSON.stringify(RETRY_MARKER)}+'=cbao; Max-Age=${MARKER_TTL_TRANSIENT_S}; Path=/; SameSite=Lax';location.replace(location.href)},20000)</script><script>(function(){
var E=${JSON.stringify(BIND_ENDPOINT)},H=${JSON.stringify(PROOF_HEADER)},NEED=${JSON.stringify(need)},T=${JSON.stringify(types)},M=${JSON.stringify(RETRY_MARKER)},fired=false;
function leave(failed,ttl){if(fired)return;fired=true;var cur=(document.cookie.match(new RegExp('(?:^|; )'+M+'=([^;]*)'))||[])[1]||'',next='';for(var i=0;i<cur.length;i++)if(NEED.indexOf(cur[i])<0)next+=cur[i];next+=failed;document.cookie=M+'='+next+'; Max-Age='+(next?ttl:0)+'; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');location.replace(location.href)}
function b64(buf){var a=new Uint8Array(buf),s='';for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
function wait(ms){return new Promise(function(r){setTimeout(r,ms)})}
function attempt(k,jwk,off,retry,tries){var ts=Date.now()+off,n=b64(crypto.getRandomValues(new Uint8Array(12)));
return crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},k.privateKey,new TextEncoder().encode('POST\\n'+E+'\\n'+ts+'\\n'+n)).then(function(sig){var h={'content-type':'application/json'};h[H]=ts.toString(36)+'.'+n+'.'+b64(sig);return fetch(E,{method:'POST',credentials:'same-origin',headers:h,body:JSON.stringify({k:jwk})})}).then(function(r){
if(r.status===429||r.status>=500){if(tries>0)return wait(2000).then(function(){return attempt(k,jwk,off,retry,tries-1)});throw new Error('busy')}
return r.json().catch(function(){return null}).then(function(d){if(r.status===409&&retry&&d&&typeof d.now==='number')return attempt(k,jwk,d.now-Date.now(),false,tries);var got=(d&&d.types)||[],failed='';for(var i=0;i<NEED.length;i++)if(got.indexOf(T[NEED[i]])<0)failed+=NEED[i];return failed})},function(e){if(tries>0)return wait(2000).then(function(){return attempt(k,jwk,off,retry,tries-1)});throw e})}
try{
try{var ss=window.sessionStorage,now=Date.now(),rec=JSON.parse(ss.getItem('_vr_n')||'null');rec=rec&&now-rec.t<10000?{t:now,n:rec.n+1}:{t:now,n:1};ss.setItem('_vr_n',JSON.stringify(rec));if(rec.n>=3)return leave(NEED,${MARKER_TTL_S})}catch(e){}
if(!window.indexedDB||!window.crypto||!crypto.subtle)return leave(NEED,${MARKER_TTL_S});
setTimeout(function(){leave(NEED,${MARKER_TTL_TRANSIENT_S})},12000);
var open=indexedDB.open('_app',1);
open.onupgradeneeded=function(){open.result.createObjectStore('kv')};
open.onerror=function(){leave(NEED,${MARKER_TTL_S})};
open.onsuccess=function(){var db=open.result,g=db.transaction('kv','readonly').objectStore('kv').get('k1');
g.onerror=function(){leave(NEED,${MARKER_TTL_S})};
g.onsuccess=function(){var kp=g.result;
var ready=kp&&kp.privateKey?Promise.resolve(kp):crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']).then(function(fresh){return new Promise(function(res){var a=db.transaction('kv','readwrite').objectStore('kv').add(fresh,'k1');a.onsuccess=function(){res(fresh)};a.onerror=function(ev){ev.preventDefault();var r=db.transaction('kv','readonly').objectStore('kv').get('k1');r.onsuccess=function(){res(r.result||fresh)};r.onerror=function(){res(fresh)}}})});
ready.then(function(k){return crypto.subtle.exportKey('jwk',k.publicKey).then(function(j){return attempt(k,{kty:j.kty,crv:j.crv,x:j.x,y:j.y},0,true,2)})}).then(function(failed){leave(failed,${MARKER_TTL_S})}).catch(function(){leave(NEED,${MARKER_TTL_TRANSIENT_S})})}}
}catch(e){leave(NEED,${MARKER_TTL_TRANSIENT_S})}
})()</script><noscript>JavaScript is required to continue.</noscript></body></html>`
}
