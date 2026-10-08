// Counts down to the launch (10 Oct 2026, 00:00 IST). At zero the server switches this
// address to the game, so the page reloads after a short random wait (no stampede).
(function () {
  'use strict';
  var LAUNCH = Date.UTC(2026, 9, 9, 18, 30, 0); // 2026-10-10 00:00 +05:30
  var ids = ['d', 'h', 'm', 's'];
  var els = ids.map(function (id) { return document.getElementById(id); });
  var live = document.getElementById('live');
  var clock = document.getElementById('clock');
  var reloading = false;

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var left = Math.max(0, LAUNCH - Date.now());
    var s = Math.floor(left / 1000);
    var parts = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
    for (var i = 0; i < 4; i++) els[i].textContent = pad(parts[i]);
    clock.setAttribute('aria-label', parts[0] + ' days, ' + parts[1] + ' hours, ' + parts[2] + ' minutes left');
    if (left === 0 && !reloading) {
      reloading = true;
      live.hidden = false;
      setTimeout(function () { location.reload(); }, 5000 + Math.random() * 15000);
    }
  }

  tick();
  setInterval(tick, 1000);
})();
