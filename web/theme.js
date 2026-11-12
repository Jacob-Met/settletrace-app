// Light and dark mode. Each stylesheet tagged data-theme-sheet="light|dark" is the alternate colour sheet for
// the page; it is enabled only in that mode. The choice follows the system setting until the user picks one.
(() => {
  const KEY = 'theme';
  const sheets = () => [...document.querySelectorAll('link[data-theme-sheet],style[data-theme-sheet]')];
  const alt = () => sheets()[0]?.dataset.themeSheet || 'dark';
  const base = () => (alt() === 'dark' ? 'light' : 'dark');
  const system = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const current = () => { try { return localStorage.getItem(KEY) || system(); } catch { return system(); } };
  const apply = mode => {
    for (const link of sheets()) link.disabled = link.dataset.themeSheet !== mode;
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    const b = document.getElementById('theme-toggle');
    if (b) { b.setAttribute('aria-pressed', String(mode === 'dark')); b.title = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'; b.textContent = mode === 'dark' ? '☀' : '☾'; }
  };
  apply(current());
  // Stylesheets a page adds later get the same alternate sheet beside them.
  new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.tagName !== 'LINK' || n.rel !== 'stylesheet' || n.dataset.themeSheet || !/\.css(\?|$)/.test(n.getAttribute('href') || '') || /\.(light|dark)\.css/.test(n.getAttribute('href'))) continue;
      const twin = document.createElement('link'); twin.rel = 'stylesheet'; twin.dataset.themeSheet = alt();
      twin.href = n.getAttribute('href').replace(/\.css(\?|$)/, '.' + alt() + '.css$1'); twin.disabled = current() !== alt(); n.after(twin);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('button');
    b.id = 'theme-toggle'; b.type = 'button'; b.setAttribute('aria-label', 'Toggle dark mode');
    b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483000;width:36px;height:36px;min-height:0;padding:0;border-radius:50%;border:1px solid rgba(128,128,128,.45);background:rgba(128,128,128,.14);color:inherit;font:16px/1 system-ui;cursor:pointer;backdrop-filter:blur(6px);box-shadow:none';
    b.addEventListener('click', () => { const next = current() === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(KEY, next); } catch {} apply(next); });
    document.body.appendChild(b); apply(current());
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(current()));
})();
