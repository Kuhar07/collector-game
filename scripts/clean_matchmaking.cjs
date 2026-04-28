#!/usr/bin/env node
// Usage: node scripts/clean_matchmaking.cjs /path/to/serviceAccount.json [maxAgeMinutes]
// Marks matchmakingQueue documents older than maxAgeMinutes as 'stale'.

const fs = require('fs');
const path = require('path');

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsonToBase64Url(obj) {
  return base64UrlEncode(Buffer.from(JSON.stringify(obj)));
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
  return { ok: res.ok, status: res.status, body: parsed };
}

(async function main(){
  try {
    const servicePath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'niop4g-sakupljac-78896-firebase-adminsdk-fbsvc-a521dd2089.json');
    const maxAgeMinutes = Number(process.argv[3] || 10);
    if (!fs.existsSync(servicePath)) {
      console.error('Service account JSON not found at', servicePath);
      process.exit(1);
    }
    const sa = JSON.parse(fs.readFileSync(servicePath, 'utf8'));
    const projectId = sa.project_id;
    const clientEmail = sa.client_email;
    const privateKey = sa.private_key;
    if (!projectId || !clientEmail || !privateKey) {
      console.error('Service account JSON missing required fields.');
      process.exit(1);
    }

    // Create JWT assertion
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      sub: clientEmail
    };
    const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
    const sign = require('crypto').createSign('RSA-SHA256');
    sign.update(signingInput);
    const sig = sign.sign(privateKey, 'base64');
    const assertion = `${signingInput}.${sig.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;

    // Exchange for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString()
    });
    if (!tokenRes.ok) {
      console.error('Failed to obtain access token', await tokenRes.text());
      process.exit(1);
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'matchmakingQueue' }],
      }
    };
    const rowsRes = await fetch(runQueryUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody)
    });
    if (!rowsRes.ok) {
      console.error('Failed to query matchmakingQueue', await rowsRes.text());
      process.exit(1);
    }
    const rows = await rowsRes.json();
    const docs = rows.map(r => r.document).filter(Boolean).map(doc => ({
      id: doc.name.split('/').pop(),
      name: doc.name,
      updateTime: doc.updateTime,
      fields: doc.fields
    }));

    const nowMs = Date.now();
    const thresholdMs = maxAgeMinutes * 60 * 1000;
    const toUpdate = [];
    function fieldToJs(f) {
      if (!f) return null;
      if (f.integerValue) return Number(f.integerValue);
      if (f.doubleValue) return Number(f.doubleValue);
      if (f.stringValue) return f.stringValue;
      if (f.mapValue) {
        const out = {};
        const fields = f.mapValue.fields || {};
        for (const k of Object.keys(fields)) out[k] = fieldToJs(fields[k]);
        return out;
      }
      return null;
    }

    for (const d of docs) {
      const fields = d.fields || {};
      const joinedAtMs = fields.joinedAtMs ? Number(fields.joinedAtMs.integerValue || fields.joinedAtMs.stringValue) : null;
      const updatedAtMs = fields.updatedAtMs ? Number(fields.updatedAtMs.integerValue || fields.updatedAtMs.stringValue) : null;
      const ts = updatedAtMs || joinedAtMs || (d.updateTime ? Date.parse(d.updateTime) : 0);
      const age = nowMs - (ts || 0);
      if (age > thresholdMs) {
        toUpdate.push({ id: d.id, fields, age });
      }
    }

    console.log(`Found ${docs.length} docs, ${toUpdate.length} older than ${maxAgeMinutes} minutes.`);
    if (!toUpdate.length) process.exit(0);

    for (const up of toUpdate) {
      const docName = `projects/${projectId}/databases/(default)/documents/matchmakingQueue/${up.id}`;
      const body = { fields: {
        status: { stringValue: 'stale' },
        updatedAtMs: { integerValue: String(Date.now()) },
        updatedAt: { stringValue: new Date().toISOString() }
      }};
      const patchUrl = `https://firestore.googleapis.com/v1/${docName}`;
      const patchRes = await fetch(patchUrl + `?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAtMs&updateMask.fieldPaths=updatedAt`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!patchRes.ok) {
        console.error('Failed to patch', up.id, await patchRes.text());
      } else {
        console.log('Marked stale:', up.id, `ageMs=${up.age}`);
      }
    }

    console.log('Done.');
  } catch (err) {
    console.error('Error', err);
    process.exit(1);
  }
})();
