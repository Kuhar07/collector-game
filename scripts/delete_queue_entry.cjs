#!/usr/bin/env node
// Delete a specific queue entry
const fs = require('fs');
const path = require('path');

function base64UrlEncode(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function jsonToBase64Url(obj) { return base64UrlEncode(Buffer.from(JSON.stringify(obj))); }

(async function main(){
  try {
    const servicePath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'niop4g-sakupljac-78896-firebase-adminsdk-fbsvc-a521dd2089.json');
    const uid = process.argv[3] || '5rZhSlxib6ZCsBIciAKglvTItzv2';
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

    const delUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/matchmakingQueue/${uid}`;
    const res = await fetch(delUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) { console.error('Failed to delete', uid, await res.text()); process.exit(1); }
    console.log('Deleted queue entry:', uid);
  } catch (err) { console.error('Error', err); process.exit(1); }
})();
