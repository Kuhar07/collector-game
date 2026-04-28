#!/usr/bin/env node
// One-shot cleanup: remove queue rows whose referenced game is no longer active,
// and reset corresponding player.state to 'idle'.
// Targets the deployed split queues (matchmakingQueue_casual / _ranked).
//
// Usage: node scripts/cleanup_orphaned_queues.cjs [/path/to/serviceAccount.json] [--dry]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TERMINAL_STATUSES = new Set(['finished', 'left', 'cancelled']);

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function jsonToBase64Url(obj) { return base64UrlEncode(Buffer.from(JSON.stringify(obj))); }

(async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const servicePath = args.filter((a) => !a.startsWith('--'))[0]
    || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'niop4g-sakupljac-78896-firebase-adminsdk-fbsvc-a521dd2089.json');
  if (!fs.existsSync(servicePath)) { console.error('Service account JSON not found:', servicePath); process.exit(1); }
  const sa = JSON.parse(fs.readFileSync(servicePath, 'utf8'));
  const projectId = sa.project_id;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, sub: sa.client_email };
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const sign = crypto.createSign('RSA-SHA256'); sign.update(signingInput);
  const sig = sign.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const assertion = `${signingInput}.${sig}`;
  const tokRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
  if (!tokRes.ok) { console.error('Failed to get token', await tokRes.text()); process.exit(1); }
  const accessToken = (await tokRes.json()).access_token;

  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  function fsValueToJs(v) {
    if (v == null) return null;
    if ('nullValue' in v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('mapValue' in v) {
      const out = {};
      for (const [k, val] of Object.entries(v.mapValue?.fields || {})) out[k] = fsValueToJs(val);
      return out;
    }
    return null;
  }
  function fieldsToJs(fields = {}) { const o = {}; for (const [k, v] of Object.entries(fields)) o[k] = fsValueToJs(v); return o; }

  async function listCollection(collectionId) {
    const r = await fetch(`${baseUrl}:runQuery`, {
      method: 'POST', headers,
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } })
    });
    if (!r.ok) throw new Error(`runQuery ${collectionId} -> ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    return rows.map((row) => row.document).filter(Boolean).map((d) => ({
      id: d.name.split('/').pop(),
      data: fieldsToJs(d.fields || {})
    }));
  }
  async function getDoc(coll, id) {
    const r = await fetch(`${baseUrl}/${coll}/${id}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`get ${coll}/${id} -> ${r.status}`);
    const body = await r.json();
    return { id, data: fieldsToJs(body.fields || {}) };
  }
  async function deleteDoc(coll, id) {
    const r = await fetch(`${baseUrl}/${coll}/${id}`, { method: 'DELETE', headers });
    if (!r.ok && r.status !== 404) throw new Error(`del ${coll}/${id} -> ${r.status}: ${await r.text()}`);
  }
  async function patchPlayerStateIdle(uid) {
    const player = await getDoc('players', uid);
    if (!player) return false;
    if (player.data.state === 'idle') return false;
    const r = await fetch(`${baseUrl}/players/${uid}?updateMask.fieldPaths=state&updateMask.fieldPaths=updatedAt`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ fields: { state: { stringValue: 'idle' }, updatedAt: { stringValue: new Date().toISOString() } } })
    });
    if (!r.ok) throw new Error(`patch player/${uid} -> ${r.status}: ${await r.text()}`);
    return true;
  }

  let queueRowsRemoved = 0;
  let playerStateResets = 0;

  for (const collection of ['matchmakingQueue_casual', 'matchmakingQueue_ranked']) {
    const rows = await listCollection(collection);
    console.log(`\n${collection}: ${rows.length} docs`);
    for (const row of rows) {
      const status = row.data.status;
      const gameId = row.data.gameId;
      let removeReason = null;

      if (status === 'matched' && gameId) {
        const game = await getDoc('games', gameId);
        if (!game || TERMINAL_STATUSES.has(game.data.status)) {
          removeReason = `game terminal (${game ? game.data.status : 'missing'})`;
        }
      } else if (status === 'stale' || status === 'cancelled') {
        removeReason = `status=${status}`;
      } else if (status === 'searching') {
        const updatedAt = Number(row.data.updatedAtMs || row.data.joinedAtMs || 0);
        if (updatedAt && Date.now() - updatedAt > 5 * 60 * 1000) {
          removeReason = `searching for ${Math.round((Date.now() - updatedAt) / 60000)} min`;
        }
      }

      if (!removeReason) continue;
      console.log(`  ${dryRun ? '[dry]' : '     '} delete ${collection}/${row.id} (status=${status}, ${removeReason})`);
      if (!dryRun) {
        await deleteDoc(collection, row.id);
        queueRowsRemoved++;
        try {
          const reset = await patchPlayerStateIdle(row.id);
          if (reset) {
            console.log(`           reset player ${row.id} state -> idle`);
            playerStateResets++;
          }
        } catch (e) {
          console.log(`           WARN reset state failed: ${e.message}`);
        }
      }
    }
  }

  // Sweep players whose state is non-idle but no active game references them.
  const players = await listCollection('players');
  const stuck = players.filter((p) => p.data.state && p.data.state !== 'idle');
  for (const p of stuck) {
    const uid = p.id;
    // Look for an active game; if none, reset state.
    const activeQuery = await fetch(`${baseUrl}:runQuery`, {
      method: 'POST', headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'games' }],
          where: { compositeFilter: { op: 'AND', filters: [
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'active' } } },
            { fieldFilter: { field: { fieldPath: 'player1uid' }, op: 'EQUAL', value: { stringValue: uid } } }
          ] } }
        }
      })
    });
    const activeRows1 = (await activeQuery.json()).filter((r) => r.document);
    let hasActive = activeRows1.length > 0;
    if (!hasActive) {
      const q2 = await fetch(`${baseUrl}:runQuery`, {
        method: 'POST', headers,
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'games' }],
            where: { compositeFilter: { op: 'AND', filters: [
              { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'active' } } },
              { fieldFilter: { field: { fieldPath: 'player2uid' }, op: 'EQUAL', value: { stringValue: uid } } }
            ] } }
          }
        })
      });
      hasActive = (await q2.json()).filter((r) => r.document).length > 0;
    }
    if (hasActive) continue;
    console.log(`  ${dryRun ? '[dry]' : '     '} reset orphan player/${uid} state ${p.data.state} -> idle`);
    if (!dryRun) {
      try {
        const reset = await patchPlayerStateIdle(uid);
        if (reset) playerStateResets++;
      } catch (e) {
        console.log(`           WARN: ${e.message}`);
      }
    }
  }

  console.log(`\nDone. Removed ${queueRowsRemoved} queue rows, reset ${playerStateResets} player states.`);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
