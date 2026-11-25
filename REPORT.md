# TimerMask v3.0 – report
Upload the files in 1_UPLOAD_TO_NETLIFY (they replace the same-named files; logo.png and icon-180/192/512.png are unchanged). Android/Play steps: 2_ANDROID_KIT/PLAY_STORE_GUIDE.md.

## Changed
Timer engine rewritten drift-free (absolute time, resync after lock/background, catch-up of missed phases, session restore); default for interruptions is now "keep counting". UI/layout reworked for small phones, landscape, desktop; bottom nav; Android Back; accessibility (labels, 44px targets, contrast guard, reduced motion, live announcements); 12 languages × 176 keys; input validation and storage hardening (XSS/corrupt data/__proto__); offline PWA (versioned cache); security headers + CSP; privacy page; native bridge for AdMob banner + consent, Play Billing remove-ads (€2.99 one-time), background alerts, keep-awake. Existing modes, presets, ring styles and colours kept.

## Tested (automated)
16 unit, 127 end-to-end (timing, 100-round drift, lock/background, presets, fuzzing, 12 languages, overflow on 5 viewports × 5 pages, a11y, mocked native plugins), offline test.

## Limitations
Native features were only tested against mocks – check on a real Android phone (checklist in the guide). APK/AAB could not be built here. Translations are machine quality: have native speakers review (Italian first). Browsers cannot play sound with a locked screen (the Android app uses notifications).

## Before publication
Fill name/e-mail in privacy.html; real AdMob IDs and testing:false; create product `remove_ads` (€2.99); confirm package name; Data Safety/content rating/exact-alarm declaration; closed test with 12 testers for 14 days; check the name "TimerMask" for conflicts.
