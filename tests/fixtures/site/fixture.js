// The fixture uses DOM text sinks only and encodes user-provided filenames in URLs.
const params = new URLSearchParams(location.search);
const color = params.get('color');
if (color && /^[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--bg', `#${color}`);
const queryOutput = document.getElementById('query');
if (queryOutput) queryOutput.textContent = location.search || '(none)';

const fileInput = document.getElementById('file');
const statusOutput = document.getElementById('status');
if (fileInput && statusOutput) {
  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    statusOutput.textContent = `Selected file: ${file ? file.name : 'none'}`;
    if (file) {
      const next = new URL('page2.html', location.href);
      next.searchParams.set('uploaded', file.name);
      next.searchParams.set('size', String(file.size));
      location.assign(next.href);
    }
  });
}
if (params.get('autodownload') === '1') {
  const download = document.getElementById('download');
  if (download) download.click();
}
