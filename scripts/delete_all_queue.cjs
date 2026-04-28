#!/usr/bin/env node
// Usage: node scripts/delete_all_queue.cjs /path/to/serviceAccount.json
// Deletes all documents in matchmakingQueue (destructive). Use only for testing / cleanup.

const fs = require('fs');
const path = require('path');

function base64UrlEncode(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function jsonToBase64Url(obj) { return base64UrlEncode(Buffer.from(JSON.stringify(obj))); }

(async function main(){
  try {
    const servicePath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'niop4g-sakupljac-78896-firebase-adminsdk-fbsvc-a521dd2089.json');
    if (!fs.existsSync(servicePath)) { console.error('Service account JSON not found at', servicePath); process.exit(1); }
    const sa = JSON.parse(fs.readFileSync(servicePath, 'utf8'));
    const projectId = sa.project_id; const clientEmail = sa.client_email; const privateKey = sa.private_key;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { iss: clientEmail, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now+3600, sub: clientEmail };
    const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
    const sign = require('crypto').createSign('RSA-SHA256'); sign.update(signingInput);
    const sig = sign.sign(privateKey, 'base64');
    const assertion = `${signingInput}.${sig.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
    const tokenData = await tokenRes.json(); const accessToken = tokenData.access_token;

    const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const queryBody = { structuredQuery: { from: [{ collectionId: 'matchmakingQueue' }] } };
    const rowsRes = await fetch(runQueryUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(queryBody) });
    const rows = await rowsRes.json();
    const docs = rows.map(r=>r.document).filter(Boolean).map(doc=>({ id: doc.name.split('/').pop(), name: doc.name }));
    console.log(`Found ${docs.length} docs.`);
    for (const d of docs) {
      const delUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/matchmakingQueue/${d.id}`;
      const res = await fetch(delUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) console.error('Failed delete', d.id, await res.text()); else console.log('Deleted', d.id);
    }
    console.log('Done.');
  } catch (err) { console.error('Error', err); process.exit(1); }
})();
