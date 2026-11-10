// Shard Heist boot: the error screen. Loaded before every other script.
// ### If a library cannot load (offline, blocked CDN, failed integrity check), the browser has no WebGL, or the game throws
// ### an error it did not expect, the player sees a clear card with what happened and a Reload button instead of a frozen
// ### or black page. Load failures can only be fixed by reloading; runtime errors also offer "Keep playing".
(function (){
  'use strict';
  let shown = false;
  const $ = id => document.getElementById(id);

  // ### title and text are always set with textContent, never as HTML, so an error message cannot inject markup.
  function showFatal(title, text, canDismiss){
    if (shown) return;
    const box = $('fatal');
    if (!box) return;
    shown = true;
    $('fatalTitle').textContent = title;
    $('fatalText').textContent = text;
    $('fatalDismiss').hidden = !canDismiss;
    box.hidden = false;
    $('fatalReload').focus();
    window.dispatchEvent(new Event('shardheist:fatal'));
  }
  window.ShardFatal = showFatal;

  document.addEventListener('DOMContentLoaded', () => {
    $('fatalReload').addEventListener('click', () => location.reload());
    $('fatalDismiss').addEventListener('click', () => { $('fatal').hidden = true; shown = false; });
  });

  // Capture phase: a <script> that fails to load fires "error" on the element, which does not bubble
  window.addEventListener('error', e => {
    const el = e.target;
    if (el && el.tagName === 'SCRIPT'){
      let host = 'a required file';
      try { host = new URL(el.src).host; } catch (err) {}
      showFatal('The game could not load', 'A required file from ' + host + ' did not load or failed its integrity check. Check your internet connection or turn off content blockers for this page, then reload.', false);
      return;
    }
    if (el && el !== window) return;
    showFatal('Something went wrong', (e.message || 'An unexpected error occurred') + '. You can keep playing, but reloading is the safe choice.', true);
  }, true);
  window.addEventListener('unhandledrejection', e => {
    const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    showFatal('Something went wrong', msg + '. You can keep playing, but reloading is the safe choice.', true);
  });
})();
