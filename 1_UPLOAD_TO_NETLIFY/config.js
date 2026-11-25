/* TimerMask configuration. Edit values here before building the Android app. */
window.TM_CONFIG = {
  version: '3.0.0',

  /* Monetisation: free with one banner, one-time purchase to remove ads (no subscriptions). */
  productId: 'remove_ads',          // Must match the in-app product ID created in Google Play Console.
  priceFallback: '€2.99',           // Shown until Google Play reports the real, localised price.
  admob: {
    // Google's official TEST banner unit. Replace with your real AdMob banner unit ID and set testing:false for release.
    bannerAndroid: 'ca-app-pub-3940256099942544/6300978111',
    testing: true
  },

  /* Optional external links. Leave coffeeUrl empty to hide the "Buy Me a Coffee" button. */
  coffeeUrl: ''
};
