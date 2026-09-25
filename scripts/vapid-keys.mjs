#!/usr/bin/env node
/* Erzeugt ein neues VAPID-Schlüsselpaar für Web Push.
   Der öffentliche Schlüssel wird in docs/data/config.json eingetragen, der private nur hier ausgegeben:
   ihn als Secret VAPID_PRIVATE_KEY im GitHub-Repo hinterlegen (Settings → Secrets and variables → Actions).
   Achtung: Nach einem Schlüsselwechsel müssen alle Geräte Push neu einrichten. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVapidKeys } from './webpush.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = path.join(ROOT, 'docs', 'data', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const keys = generateVapidKeys();
cfg.push = cfg.push || {};
cfg.push.vapidPublicKey = keys.publicKey;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('Öffentlicher Schlüssel in docs/data/config.json eingetragen.');
console.log('');
console.log('Secret VAPID_PRIVATE_KEY (im GitHub-Repo hinterlegen, sonst nirgends speichern):');
console.log(keys.privateKey);
