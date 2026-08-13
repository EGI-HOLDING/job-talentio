(function () {
  var q = new URLSearchParams(location.search);
  var botId = q.get('bot_id') || '';
  var lang = q.get('lang') || '';
  var origin = q.get('origin') || location.origin;
  if (!botId) return;

  var auth =
    'https://oauth.telegram.org/auth?bot_id=' +
    encodeURIComponent(botId) +
    '&origin=' +
    encodeURIComponent(origin) +
    '&request_access=write' +
    (lang ? '&lang=' + encodeURIComponent(lang) : '') +
    '&return_to=' +
    encodeURIComponent(origin);

  var logout =
    'https://oauth.telegram.org/auth/logout?bot_id=' +
    encodeURIComponent(botId) +
    '&origin=' +
    encodeURIComponent(origin);

  var gone = false;
  function goAuth() {
    if (gone) return;
    gone = true;
    location.replace(auth);
  }

  var iframe = document.createElement('iframe');
  iframe.src = logout;
  iframe.title = '';
  iframe.style.cssText =
    'position:absolute;width:1px;height:1px;opacity:0;border:0;left:-9999px;top:-9999px';
  iframe.onload = function () {
    window.setTimeout(goAuth, 250);
  };
  iframe.onerror = goAuth;
  document.body.appendChild(iframe);
  window.setTimeout(goAuth, 900);
})();
