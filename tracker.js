/*
 * Apple Card PT — Tracking unificado
 *
 *   • Inicializa o TikTok Pixel (sdkid D7UKM8JC77U07JNLKKV0) e o Meta Pixel
 *     (id 1698181571306790).
 *   • Persiste UTMs + click ids (ttclid, fbclid, gclid, _ttp) no localStorage.
 *   • Expõe window.track(event, params) e window.identify() para o resto do funil.
 *   • Cada track() também é enviado para /api/tt (TikTok Events API) e /api/fb
 *     (Meta Conversions API) server-side, deduplicado por event_id, para
 *     melhorar match quality.
 *
 * Os eventos seguem a taxonomia padrão TikTok (Lead, AddToCart,
 * InitiateCheckout, AddPaymentInfo, Purchase, ViewContent, CompleteRegistration)
 * + eventos personalizados para o aprendizado do pixel.
 */

(function () {
  'use strict';

  // ─── Persistência de UTMs + click ids ───
  var TRACK_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ttclid','fbclid','gclid','src','sck'];
  var qs = new URLSearchParams(window.location.search);
  TRACK_KEYS.forEach(function (k) {
    var v = qs.get(k);
    if (v) localStorage.setItem('tt_' + k, v);
  });

  // ─── Stable external_id (UUID-like) ───
  var externalId = localStorage.getItem('tt_external_id');
  if (!externalId) {
    externalId = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('tt_external_id', externalId);
  }

  // ─── TikTok Pixel base snippet ───
  !function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = w[t] = w[t] || [];
    ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e };
    ttq.load = function (e, n) {
      var r = "https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = r;
      ttq._t = ttq._t || {}; ttq._t[e] = +new Date;
      ttq._o = ttq._o || {}; ttq._o[e] = n || {};
      n = document.createElement("script");
      n.type = "text/javascript"; n.async = !0; n.src = r + "?sdkid=" + e + "&lib=" + t;
      e = document.getElementsByTagName("script")[0];
      e.parentNode.insertBefore(n, e);
    };
    ttq.load('D7UKM8JC77U07JNLKKV0');
    ttq.page();
  }(window, document, 'ttq');

  // ─── Meta Pixel base snippet ───
  // Múltiplos pixels: adicione mais IDs ao array (os eventos vão para todos).
  var FB_PIXEL_IDS = ['1698181571306790', '1802295750545212'];
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
    n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  FB_PIXEL_IDS.forEach(function (pid) { window.fbq('init', pid, fbAdvancedMatching()); });
  window.fbq('track', 'PageView');

  // ─── Google Ads (gtag) ───
  var GADS_ID = 'AW-18161883701';
  var GADS_PURCHASE_LABEL = 'AW-18161883701/LdB0CJuT4MMcELW0odRD';
  !function () {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GADS_ID;
    var f = document.getElementsByTagName('script')[0];
    f.parentNode.insertBefore(s, f);
  }();
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('js', new Date());
  gtag('config', GADS_ID);

  // Dispara a conversão de Compra do Google Ads (dedup por transaction_id).
  window.googleAdsPurchase = function (value, transactionId) {
    try {
      if (!window.gtag) return;
      var v = parseFloat(value);
      window.gtag('event', 'conversion', {
        send_to: GADS_PURCHASE_LABEL,
        value: isFinite(v) ? v : 0,
        currency: 'EUR',
        transaction_id: transactionId || ''
      });
    } catch (e) { /* silencioso */ }
  };

  // Standard Events do Meta — os restantes vão como trackCustom (mesmo nome).
  var FB_STANDARD = { PageView:1, ViewContent:1, Search:1, AddToCart:1, AddToWishlist:1, InitiateCheckout:1, AddPaymentInfo:1, Purchase:1, Lead:1, CompleteRegistration:1, Contact:1, Subscribe:1, StartTrial:1, SubmitApplication:1, Schedule:1, FindLocation:1, Donate:1, CustomizeProduct:1 };

  // Advanced Matching do Meta a partir do LeadData (o pixel hasheia sozinho).
  function fbAdvancedMatching() {
    var lead = loadLead();
    var am = { external_id: externalId };
    if (lead.email) am.em = String(lead.email).trim().toLowerCase();
    var phone = normalizePhone(lead.telefone || lead.phone);
    if (phone) am.ph = phone.replace(/\D+/g, ''); // Meta: dígitos com código país
    return am;
  }

  // ─── LeadData helper (mesmo formato usado pelo resto do funil) ───
  function loadLead() {
    try { return JSON.parse(localStorage.getItem('applecard_lead') || '{}'); }
    catch (e) { return {}; }
  }

  function normalizePhone(raw) {
    if (!raw) return '';
    var digits = String(raw).replace(/\D+/g, '');
    if (digits.startsWith('351') && digits.length === 12) digits = digits.slice(3);
    return digits.length === 9 ? '+351' + digits : '';
  }

  // ─── Identify (chama sempre que tivermos dados PII frescos) ───
  function identify() {
    var lead = loadLead();
    var payload = { external_id: externalId };
    if (lead.email) payload.email = String(lead.email).trim().toLowerCase();
    var phone = normalizePhone(lead.telefone || lead.phone);
    if (phone) payload.phone_number = phone;
    if (window.ttq && window.ttq.identify) window.ttq.identify(payload);
    // Meta: re-init refresca o Advanced Matching sem re-disparar PageView.
    if (window.fbq) FB_PIXEL_IDS.forEach(function (pid) { window.fbq('init', pid, fbAdvancedMatching()); });
  }

  // Identify imediatamente (se já tivermos dados em localStorage de sessão anterior)
  identify();

  // ─── Helpers ───
  function newEventId(name) {
    return 'evt_' + externalId + '_' + name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  function commonProperties(extra) {
    extra = extra || {};
    if (!('currency' in extra)) extra.currency = 'EUR';
    if (!('content_type' in extra)) extra.content_type = 'product';
    return extra;
  }

  function sendServerSide(name, eventId, params) {
    try {
      var lead = loadLead();
      var body = {
        event: name,
        event_id: eventId,
        params: params,
        user: {
          external_id: externalId,
          email: lead.email || '',
          phone: lead.telefone || lead.phone || '',
        },
        page: {
          url: window.location.href,
          referrer: document.referrer || ''
        },
        ttclid: localStorage.getItem('tt_ttclid') || '',
        ttp: getCookie('_ttp') || '',
        fbc: getCookie('_fbc') || buildFbc(),
        fbp: getCookie('_fbp') || ''
      };
      var json = JSON.stringify(body);
      postBeacon('/api/tt', json); // TikTok Events API
      postBeacon('/api/fb', json); // Meta Conversions API
    } catch (e) { /* silencioso */ }
  }

  function postBeacon(url, json) {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: json,
          keepalive: true
        }).catch(function () {});
      }
    } catch (e) { /* silencioso */ }
  }

  // Constrói o _fbc a partir do fbclid (caso o pixel ainda não tenha gravado o cookie).
  function buildFbc() {
    var fbclid = localStorage.getItem('tt_fbclid') || qs.get('fbclid') || '';
    return fbclid ? ('fb.1.' + Date.now() + '.' + fbclid) : '';
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  // ─── API pública ───
  window.track = function (eventName, params) {
    if (!eventName) return;
    params = commonProperties(params);
    // Sanitiza value: TikTok/Meta rejeitam value não-numérico (string vinda do
    // localStorage, NaN de parseFloat, etc.) e descartam o evento todo.
    if ('value' in params) {
      var _v = parseFloat(params.value);
      params.value = isFinite(_v) ? _v : 0;
    }
    var eid = newEventId(eventName);
    params.event_id = eid;

    try {
      if (window.ttq && window.ttq.track) {
        window.ttq.track(eventName, params, { event_id: eid });
      }
    } catch (e) { /* silencioso */ }

    try {
      if (window.fbq) {
        var fbMethod = FB_STANDARD[eventName] ? 'track' : 'trackCustom';
        window.fbq(fbMethod, eventName, params, { eventID: eid });
      }
    } catch (e) { /* silencioso */ }

    sendServerSide(eventName, eid, params);
    return eid;
  };

  window.identifyUser = identify;

  // ─── Auto-track de cliques em CTAs marcados com data-track ───
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.track) {
        var params = {};
        if (el.dataset.trackValue) params.value = parseFloat(el.dataset.trackValue);
        if (el.dataset.trackContentId) params.content_id = el.dataset.trackContentId;
        window.track(el.dataset.track, params);
        break;
      }
      el = el.parentElement;
    }
  }, true);

  // Re-identify quando o utilizador volta pra a aba (capta updates do LeadData feitos noutras páginas)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) identify();
  });

  // ─── Footer comum (credibilidade) — adapta ao tema da página ───
  function mountChrome() {
    // Skip footer se a página já tiver um <footer> próprio (ex.: index.html).
    if (document.querySelector('footer') || document.getElementById('siteFooter')) return;

    // Skip em ecrãs que ocupam o viewport inteiro (loading screens, chat
    // full-height, ecrãs com flex centrado). Em qualquer um destes casos, o
    // footer ou fica inacessível (overflow:hidden) ou vira flex item lateral
    // (display:flex no body). Páginas afetadas: analise, configurando, chat,
    // verificacao, obrigado.
    var bodyStyle = getComputedStyle(document.body);
    var isFullscreen = bodyStyle.overflow === 'hidden'
                    || bodyStyle.overflowY === 'hidden'
                    || bodyStyle.display === 'flex';
    if (isFullscreen) return;

    // Skip em páginas que simulam app com nav fixa no fundo (ex.: dashboard.html).
    // O footer legal ficaria tapado pela nav e quebraria a imersão da "app".
    if (document.querySelector('.bottom-nav')) return;

    // Detecta tema (claro vs escuro) pela cor de fundo do body.
    var bg = bodyStyle.backgroundColor || '';
    var rgb = bg.match(/\d+/g) || [255, 255, 255];
    var lum = (0.299 * +rgb[0] + 0.587 * +rgb[1] + 0.114 * +rgb[2]) / 255;
    var isDark = lum < 0.5;

    var linkColor = isDark ? 'rgba(255,255,255,0.55)' : '#6E6E73';
    var noteColor = isDark ? 'rgba(255,255,255,0.35)' : '#86868B';
    var borderColor = isDark ? 'rgba(255,255,255,0.08)' : '#E8E8ED';

    var f = document.createElement('footer');
    f.id = 'siteFooter';
    f.setAttribute('style', 'max-width:520px;margin:0 auto;padding:20px 20px 28px;font-size:0.6875rem;color:' + noteColor + ';line-height:1.55;text-align:center;border-top:0.5px solid ' + borderColor + ';background:transparent;');
    f.innerHTML = ''
      + '<div style="margin-bottom:6px"><a href="/privacidade.html" style="color:' + linkColor + ';text-decoration:none;margin:0 6px">Privacidade</a> · '
      + '<a href="/termos.html" style="color:' + linkColor + ';text-decoration:none;margin:0 6px">Termos</a> · '
      + '<a href="/cookies.html" style="color:' + linkColor + ';text-decoration:none;margin:0 6px">Cookies</a> · '
      + '<a href="mailto:apoio@applecardpt.com" style="color:' + linkColor + ';text-decoration:none;margin:0 6px">Apoio</a></div>'
      + '<div>© 2026 Apple Card · Emitido por Goldman Sachs Bank USA</div>'
      + '<div style="margin-top:4px">Pagamentos via SIBS (MB WAY / Multibanco) · SSL 256 bits</div>';
    document.body.appendChild(f);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountChrome);
  } else {
    mountChrome();
  }

  window.__tracker_ready = true;
})();
