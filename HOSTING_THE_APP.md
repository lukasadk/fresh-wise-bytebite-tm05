# Publishing the app so other people can open it

The API is already hosted (see `backend/RAILWAY.md`). This is the other half:
getting the app itself off your laptop.

Right now Metro serves the JS bundle from your machine, so nobody can open
FreshWise unless `npx expo start` is running and they're on your Wi-Fi. EAS
fixes that.

Two options. Start with the first.

---

## Option A — `eas update` (a link that opens in Expo Go)

Best first step: free, no build queue, works on iOS and Android, no Apple
Developer account.

```bash
npm install -g eas-cli
eas login                 # your Expo account (free to create)
eas init                  # writes extra.eas.projectId into app.json
eas update:configure      # adds the updates URL + runtimeVersion
eas update --branch preview --message "First hosted build"
```

The CLI prints a link and a QR code. Anyone with Expo Go installed can open it
from any network, with your laptop closed.

**Your `.env` is baked in here.** `eas update` bundles on *your* machine, so
`EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_API_KEY` come from your local
`.env`. Check it points at Railway (not the Tailscale host) before publishing,
or you'll ship a build that only works on your tailnet.

To publish changes later, run `eas update` again. People get the new version on
next open -- no reinstall.

---

## Option B — `eas build` (an installable Android APK)

When you want something that doesn't need Expo Go at all.

```bash
eas build --platform android --profile preview
```

`preview` is configured in `eas.json` to produce an `.apk` (installable
directly) rather than an `.aab` (Play Store only). The build runs on Expo's
servers; you get a download link when it finishes.

**Builds do NOT see your local `.env`.** EAS servers never receive it. So:

- `EXPO_PUBLIC_API_BASE_URL` is set in `eas.json` under each profile's `env`.
- `EXPO_PUBLIC_API_KEY` is **not** in `eas.json` on purpose -- this repo is
  public. Set it as an EAS environment variable instead:

  ```bash
  eas env:create --name EXPO_PUBLIC_API_KEY --value "<your key>" --environment preview
  ```

  or via the project's Environment Variables page on expo.dev.

Miss that step and the app builds fine, then 401s on every request, because it
sent no key.

### iOS

An installable iOS build needs an Apple Developer account (~US$99/yr). Without
one, iPhone users use Option A and open the app in Expo Go. That's the normal
arrangement for a student project.

---