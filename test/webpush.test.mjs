/* Web-Push-Krypto: Verschlüsselung hin und zurück, VAPID-Signatur prüfbar */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateVapidKeys, vapidAuthorization, encryptPayload, decryptPayloadForTest } from '../scripts/webpush.mjs';

test('aes128gcm: Empfänger kann die Nutzlast entschlüsseln', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const payload = JSON.stringify({ title: 'Bitcoin: Kaufsignal', body: 'Wochenschluss 82.000 $ über 80.436 $ – äöü €' });
  const body = encryptPayload(payload, ua.getPublicKey().toString('base64url'), auth);
  assert.equal(body.readUInt32BE(16), 4096); assert.equal(body[20], 65);
  assert.equal(decryptPayloadForTest(body, ua, auth), payload);
});

test('VAPID: JWT ist mit dem öffentlichen Schlüssel gültig', () => {
  const k = generateVapidKeys();
  assert.equal(Buffer.from(k.publicKey, 'base64url').length, 65);
  const h = vapidAuthorization('https://web.push.apple.com/QAbc', 'https://example.org/', k.publicKey, k.privateKey);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h); assert.ok(m); assert.equal(m[2], k.publicKey);
  const [hd, cl, sg] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(cl, 'base64url').toString());
  assert.equal(claims.aud, 'https://web.push.apple.com'); assert.equal(claims.sub, 'https://example.org/'); assert.ok(claims.exp > Date.now() / 1000);
  const pub = Buffer.from(k.publicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(hd + '.' + cl), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')), true);
});
