import { PROVIDERS, customUrl } from './ai.js';

const $ = (id) => document.getElementById(id);
const cfg = { provider: 'anthropic', keys: {}, models: {}, baseUrl: '', auto: true, ...(await chrome.storage.local.get(null)) };

for (const [id, p] of Object.entries(PROVIDERS)) $('provider').add(new Option(p.label, id));

// Each provider keeps its own key and model, so switching back and forth loses nothing.
function show() {
  const id = cfg.provider;
  $('provider').value = id;
  $('apiKey').value = cfg.keys[id] || '';
  $('model').value = cfg.models[id] || PROVIDERS[id].model;
  $('baseUrlRow').hidden = id !== 'custom';
  $('baseUrl').required = id === 'custom';
  $('baseUrl').value = cfg.baseUrl;
  $('auto').checked = cfg.auto;
}
show();

function keep() {
  cfg.keys[cfg.provider] = $('apiKey').value.trim();
  cfg.models[cfg.provider] = $('model').value.trim();
  cfg.baseUrl = $('baseUrl').value.trim();
  cfg.auto = $('auto').checked;
}

$('provider').addEventListener('change', () => {
  keep();
  cfg.provider = $('provider').value;
  show();
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  keep();
  if (cfg.provider === 'custom') {
    // Must be the first await in the click handler, or Chrome refuses to show the permission prompt.
    const granted = await chrome.permissions.request({ origins: [new URL(customUrl(cfg.baseUrl)).origin + '/*'] });
    if (!granted) return ($('status').textContent = 'Not saved: permission to reach that address was declined.');
  }
  await chrome.storage.local.set(cfg);
  $('status').textContent = 'Saved.';
});
