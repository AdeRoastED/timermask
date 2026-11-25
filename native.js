/* TimerMask native bridge.
   In a normal browser/PWA this module does nothing (isNative=false) and the app hides ad/purchase features.
   Inside the Capacitor Android app it connects: AdMob banner, Google Play Billing (one-time "remove ads"),
   background alerts (Local Notifications) and keep-awake.
   Plugins are read lazily from window.Capacitor.Plugins, so no bundler is required. Every call is wrapped so a
   missing/failed plugin can never break the timer. */
(function (root) {
  'use strict';
  const CFG = root.TM_CONFIG || {};
  const AD_KEY = 'tm_adfree';
  const cap = () => root.Capacitor;
  const plugin = (name) => { try { return cap() && cap().Plugins && cap().Plugins[name]; } catch (e) { return undefined; } };
  const isNative = () => { try { return !!(cap() && cap().isNativePlatform && cap().isNativePlatform()); } catch (e) { return false; } };

  const listeners = { adFree: [], adHeight: [], price: [] };
  const emit = (k, v) => listeners[k].forEach(fn => { try { fn(v); } catch (e) { /* ignore */ } });

  let adFree = false;
  try { adFree = localStorage.getItem(AD_KEY) === '1'; } catch (e) { /* ignore */ }
  let price = CFG.priceFallback || '€2.99';
  let bannerShown = false, bannerHidden = false, adsReady = false, wantBanner = false, billingReady = false, notifReady = false;

  function setAdFree(v) {
    v = !!v;
    if (v === adFree) return;
    adFree = v;
    try { localStorage.setItem(AD_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ }
    if (v) hideBanner(true);
    emit('adFree', v);
  }

  /* ---------- Ads (AdMob) ---------- */
  async function initAds() {
    const AdMob = plugin('AdMob');
    if (!AdMob || adsReady) return;
    try {
      await AdMob.initialize({ initializeForTesting: !!(CFG.admob && CFG.admob.testing) });
      try { // EU/UK consent (UMP). Required before showing personalised ads in the EEA.
        const info = await AdMob.requestConsentInfo();
        if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') await AdMob.showConsentForm();
      } catch (e) { /* consent unavailable: AdMob serves non-personalised ads where required */ }
      try { AdMob.addListener('bannerAdSizeChanged', (s) => emit('adHeight', (s && s.height) || 0)); } catch (e) { /* ignore */ }
      adsReady = true;
      if (wantBanner && !adFree) showBanner();
    } catch (e) { /* ads are optional */ }
  }
  async function showBanner() {
    wantBanner = true;
    if (adFree || !isNative()) return;
    const AdMob = plugin('AdMob');
    if (!AdMob || !adsReady) return;
    try {
      if (bannerShown) { if (bannerHidden) { bannerHidden = false; await AdMob.resumeBanner(); } return; }
      bannerShown = true; bannerHidden = false;
      await AdMob.showBanner({
        adId: CFG.admob && CFG.admob.bannerAndroid, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER',
        margin: 0, isTesting: !!(CFG.admob && CFG.admob.testing)
      });
    } catch (e) { bannerShown = false; }
  }
  async function hideBanner(remove) {
    wantBanner = false;
    const AdMob = plugin('AdMob');
    if (!AdMob || !bannerShown) { emit('adHeight', 0); return; }
    try {
      if (remove) { await AdMob.removeBanner(); bannerShown = false; bannerHidden = false; }
      else if (!bannerHidden) { bannerHidden = true; await AdMob.hideBanner(); }
    } catch (e) { /* ignore */ }
    emit('adHeight', 0);
  }
  async function openAdChoices() {
    const AdMob = plugin('AdMob');
    try { if (AdMob && AdMob.showPrivacyOptionsForm) await AdMob.showPrivacyOptionsForm(); } catch (e) { /* ignore */ }
  }

  /* ---------- Billing (cordova-plugin-purchase v13) ---------- */
  function initBilling() {
    const C = root.CdvPurchase;
    if (!C || billingReady || !isNative()) return;
    try {
      const { store, Platform, ProductType } = C;
      const pid = CFG.productId || 'remove_ads';
      store.register([{ id: pid, type: ProductType.NON_CONSUMABLE, platform: Platform.GOOGLE_PLAY }]);
      const refresh = () => {
        try {
          const p = store.get(pid, Platform.GOOGLE_PLAY);
          const offer = p && p.getOffer && p.getOffer();
          const ph = offer && offer.pricingPhases && offer.pricingPhases[0];
          if (ph && ph.price) { price = ph.price; emit('price', price); }
          if (store.owned && store.owned(pid)) setAdFree(true);
          else if (p && p.canPurchase) setAdFree(false); // store answered and the product is not owned (e.g. refunded)
        } catch (e) { /* ignore */ }
      };
      store.when().productUpdated(refresh).approved((tx) => tx.finish()).finished(refresh);
      store.initialize([Platform.GOOGLE_PLAY]).then(refresh).catch(() => {});
      billingReady = true;
    } catch (e) { /* billing optional */ }
  }
  async function purchaseRemoveAds() {
    const C = root.CdvPurchase;
    if (!C || !billingReady) return 'unavailable';
    try {
      const { store, Platform } = C;
      const p = store.get(CFG.productId || 'remove_ads', Platform.GOOGLE_PLAY);
      const offer = p && p.getOffer && p.getOffer();
      if (!offer) return 'unavailable';
      const err = await offer.order();
      if (err) return err.code === C.ErrorCode.PAYMENT_CANCELLED ? 'cancel' : 'fail';
      return adFree ? 'ok' : 'pending';
    } catch (e) { return 'fail'; }
  }
  async function restorePurchases() {
    const C = root.CdvPurchase;
    if (!C || !billingReady) return false;
    try { await C.store.restorePurchases(); } catch (e) { /* ignore */ }
    return adFree;
  }

  /* ---------- Background alerts (Local Notifications) ---------- */
  const ALERT_BASE = 7000, ALERT_MAX = 60;
  async function initNotifications() {
    const LN = plugin('LocalNotifications');
    if (!LN || notifReady || !isNative()) return notifReady;
    try {
      const perm = await LN.requestPermissions();
      if (perm && perm.display === 'denied') return false;
      try { await LN.createChannel({ id: 'timer_alerts', name: 'Timer alerts', description: 'Phase changes and timer completion', importance: 5, visibility: 1, vibration: true }); } catch (e) { /* ignore */ }
      notifReady = true;
    } catch (e) { /* ignore */ }
    return notifReady;
  }
  /* items: [{atMs:<epoch ms>, title, body}] */
  async function scheduleAlerts(items) {
    const LN = plugin('LocalNotifications');
    if (!LN || !isNative() || !items || !items.length) return;
    if (!(await initNotifications())) return;
    try {
      await cancelAlerts();
      const notifications = items.slice(0, ALERT_MAX).map((it, i) => ({
        id: ALERT_BASE + i, title: it.title, body: it.body, channelId: 'timer_alerts',
        schedule: { at: new Date(it.atMs), allowWhileIdle: true }
      }));
      await LN.schedule({ notifications });
    } catch (e) { /* ignore */ }
  }
  async function cancelAlerts() {
    const LN = plugin('LocalNotifications');
    if (!LN || !isNative()) return;
    try {
      const ids = Array.from({ length: ALERT_MAX }, (_, i) => ({ id: ALERT_BASE + i }));
      await LN.cancel({ notifications: ids });
    } catch (e) { /* ignore */ }
  }

  /* ---------- Keep awake ---------- */
  async function keepAwake(on) {
    const KA = plugin('KeepAwake');
    if (!KA || !isNative()) return false;
    try { await (on ? KA.keepAwake() : KA.allowSleep()); return true; } catch (e) { return false; }
  }

  /* ---------- Lifecycle ---------- */
  function onAppState(cb) {
    const App = plugin('App');
    try { if (App && App.addListener) App.addListener('appStateChange', (s) => cb(!!(s && s.isActive))); } catch (e) { /* ignore */ }
  }

  function init() {
    if (!isNative()) return;
    initAds();
    if (root.CdvPurchase) initBilling();
    else document.addEventListener('deviceready', initBilling, { once: true });
    // billing plugin may attach slightly later than DOMContentLoaded
    setTimeout(initBilling, 2500);
  }

  root.TMNative = {
    get isNative() { return isNative(); },
    get platform() { try { return cap() && cap().getPlatform ? cap().getPlatform() : 'web'; } catch (e) { return 'web'; } },
    get adFree() { return adFree; },
    get price() { return price; },
    get billingReady() { return billingReady; },
    init, showBanner, hideBanner, openAdChoices, purchaseRemoveAds, restorePurchases,
    scheduleAlerts, cancelAlerts, initNotifications, keepAwake, onAppState,
    on(evt, fn) { if (listeners[evt]) listeners[evt].push(fn); }
  };
})(typeof self !== 'undefined' ? self : this);
