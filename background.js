import { SYSTEM, buildPrompt, parsePlan } from './grouping.js';
import { PROVIDERS, askAI } from './ai.js';

const timers = {}; // windowId -> debounce timer
const busy = new Set(); // windowIds with a request in flight
const lastSent = {}; // windowId -> the tab list last sent, so an unchanged list is not paid for twice

async function loadConfig() {
  const { provider = 'anthropic', keys = {}, models = {}, baseUrl = '', auto = true } = await chrome.storage.local.get(null);
  return { provider, apiKey: keys[provider] || '', model: models[provider] || PROVIDERS[provider].model, baseUrl, auto };
}

// all=true: regroup every tab (toolbar click). all=false: only place ungrouped tabs.
async function regroup(windowId, all) {
  if (busy.has(windowId)) return;
  const cfg = await loadConfig();
  if (!all && !cfg.auto) return;
  if (cfg.provider === 'custom' ? !cfg.baseUrl || !cfg.model : !cfg.apiKey) {
    if (all) chrome.runtime.openOptionsPage();
    return;
  }

  const tabs = (await chrome.tabs.query({ windowId, pinned: false })).filter(
    (t) => /^https?:/.test(t.url) && (all || t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE),
  );
  const groups = await chrome.tabGroups.query({ windowId });
  const names = groups.map((g) => g.title).filter(Boolean);
  if (tabs.length === 0 || (tabs.length === 1 && names.length === 0)) return;

  const prompt = buildPrompt(tabs, names);
  if (!all && lastSent[windowId] === prompt) return;

  busy.add(windowId);
  try {
    const plan = parsePlan(await askAI(cfg, SYSTEM, prompt), tabs.length, names);
    lastSent[windowId] = prompt; // only after success, so a failed call is retried
    for (const { name, tabs: idx } of plan) {
      const tabIds = idx.map((i) => tabs[i].id);
      const existing = groups.find((g) => g.title === name);
      if (existing) {
        await chrome.tabs.group({ groupId: existing.id, tabIds });
      } else {
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { title: name });
      }
    }
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Regroup all tabs in this window' });
  } catch (e) {
    // The badge is the only error surface: a service worker has no window to alert in.
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: `AI Tab Grouper: ${e.message}` });
    console.error(e);
  } finally {
    busy.delete(windowId);
  }
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== 'complete' || tab.pinned || tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;
  // shortcut: an in-memory timer is lost if Chrome stops the worker; 3s is well inside its 30s idle limit. Move to chrome.alarms if the delay grows.
  clearTimeout(timers[tab.windowId]);
  timers[tab.windowId] = setTimeout(() => regroup(tab.windowId, false), 3000);
});

chrome.action.onClicked.addListener((tab) => regroup(tab.windowId, true));
