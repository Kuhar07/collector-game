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

This command builds the app and deploys `dist/` to Firebase Hosting.

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

