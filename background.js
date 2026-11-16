import { SYSTEM, buildPrompt, parsePlan } from './grouping.js';
import { PROVIDERS, askAI } from './ai.js';

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const MIN_GAP = 20000; // ms between automatic calls per window, so a self-reloading page cannot run up a bill

const timers = {}; // windowId -> debounce timer
const busy = new Map(); // windowId -> `all` flag of the request in flight
const queued = new Map(); // windowId -> `all` flag of a run requested while busy
const lastRun = {}; // windowId -> time of the last automatic call
const lastSent = {}; // windowId -> the tab list last sent, so an unchanged list is not paid for twice

async function loadConfig() {
  const { provider = 'anthropic', keys = {}, models = {}, baseUrl = '', auto = true } = await chrome.storage.local.get(null);
  return { provider, apiKey: keys[provider] || '', model: models[provider] || PROVIDERS[provider].model, baseUrl, auto };
}

const ungroupedTabs = async (windowId, all) =>
  (await chrome.tabs.query({ windowId, pinned: false })).filter((t) => /^https?:/.test(t.url) && (all || t.groupId === NONE));

// all=true: dissolve every group and regroup from scratch (toolbar click or shortcut). all=false: only place ungrouped tabs.
async function regroup(windowId, all) {
  if (busy.has(windowId)) {
    if (all && busy.get(windowId)) return; // a full regroup is already running: a second one would pay and dissolve twice
    queued.set(windowId, all || queued.get(windowId) || false);
    return;
  }
  busy.set(windowId, all); // before the first await, so two clicks in a row cannot both get past the check above
  try {
    const cfg = await loadConfig();
    if (!all && !cfg.auto) return;
    if (cfg.provider === 'custom' ? !cfg.baseUrl || !cfg.model : !cfg.apiKey) {
      if (all) chrome.runtime.openOptionsPage();
      return;
    }

    const tabs = await ungroupedTabs(windowId, all);
    // A full regroup starts from scratch: the AI is not told about the current groups.
    const names = all ? [] : (await chrome.tabGroups.query({ windowId })).map((g) => g.title).filter(Boolean);
    if (tabs.length === 0 || (tabs.length === 1 && names.length === 0)) return;

    const prompt = buildPrompt(tabs, names);
    if (!all && lastSent[windowId] === prompt) return;

    if (!all) lastRun[windowId] = Date.now();
    const plan = parsePlan(await askAI(cfg, SYSTEM, prompt), tabs.length, names);
    lastSent[windowId] = prompt; // only after a good reply, so a failed call is retried

    // The reply took seconds: tabs may have closed, moved window, or been grouped by hand since.
    const stillHere = new Set((await ungroupedTabs(windowId, all)).map((t) => t.id));
    // Old groups are dissolved only now, after a usable plan, so a failed call or an empty plan leaves them intact.
    if (all && plan.length === 0) throw new Error('The AI proposed no groups, so nothing was changed.');
    if (all && stillHere.size) await chrome.tabs.ungroup([...stillHere]);
    const groups = all ? [] : await chrome.tabGroups.query({ windowId });
    for (const { name, tabs: idx } of plan) {
      const tabIds = idx.map((i) => tabs[i].id).filter((id) => stillHere.has(id));
      if (tabIds.length === 0) continue;
      try {
        const existing = groups.find((g) => g.title === name);
        if (existing) {
          await chrome.tabs.group({ groupId: existing.id, tabIds });
        } else {
          const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
          await chrome.tabGroups.update(groupId, { title: name });
        }
      } catch (e) {
        console.warn(`Skipped group "${name}":`, e.message); // e.g. the user is dragging a tab; the other groups still apply
      }
    }
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Regroup all tabs from scratch' });
  } catch (e) {
    // The badge is the only error surface: a service worker has no window to alert in.
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: `AI Tab Grouper: ${e.message}` });
    console.error(e);
  } finally {
    busy.delete(windowId);
    if (queued.has(windowId)) {
      const again = queued.get(windowId);
      queued.delete(windowId);
      again ? regroup(windowId, true) : schedule(windowId);
    }
  }
}

function schedule(windowId) {
  // shortcut: an in-memory timer is lost if Chrome stops the worker; the longest wait (20s) is inside its 30s idle limit. Move to chrome.alarms if it grows.
  clearTimeout(timers[windowId]);
  const wait = Math.max(3000, (lastRun[windowId] || 0) + MIN_GAP - Date.now());
  timers[windowId] = setTimeout(() => regroup(windowId, false), wait);
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && !tab.pinned && tab.groupId === NONE) schedule(tab.windowId);
});

chrome.action.onClicked.addListener((tab) => regroup(tab.windowId, true));
