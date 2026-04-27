# collector-game

## Deploy To Firebase Hosting

This app is configured as a PWA and can be installed on a phone after deployment.

### One-time setup

1. Install dependencies:

```bash
npm install
```

2. Log in to Firebase CLI:

```bash
npm run firebase:login
```

### Deploy

```bash
npm run firebase:deploy
```

This command builds the app and deploys `dist/` to Firebase Hosting, plus Firestore rules/indexes.

### Deploy only hosting (optional)

```bash
npm run firebase:deploy:hosting
```

### Deploy only Firestore config (optional)

```bash
npm run firebase:deploy:firestore
```

### Spark plan notes

This repository is configured to work on Firebase Spark (free) without Cloud Functions.

1. Matchmaking runs client-side using Firestore transactions.
2. Ranked mode still uses matchmaking-only in the UI.
3. Security is best-effort on Spark; server-authoritative anti-cheat requires Blaze + Functions.

### Optional secure backend (Blaze required)

Install Cloud Function dependencies once:

```bash
cd functions
npm install
cd ..
```

Deploy Functions:

```bash
npx firebase-tools deploy --only functions
```

### Local hosting emulator (optional)

```bash
npm run firebase:serve
```

## Install On Phone

After deployment, open your Firebase Hosting URL on your phone.

1. Android (Chrome): open menu and choose `Install app` or `Add to Home screen`.
2. iPhone (Safari): tap Share and choose `Add to Home Screen`.

## Notes About Offline Play

1. Offline gameplay pages work after the app is opened once online, because assets are cached by the service worker.
2. Online multiplayer/Firebase features still require internet access.

