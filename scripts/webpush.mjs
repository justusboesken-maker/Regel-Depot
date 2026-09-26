/* Web Push ohne Fremdpaket: VAPID (RFC 8292) und Payload-Verschlüsselung aes128gcm (RFC 8291, RFC 8188).
   Nur Node-Bordmittel (node:crypto, fetch). */
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* Schlüsselpaar für VAPID: öffentlicher Schlüssel als 65 Byte (unkomprimiert) base64url, privater Schlüssel als 32 Byte base64url */
export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(pub.x), fromB64u(pub.y)]);
  return { publicKey: b64u(raw), privateKey: priv.d };
}

function vapidPrivateKeyObject(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key: 65 Byte unkomprimiert erwartet');
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privateKey }, format: 'jwk' });
}

/* Authorization-Header für einen Push-Endpunkt */
export function vapidAuthorization(endpoint, subject, publicKey, privateKey, expSeconds = 12 * 3600) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + expSeconds, sub: subject }));
  const unsigned = header + '.' + claims;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: vapidPrivateKeyObject(publicKey, privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${publicKey}`;
}

/* Nutzlast für eine Subscription verschlüsseln (aes128gcm, ein Datensatz) */
export function encryptPayload(payload, p256dh, auth) {
  const uaPub = fromB64u(p256dh), authSecret = fromB64u(auth);
  if (uaPub.length !== 65) throw new Error('p256dh: 65 Byte erwartet');
  if (authSecret.length !== 16) throw new Error('auth: 16 Byte erwartet');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPub);
  const salt = crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]); /* 0x02: letzter Datensatz */
  if (plain.length + 16 > 4096) throw new Error('Nutzlast zu groß');
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}

/* Gegenstück nur für Tests: entschlüsseln mit dem privaten Schlüssel des Empfängers */
export function decryptPayloadForTest(body, uaEcdh, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const uaPub = uaEcdh.getPublicKey();
  const shared = uaEcdh.computeSecret(asPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, fromB64u(auth), keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1; while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('Padding-Delimiter fehlt');
  return plain.subarray(0, end).toString('utf8');
}

/* Eine Nachricht an eine Subscription schicken. Ergebnis: {ok, status, gone} */
export async function sendPush(subscription, payload, vapid, opts = {}) {
  const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Subscription unvollständig');
  const body = encryptPayload(typeof payload === 'string' ? payload : JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const headers = {
    'Authorization': vapidAuthorization(sub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.length),
    'TTL': String(opts.ttl == null ? 86400 : opts.ttl),
    'Urgency': opts.urgency || 'high'
  };
  if (opts.topic) headers.Topic = opts.topic;
  /* Ohne Zeitlimit könnte ein hängender Push-Dienst den ganzen Lauf bis zum Workflow-Timeout blockieren */
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeout || 20000);
  let res;
  try { res = await fetch(sub.endpoint, { method: 'POST', headers, body, signal: ctl.signal }); } finally { clearTimeout(timer); }
  const text = await res.text().catch(() => '');
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410, text: text.slice(0, 200) };
}
