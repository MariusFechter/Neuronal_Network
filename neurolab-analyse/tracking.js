/* Neuronal Network – gemeinsames Tracking (Meta Pixel + Conversions API)
 * Ablage: https://www.neuronalnetwork.de/neurolab-analyse/tracking.js
 * Eingebunden auf: Landingpage, Checkout, Zugang-Seite.
 *
 * Jedes Event geht browserseitig (Pixel) UND serverseitig (CAPI über den Stripe-Worker)
 * mit derselben event_id raus, damit Meta es dedupliziert.
 */
(function () {
  'use strict';

  var PIXEL_ID = '1988847275335071';
  var WORKER = 'https://stripe-checkout-bridge.theneuronalnetwork.workers.dev';
  var COOKIE_DOMAIN = '.neuronalnetwork.de';
  var PRODUCT = { id: 'analyse', name: 'Rausch oder Realität?', amount: 1490, currency: 'EUR' };
  var EMAIL_RE = /^\S+@\S+\.\S+$/;

  // ---------- Einwilligung / Testmodus ----------
  // ?notrack=1 schaltet das Tracking für diesen Tab ab (bleibt über alle Seiten im Tab bestehen),
  // ?notrack=0 schaltet es wieder ein.
  // HIER später die echte Consent-Abfrage (Cookie-Banner) eintragen, z. B. "return window.nnConsent === true;"
  function hasConsent() {
    var q = new URLSearchParams(location.search).get('notrack');
    try {
      if (q === '1') sessionStorage.setItem('nn_notrack', '1');
      if (q === '0') sessionStorage.removeItem('nn_notrack');
      if (sessionStorage.getItem('nn_notrack') === '1') return false;
    } catch (e) {
      if (q === '1') return false;
    }
    return true;
  }

  // ---------- Cookies & IDs ----------
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : '';
  }
  function setCookie(name, value, days) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; max-age=' + (days * 86400) +
      '; path=/; domain=' + COOKIE_DOMAIN + '; SameSite=Lax; Secure';
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  }

  // _fbp: Wenn der Pixel noch nicht geladen ist, legen wir das Cookie im von Meta vorgegebenen Format selbst an.
  // So hat auch das allererste CAPI-Event schon eine fbp, und Pixel und CAPI nutzen dieselbe.
  function ensureFbp() {
    var v = getCookie('_fbp');
    if (v) return v;
    v = 'fb.1.' + Date.now() + '.' + Math.floor(1000000000 + Math.random() * 8999999999);
    setCookie('_fbp', v, 90);
    return v;
  }
  // _fbc: aus dem Cookie, sonst aus ?fbclid=... (und dann als Cookie speichern, damit alle Seiten dasselbe nutzen)
  function getFbc() {
    var c = getCookie('_fbc');
    if (c) return c;
    var id = new URLSearchParams(location.search).get('fbclid');
    if (!id) return '';
    var v = 'fb.1.' + Date.now() + '.' + id;
    setCookie('_fbc', v, 90);
    return v;
  }
  // external_id: zufällige First-Party-ID, verbindet ViewContent, Checkout und Kauf miteinander
  function getXid() {
    var v = getCookie('nn_xid');
    if (/^[\w-]{8,64}$/.test(v)) return v;
    v = uuid();
    setCookie('nn_xid', v, 365);
    return v;
  }
  function identity() {
    if (!hasConsent()) return { fbp: '', fbc: '', external_id: '' };
    return { fbp: ensureFbp(), fbc: getFbc(), external_id: getXid() };
  }

  function whenActive(fn) {
    if (document.prerendering) document.addEventListener('prerenderingchange', fn, { once: true });
    else fn();
  }

  // Ruft fn auf, sobald die Seite insgesamt `seconds` Sekunden im Vordergrund sichtbar war
  function afterVisibleTime(seconds, fn) {
    var seen = 0, done = false;
    var t = setInterval(function () {
      if (document.visibilityState === 'visible') seen += 0.5;
      if (!done && seen >= seconds) { done = true; clearInterval(t); fn(); }
    }, 500);
  }

  // ---------- Meta Pixel ----------
  var pixelReady = false;
  function loadPixelScript() {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  }
  // withPageView = true: zusätzlich PageView senden
  function initPixel(withPageView) {
    if (!hasConsent()) return false;
    if (!pixelReady) {
      ensureFbp(); getFbc();
      loadPixelScript();
      fbq('set', 'autoConfig', false, PIXEL_ID);   // keine automatisch erkannten Events
      fbq('init', PIXEL_ID, { external_id: getXid() });
      pixelReady = true;
    }
    if (withPageView) fbq('track', 'PageView');
    return true;
  }

  // ---------- Event senden: Pixel + CAPI mit gleicher event_id ----------
  // opts: { email, name, eventId }
  function track(eventName, opts) {
    if (!hasConsent()) return null;
    opts = opts || {};
    var eventId = opts.eventId || uuid();

    // NEU: CTA-Tracking – wurde InitiateCheckout schon auf der LP gesendet, hier nicht nochmal
    if (!opts.eventId && eventName === 'InitiateCheckout') {
      try {
        var shared = sessionStorage.getItem('nn_ic_event_id');
        if (shared) { sessionStorage.removeItem('nn_ic_event_id'); return shared; }
      } catch (e) {}
    }
    
    var id = identity();
    if (!pixelReady) initPixel(false);

    if (typeof fbq === 'function') {
      fbq('track', eventName, {
        value: PRODUCT.amount / 100,
        currency: PRODUCT.currency,
        content_ids: [PRODUCT.id],
        content_name: PRODUCT.name,
        content_type: 'product'
      }, { eventID: eventId });
    }

    var email = String(opts.email || '').trim();
    fetch(WORKER + '/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        event_name: eventName,
        event_id: eventId,
        product_id: PRODUCT.id,
        fbp: id.fbp,
        fbc: id.fbc,
        external_id: id.external_id,
        email: EMAIL_RE.test(email) ? email : '',
        name: String(opts.name || '').trim().slice(0, 100),
        event_source_url: location.href,
        cta_source: String(opts.cta_source || '') // NEU
      })
    }).catch(function () {});
    return eventId;
  }

  window.NN = {
    PRODUCT: PRODUCT,
    hasConsent: hasConsent,
    whenActive: whenActive,
    afterVisibleTime: afterVisibleTime,
    initPixel: initPixel,
    track: track,
    identity: identity
  };
})();
