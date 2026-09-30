# Building the MidFood app

Everything here is ready. These are the only commands that need running, and
they must run on a computer with internet access to Expo's build service.

## One-time setup

```bash
cd mobile
npm install
npx eas login          # free Expo account — create one at expo.dev if needed
npx eas init           # links this project and writes the EAS project id
```

`eas init` adds `extra.eas.projectId` to app.json. That id is what routes push
notifications to this app, so push only works on builds made after this step.

## Builds

```bash
npm run build:apk        # installable APK for testing on your own phone
npm run build:android    # Play Store bundle (.aab)
npm run build:ios        # App Store build — needs an Apple Developer account
```

Each prints a link when it finishes. The APK can be downloaded straight to a
phone and installed (allow "install from unknown sources" when prompted).

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
