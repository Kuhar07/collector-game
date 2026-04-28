#!/usr/bin/env node
// Usage: node scripts/diagnose_matchmaking_multi.cjs /path/to/serviceAccount.json

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

    async function queryCollection(collectionId) {
      const query = { structuredQuery: { from: [{ collectionId }] } };
      const res = await fetch(runQueryUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
      const rows = await res.json();
      const docs = rows.map(r=>r.document).filter(Boolean);
      return docs.map(doc => ({ id: doc.name.split('/').pop(), fields: doc.fields || {} }));
    }

    console.log('\n=== MATCHMAKING QUEUE (ranked) ===');
    const ranked = await queryCollection('matchmakingQueue_ranked');
    console.log(`Total ranked docs: ${ranked.length}`);
    for (const doc of ranked) {
      const id = doc.id;
      const fields = doc.fields;
      const status = fields.status?.stringValue || 'unknown';
      const uid = fields.uid?.stringValue || id;
      const gameId = fields.gameId?.stringValue || 'null';
      const joinedAtMs = Number(fields.joinedAtMs?.integerValue || 0);
      const ageMin = joinedAtMs ? Math.round((Date.now() - joinedAtMs) / 60000) : 'N/A';
      console.log(`  [${status}] ${id} (uid=${uid}, gameId=${gameId}, age=${ageMin}min)`);
    }

    console.log('\n=== MATCHMAKING QUEUE (casual) ===');
    const casual = await queryCollection('matchmakingQueue_casual');
    console.log(`Total casual docs: ${casual.length}`);
    for (const doc of casual) {
      const id = doc.id;
      const fields = doc.fields;
      const status = fields.status?.stringValue || 'unknown';
      const uid = fields.uid?.stringValue || id;
      const gameId = fields.gameId?.stringValue || 'null';
      const joinedAtMs = Number(fields.joinedAtMs?.integerValue || 0);
      const ageMin = joinedAtMs ? Math.round((Date.now() - joinedAtMs) / 60000) : 'N/A';
      console.log(`  [${status}] ${id} (uid=${uid}, gameId=${gameId}, age=${ageMin}min)`);
    }

    console.log('\n=== PLAYERS WITH NON-IDLE STATE ===');
    const playersQuery = { structuredQuery: { from: [{ collectionId: 'players' }], where: { fieldFilter: { field: { fieldPath: 'state' }, op: 'NOT_EQUAL', value: { stringValue: 'idle' } } }, limit: 200 } };
    const playersRes = await fetch(runQueryUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(playersQuery) });
    const playersRows = await playersRes.json();
    const playersDocs = playersRows.map(r=>r.document).filter(Boolean);
    console.log(`Players with non-idle state: ${playersDocs.length}`);
    for (const doc of playersDocs) {
      const id = doc.name.split('/').pop();
      const st = doc.fields.state?.stringValue || 'unknown';
      const updated = doc.fields.updatedAt?.stringValue || 'unknown';
      console.log(`  ${id}: ${st} (updatedAt=${updated})`);
    }

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

    // If there's an active game, print its full fields and players' states for debugging
    const activeGame = gameDocs.find(d => (d.fields||{}).status?.stringValue === 'active');
    if (activeGame) {
      const activeId = activeGame.name.split('/').pop();
      console.log('\n--- Active game details ---');
      const gameRes = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/games/${activeId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const gameBody = await gameRes.json();
      console.log(JSON.stringify(gameBody.fields || {}, null, 2));
      const p1uid = gameBody.fields?.player1uid?.stringValue;
      const p2uid = gameBody.fields?.player2uid?.stringValue;
      if (p1uid) {
        const p1res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/players/${p1uid}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const p1b = await p1res.json();
        console.log('\nPlayer1 doc:', p1uid, p1b.fields || {});
      }
      if (p2uid) {
        const p2res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/players/${p2uid}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const p2b = await p2res.json();
        console.log('\nPlayer2 doc:', p2uid, p2b.fields || {});
      }
    }

    console.log('\nDone.');
  } catch (err) { console.error('Error', err); process.exit(1); }
})();
