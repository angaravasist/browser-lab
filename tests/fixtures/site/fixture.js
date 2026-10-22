// Kept external so the page works under BrowserLab's Content-Security-Policy.
const params = new URLSearchParams(location.search);
const color = params.get('color');
if (color && /^[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--bg', `#${color}`);
const $ = (id) => document.getElementById(id);
if ($('query')) $('query').textContent = location.search || '(none)';
if ($('file')) {
  // Choosing a file navigates, so the selection is observable from outside the browser (current URL).
  $('file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    $('status').textContent = `Selected file: ${f ? f.name : 'none'}`;
    if (f) location.href = `page2.html?uploaded=${encodeURIComponent(f.name)}&size=${f.size}`;
  });
}
if (params.get('autodownload') === '1' && $('download')) $('download').click();
