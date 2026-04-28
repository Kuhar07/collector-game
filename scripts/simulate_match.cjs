#!/usr/bin/env node
// Usage: node scripts/simulate_match.cjs /path/to/serviceAccount.json
// Creates two temporary matchmakingQueue docs and simulates matchmaking between them (non-destructive aside from creating a game and updating queues).

const fs = require('fs');
const path = require('path');

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function jsonToBase64Url(obj) { return base64UrlEncode(Buffer.from(JSON.stringify(obj))); }

(async function main(){
  try {
    const servicePath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'niop4g-sakupljac-78896-firebase-adminsdk-fbsvc-a521dd2089.json');
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

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { iss: clientEmail, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now+3600, sub: clientEmail };
    const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
    const sign = require('crypto').createSign('RSA-SHA256');
    sign.update(signingInput);
    const sig = sign.sign(privateKey, 'base64');
    const assertion = `${signingInput}.${sig.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
    if (!tokenRes.ok) { console.error('Failed to get token', await tokenRes.text()); process.exit(1); }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Create two temporary queue entries
    const uidA = `simA_${Date.now().toString(36).slice(-6)}`;
    const uidB = `simB_${Date.now().toString(36).slice(-6)}`;
    const nowMs = Date.now();
    const defaultRating = 1000;

    const tokenA = `t_${Math.random().toString(36).slice(2,10)}`;
    const tokenB = `t_${Math.random().toString(36).slice(2,10)}`;

    const docA = {
      fields: {
        uid: { stringValue: uidA },
        mode: { stringValue: 'casual' },
        status: { stringValue: 'searching' },
        displayName: { stringValue: 'Sim A' },
        email: { stringValue: 'sima@gmail.com' },
        gridSize: { integerValue: '6' },
        timerEnabled: { booleanValue: true },
        mu: { doubleValue: 1500 },
        sigma: { doubleValue: 500 },
        rating: { integerValue: String(defaultRating) },
        gameId: { nullValue: null },
        matchedWith: { nullValue: null },
        queueToken: { stringValue: tokenA },
        joinedAtMs: { integerValue: String(nowMs) },
        updatedAtMs: { integerValue: String(nowMs) },
        joinedAt: { stringValue: new Date().toISOString() },
        updatedAt: { stringValue: new Date().toISOString() }
      }
    };
    const docB = JSON.parse(JSON.stringify(docA));
    docB.fields.uid.stringValue = uidB; docB.fields.displayName.stringValue = 'Sim B'; docB.fields.email.stringValue = 'simb@gmail.com'; docB.fields.queueToken.stringValue = tokenB;

    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/matchmakingQueue`;
    // Write both docs
    const putA = await fetch(`${baseUrl}/${uidA}`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(docA) });
    const putB = await fetch(`${baseUrl}/${uidB}`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(docB) });
    if (!putA.ok || !putB.ok) { console.error('Failed to create queue docs', await putA.text(), await putB.text()); process.exit(1); }

    console.log('Created queue docs:', uidA, uidB);

    // Now simulate matchmaking: read back both and choose
    const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const queryBody = { structuredQuery: { from: [{ collectionId: 'matchmakingQueue' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'searching' } } } } };
    const rowsRes = await fetch(runQueryUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(queryBody) });
    const rows = await rowsRes.json();
    const docs = rows.map(r => r.document).filter(Boolean).map(doc => ({ id: doc.name.split('/').pop(), fields: doc.fields }));
    console.log('Currently searching docs:', docs.map(d => d.id));

    if (docs.length < 2) {
      console.log('Not enough candidates to match.');
      process.exit(0);
    }

    // Simple rating-based choose: pick pair with smallest diff
    const arr = docs.map(d => ({ id: d.id, rating: Number(d.fields.rating?.integerValue || d.fields.rating?.stringValue || defaultRating), joinedAtMs: Number(d.fields.joinedAtMs?.integerValue || d.fields.joinedAtMs?.stringValue || nowMs) }));
    // take first two (there are only two)
    const a = arr[0], b = arr[1];
    const selfIsP1 = a.joinedAtMs <= b.joinedAtMs;
    const p1 = selfIsP1 ? a : b; const p2 = selfIsP1 ? b : a;

    const gameId = `game_${(Math.random().toString(36).slice(2,10)).toUpperCase()}`;
    const gameDoc = {
      fields: {
        gameCode: { nullValue: null },
        mode: { stringValue: 'casual' },
        source: { stringValue: 'matchmaking-sim' },
        status: { stringValue: 'active' },
        player1uid: { stringValue: p1.id },
        player1name: { stringValue: 'Sim P1' },
        player2uid: { stringValue: p2.id },
        player2name: { stringValue: 'Sim P2' },
        gridSize: { integerValue: '6' },
        timerEnabled: { booleanValue: true },
        currentPlayer: { integerValue: '1' },
        phase: { stringValue: 'place' },
        lastPlaces: { nullValue: null },
        gameStateJSON: { nullValue: null },
        placementHistory: { mapValue: { fields: { p1: { arrayValue: { values: [] } }, p2: { arrayValue: { values: [] } } } } },
        timeouts: { mapValue: { fields: { p1: { integerValue: '0' }, p2: { integerValue: '0' } } } },
        result: { nullValue: null },
        createdAt: { stringValue: new Date().toISOString() }
      }
    };

    const gamesUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/games/${gameId}`;
    const createGame = await fetch(gamesUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(gameDoc) });
    if (!createGame.ok) { console.error('Failed to create game', await createGame.text()); process.exit(1); }

    // Update both queue docs to matched
    async function patchQueue(id, matchedWith) {
      const docName = `projects/${projectId}/databases/(default)/documents/matchmakingQueue/${id}`;
      const body = { fields: { status: { stringValue: 'matched' }, gameId: { stringValue: gameId }, matchedWith: { stringValue: matchedWith }, matchedAt: { stringValue: new Date().toISOString() }, updatedAtMs: { integerValue: String(Date.now()) }, updatedAt: { stringValue: new Date().toISOString() } } };
      const patchRes = await fetch(`https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=status&updateMask.fieldPaths=gameId&updateMask.fieldPaths=matchedWith&updateMask.fieldPaths=matchedAt&updateMask.fieldPaths=updatedAtMs&updateMask.fieldPaths=updatedAt`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return patchRes;
    }

    const p1Patch = await patchQueue(p1.id, p2.id);
    const p2Patch = await patchQueue(p2.id, p1.id);
    if (!p1Patch.ok || !p2Patch.ok) { console.error('Failed to update queues', await p1Patch.text(), await p2Patch.text()); process.exit(1); }

    console.log('Simulated match created:', gameId, 'between', p1.id, 'and', p2.id);
    process.exit(0);

  } catch (err) {
    console.error('Error', err);
    process.exit(1);
  }
})();
