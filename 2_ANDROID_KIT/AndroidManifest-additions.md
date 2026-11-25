# Edits to `android/app/src/main/AndroidManifest.xml` (after `npx cap add android`)

Add these **inside `<manifest>`** (next to the existing `INTERNET` permission):
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.USE_EXACT_ALARM" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="com.google.android.gms.permission.AD_ID" />
```
Add this **inside `<application>`** (use your real AdMob *App ID*; the value below is Google's public TEST app ID):
```xml
<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-3940256099942544~3347511713"/>
```
Notes
* `USE_EXACT_ALARM` is allowed by Google Play for apps whose core function is a timer/alarm, which TimerMask is. Describe it that way in the Play Console permission declaration.
* Keep `android:screenOrientation` unset so portrait and landscape both work.
* App icon: in Android Studio use *File → New → Image Asset*, choose `icon-maskable-512.png` as the foreground/background image (or "Legacy icon" mode), so the launcher icon matches.
