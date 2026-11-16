import test from 'node:test';
import assert from 'node:assert/strict';
import { askAI, customUrl } from '../ai.js';

function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status < 400, status, statusText: 'x', json: async () => body };
  };
  return calls;
}

test('anthropic: sends the key header and joins text blocks, skipping thinking blocks', async () => {
  const calls = stubFetch(200, { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"groups":[]}' }] });
  const text = await askAI({ provider: 'anthropic', apiKey: 'k', model: 'm' }, 'sys', 'usr');
  assert.equal(text, '{"groups":[]}');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].headers['x-api-key'], 'k');
  assert.equal(calls[0].body.system, 'sys');
});

test('openai-style: sends a bearer token and reads choices[0]', async () => {
  const calls = stubFetch(200, { choices: [{ message: { content: 'hi' } }] });
  assert.equal(await askAI({ provider: 'gemini', apiKey: 'k', model: 'm' }, 'sys', 'usr'), 'hi');
  assert.equal(calls[0].headers.authorization, 'Bearer k');
  assert.equal(calls[0].body.messages[0].role, 'system');
});

test('custom: builds the URL from the base and sends no auth header without a key', async () => {
  const calls = stubFetch(200, { choices: [{ message: { content: 'hi' } }] });
  await askAI({ provider: 'custom', apiKey: '', model: 'm', baseUrl: 'http://localhost:11434/v1/' }, 's', 'u');
  assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal('authorization' in calls[0].headers, false);
  assert.equal(customUrl('http://x/v1'), 'http://x/v1/chat/completions');
});

test('errors carry the provider message; an empty reply is an error too', async () => {
  stubFetch(401, { error: { message: 'bad key' } });
  await assert.rejects(askAI({ provider: 'openai', apiKey: 'k', model: 'm' }, 's', 'u'), /OpenAI 401: bad key/);
  stubFetch(200, { content: [], stop_reason: 'refusal' });
  await assert.rejects(askAI({ provider: 'anthropic', apiKey: 'k', model: 'm' }, 's', 'u'), /no text \(refusal\)/);
});
