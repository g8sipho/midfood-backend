# Building the MidFood app

Builds run on Expo's build service (EAS), started from GitHub so no computer
needs anything installed.

## Where things are

- **Expo account:** expo.dev, signed in with Google (g8vipexclusive@gmail.com),
  account `g8-vip`, project **G8 MidFood** (slug `g8-midfood`, project id in
  `app.json` → `extra.eas.projectId`). That id is what routes push
  notifications to this app.
- **Build pipeline:** GitHub → Actions → **Mobile app build** → Run workflow →
  pick `apk` (test file for a phone), `android` (Play Store bundle) or `ios`.
  It needs the repository secret `EXPO_TOKEN` (expo.dev → account settings →
  Access tokens). When it finishes, the download link is in the run's summary
  and the file is attached to the run; it is also listed under Builds on
  expo.dev.

## From a computer instead (optional)

```bash
cd mobile
npm install
npx eas login
npm run build:apk        # installable APK for testing on your own phone
npm run build:android    # Play Store bundle (.aab)
npm run build:ios        # App Store build — needs an Apple Developer account
```

The APK can be downloaded straight to a phone and installed (allow "install
from unknown sources" when prompted).

## Before submitting to the stores

- **Privacy policy URL:** https://midfood.co.za/privacy/
- **Data safety / App Privacy declarations.** Declare that the app collects:
  name, email, phone number, delivery address, order history, and — for driver
  accounts only — location while on duty. Nothing is sold or used for ads.
- **Apple needs a demo account.** Create a normal customer login and give the
  reviewer those details, or they cannot test past the sign-in screen.
- **Screenshots** from a real phone, showing real restaurants.

## What will get the app rejected

The stores reject apps that are empty shells. Until real Middelburg
restaurants are signed up and visible in the app, a reviewer opening it sees
placeholder content, and Apple in particular rejects that quickly. Get real
restaurants on first; the submission is easy afterwards.
