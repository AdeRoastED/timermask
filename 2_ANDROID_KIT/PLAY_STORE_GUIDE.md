# TimerMask → Google Play: step-by-step

You do not need to write code. You need a Windows/Mac/Linux computer, ~2 GB free disk and a free afternoon.

## 0. What is already done
* Web app v3.0 (offline-capable PWA) with a built-in "native bridge" that automatically switches on AdMob banner, Google Play Billing (€2.99 remove-ads, one-time), background alerts and keep-awake **only inside the Android app**.
* Store assets (`3_STORE_ASSETS`), privacy policy page, listing text, Data Safety answers (below).

## 1. One-time accounts (do these first – they have waiting times)
1. **Google Play Console** developer account (one-time US$25). Personal accounts created after 13 Nov 2023 must run a **closed test with at least 12 testers for 14 days** before production access. Start this early; ask friends, students and family to join.
2. **AdMob** account (admob.google.com): add an Android app "TimerMask", create one **Banner** ad unit. Note the *App ID* (`ca-app-pub-…~…`) and *Banner unit ID* (`ca-app-pub-…/…`).
3. A **payments profile** in Play Console (Setup → Payments profile) – needed to sell the €2.99 product.
4. Host the web app on Netlify (as now) so `https://<your-site>/privacy.html` is a public URL: Play requires a privacy-policy URL. **Fill in your name and e-mail in `privacy.html` first.**

## 2. Install the tools (once)
* Node.js 22 or newer · Java JDK 21 · **Android Studio** (Otter 2025.2.1 or newer). Capacitor 8 targets Android 16 (API 36), which Google Play requires for new apps since 31 Aug 2026.

## 3. Create the Android project
```
cd 2_ANDROID_KIT
npm install
npm run prepare-www          # copies the web app into ./www
npx cap add android          # creates the ./android project
```
Then apply **AndroidManifest-additions.md**, and edit `www/config.js` **before every release build**:
```js
admob: { bannerAndroid: 'ca-app-pub-XXXX/YYYY', testing: false },
```
(Keep `testing:true` and Google's test IDs while you test, otherwise you risk an AdMob account ban for clicking your own ads.)

If you change `appId` (`com.timermask.app`) do it now: **the package name can never change after publishing.**

## 4. Build and test on a phone
```
npm run sync
npm run open                 # opens Android Studio
```
In Android Studio: plug in a phone (USB debugging) → ▶ Run. Check the checklist in section 8.

## 5. Make the release bundle
Android Studio → *Build → Generate Signed App Bundle (AAB)* → create a new keystore (**back it up and never lose it; also enable Play App Signing**) → release. Upload the `.aab`.

## 6. Play Console setup
* **Create the in-app product**: Monetize → Products → In-app products → ID **`remove_ads`** (must match config.js), type one-time (non-consumable), price **€2.99**, activate. (Do NOT create subscriptions.)
* **Store listing**: use `STORE_LISTING.md`, icon `app_icon_512.png`, feature graphic, ≥2 phone screenshots.
* **App content**: Privacy policy URL · Ads: *Yes, contains ads* · Target audience: **13+ or 18+ (not children)**, otherwise the stricter Families/Ads policies apply · Content rating questionnaire (utility app, no violence etc.) · Data safety (see `DATA_SAFETY.md`) · Permission declaration for exact alarms (core feature: timer).
* Create a **Closed testing** release, add ≥12 testers' e-mails, share the opt-in link, keep them opted in **14 days**, then *Apply for production*.
* Use **License testers** (Setup → License testing) to test the purchase without paying.

## 7. After launch
Reply to reviews, watch Android vitals (crashes), update `VERSION` in `sw.js`/`config.js` for every web release, rebuild the AAB with a higher `versionCode` for every store update.

## 8. Device checklist (the things automation cannot prove)
- [ ] Banner appears on Home; disappears when the timer runs and in fullscreen; nav bar is not covered by the banner.
- [ ] Buy "remove ads" with a license-tester account → banner disappears; reinstall → *Restore purchase* brings it back.
- [ ] Start a timer, lock the screen: notifications ring at each phase change; unlock → time is correct.
- [ ] Incoming phone call during a timer → after the call the time is right (Keep counting) or paused (Pause mode).
- [ ] Rotate portrait/landscape mid-timer: no reset, layout fits.
- [ ] Android Back button: Settings sub-page → menu → Home → exits.
- [ ] Airplane mode: everything works.
- [ ] Edge-to-edge (Android 15/16): top and bottom bars do not overlap content.
- [ ] EEA/UK test (VPN or AdMob debug geography): consent form appears; Settings → Ad choices reopens it.

## 9. Legal/copyright notes
* Artwork (logo, icons, screenshots) is your own; sounds are generated in code (no audio files); no third-party fonts or images are bundled.
* Open-source components: Capacitor (MIT), @capacitor-community/admob (MIT), @capacitor-community/keep-awake (MIT), cordova-plugin-purchase (MIT). MIT requires keeping their licence notices in the node_modules, which the build does.
* Check the name "TimerMask" for conflicts (Play Store search, EUIPO/USPTO) before investing in marketing.
