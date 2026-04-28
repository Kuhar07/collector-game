#!/usr/bin/env node
// Usage: node scripts/diagnose_db.cjs /path/to/serviceAccount.json
// Lists all matchmakingQueue and recent games to diagnose where old data is coming from.

const fs = require('fs');
const path = require('path');

function base64UrlEncode(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function jsonToBase64Url(obj) { return base64UrlEncode(Buffer.from(JSON.stringify(obj))); }

(async function main(){
  try {
    const servicePath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'niop4g-sakupljac-78896-firebase-adminsdk-fbsvc-a521dd2089.json');
    if (!fs.existsSync(servicePath)) { console.error('Service account JSON not found'); process.exit(1); }
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

    // Get all matchmakingQueue docs
    console.log('\n=== MATCHMAKING QUEUE ===');
    const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const queueQuery = { structuredQuery: { from: [{ collectionId: 'matchmakingQueue' }] } };
    const queueRes = await fetch(runQueryUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(queueQuery) });
    const queueRows = await queueRes.json();
    const queueDocs = queueRows.map(r=>r.document).filter(Boolean);
    console.log(`Total matchmakingQueue docs: ${queueDocs.length}`);
    for (const doc of queueDocs) {
      const id = doc.name.split('/').pop();
      const fields = doc.fields || {};
      const status = fields.status?.stringValue || 'unknown';
      const uid = fields.uid?.stringValue || id;
      const gameId = fields.gameId?.stringValue || 'null';
      const joinedAtMs = Number(fields.joinedAtMs?.integerValue || 0);
      const ageMin = Math.round((Date.now() - joinedAtMs) / 60000);
      console.log(`  [${status}] ${id} (uid=${uid}, gameId=${gameId}, age=${ageMin}min)`);
    }

    // Get recent games
    console.log('\n=== GAMES (recent) ===');
    const gamesQuery = { structuredQuery: { from: [{ collectionId: 'games' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: 20 } };
    const gamesRes = await fetch(runQueryUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(gamesQuery) });
    const gamesRows = await gamesRes.json();
    const gameDocs = gamesRows.map(r=>r.document).filter(Boolean);
    console.log(`Recent games: ${gameDocs.length}`);
    for (const doc of gameDocs.slice(0, 10)) {
      const id = doc.name.split('/').pop();
      const fields = doc.fields || {};
      const status = fields.status?.stringValue || 'unknown';
      const p1 = fields.player1name?.stringValue || 'unknown';
      const p2 = fields.player2name?.stringValue || 'unknown';
      const createdAt = fields.createdAt?.stringValue || 'unknown';
      console.log(`  [${status}] ${id}: ${p1} vs ${p2} @ ${createdAt}`);
    }

    console.log('\nDone.');
  } catch (err) { console.error('Error', err); process.exit(1); }
})();
