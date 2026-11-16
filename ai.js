// The one place that talks to an AI provider. Two wire formats cover everything:
// Anthropic's Messages API, and the OpenAI-style chat completions API that
// OpenAI, Gemini, OpenRouter, Ollama and most others accept.

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-5-5' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-nano' },
  gemini: { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash-lite' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'google/gemini-2.5-flash-lite' },
  custom: { label: 'Custom (OpenAI-compatible, e.g. Ollama)', url: '', model: '' },
};

export function customUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

export async function askAI({ provider, apiKey, model, baseUrl }, system, user) {
  const p = PROVIDERS[provider];
  const url = provider === 'custom' ? customUrl(baseUrl) : p.url;
  const anthropic = provider === 'anthropic';

  const res = await fetch(url, {
    method: 'POST',
    headers: anthropic
      ? {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2026-10-21',
          // Required for calls from a browser context; the key is the user's own.
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : { 'content-type': 'application/json', ...(apiKey && { authorization: `Bearer ${apiKey}` }) },
    body: JSON.stringify(
      anthropic
        ? { model, max_tokens: 8000, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }] }
        : { model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
    ),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${p.label} ${res.status}: ${body?.error?.message || res.statusText}`);

  const text = anthropic
    ? body.content?.filter((b) => b.type === 'text').map((b) => b.text).join('')
    : body.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${p.label} returned no text (${body?.stop_reason || body?.choices?.[0]?.finish_reason || 'empty reply'})`);
  return text;
}
