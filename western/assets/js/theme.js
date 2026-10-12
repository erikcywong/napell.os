/* Napell Coffee Chain OS — theme switcher (light "institutional" default / dark terminal) */
(function () {
  var KEY = 'napell_theme';
  var root = document.documentElement;

  function isDark() { return root.getAttribute('data-theme') === 'dark'; }

  function paint() {
    var b = document.getElementById('themeToggle');
    if (b) b.textContent = isDark() ? 'Paper edition' : 'Dark edition';
  }

  function set(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode */ }
    paint();
  }

  window.NAPELL_THEME = { set: set, get: function () { return isDark() ? 'dark' : 'light'; } };

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('themeToggle');
    if (b) {
      b.addEventListener('click', function () { set(isDark() ? 'light' : 'dark'); });
    }
    paint();
  });
})();
