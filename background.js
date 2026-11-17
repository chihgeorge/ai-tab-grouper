import { SYSTEM, buildPrompt, parsePlan } from './grouping.js';
import { PROVIDERS, askAI } from './ai.js';

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const MIN_GAP = 20000; // ms between automatic calls per window, so a self-reloading page cannot run up a bill
const ASK_TTL = 5 * 60000; // ms a "Replace your tab groups?" answer stays valid

const timers = {}; // windowId -> debounce timer
const busy = new Map(); // windowId -> `all` flag of the request in flight
const queued = new Map(); // windowId -> `all` flag of a run requested while busy
const lastRun = {}; // windowId -> time of the last automatic call
const lastSent = {}; // windowId -> the tab list last sent, so an unchanged list is not paid for twice

async function loadConfig() {
  const { provider = 'anthropic', keys = {}, models = {}, baseUrl = '', auto = true, rename = 'ask' } = await chrome.storage.local.get(null);
  return { provider, apiKey: keys[provider] || '', model: models[provider] || PROVIDERS[provider].model, baseUrl, auto, rename };
}

// The notification id carries the group and the new name, because Chrome may have stopped this worker by the time a button is clicked.
function askRename(groupId, oldName, newName) {
  chrome.notifications.create(`rename|${groupId}|${newName}`, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Rename this tab group?',
    message: `A new tab joined "${oldName}". Suggested name: "${newName}".`,
    buttons: [{ title: `Rename to "${newName}"` }, { title: `Keep "${oldName}"` }],
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, button) => {
  const [kind, target, ...name] = id.split('|');
  if (kind !== 'rename' && kind !== 'regroup') return;
  chrome.notifications.clear(id);
  if (kind === 'rename') {
    // The group may have been closed since the question was asked; then there is nothing to rename.
    if (button === 0) await chrome.tabGroups.update(Number(target), { title: name.join('|') }).catch(() => {});
    return;
  }
  const windowId = Number(target);
  const { [id]: parked } = await chrome.storage.session.get(id);
  await chrome.storage.session.remove(id);
  if (button !== 0) return;
  const again = 'so nothing was changed. Click the icon to regroup again.';
  // The yes was given for the window as it was when asked. If tabs or groups changed since, or another run is
  // working on this window, applying the old plan would dissolve groups the question never mentioned.
  if (!parked || Date.now() - parked.at > ASK_TTL) return showError(new Error(`The question expired, ${again}`));
  if (busy.has(windowId)) return showError(new Error(`Another grouping run was busy in this window, ${again}`));
  busy.set(windowId, true); // before the await below, so no other run can start in between
  try {
    if ((await layout(windowId)) !== parked.layout) throw new Error(`Your tabs changed after the question, ${again}`);
    await applyPlan(windowId, true, parked.proposal, 'auto');
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Regroup all tabs from scratch' });
  } catch (e) {
    showError(e);
  } finally {
    busy.delete(windowId);
    if (queued.has(windowId)) {
      const all = queued.get(windowId);
      queued.delete(windowId);
      all ? regroup(windowId, true) : schedule(windowId); // a run asked for meanwhile now sees the new groups
    }
  }
});

// A dismissed or timed-out question leaves nothing parked.
chrome.notifications.onClosed.addListener((id) => {
  if (id.startsWith('regroup|')) chrome.storage.session.remove(id);
});

// Which web tab sits in which group: a fingerprint of what a full regroup would dissolve.
const layout = async (windowId) =>
  JSON.stringify((await ungroupedTabs(windowId, true)).map((t) => [t.id, t.groupId]).sort((a, b) => a[0] - b[0]));

// proposal: [{name, tabIds, rename?}]. all=true dissolves the window's groups first; all=false only places the given tabs.
async function applyPlan(windowId, all, proposal, renameMode) {
  // Time has passed since the tabs were read: they may have closed, moved window, or been grouped by hand.
  const now = await ungroupedTabs(windowId, all);
  const stillHere = new Set(now.map((t) => t.id));
  // Tabs sitting in a group the user has open right now: whatever new group they land in stays open.
  const openGroups = new Set((await chrome.tabGroups.query({ windowId })).filter((g) => !g.collapsed).map((g) => g.id));
  const wasOpen = new Set(now.filter((t) => openGroups.has(t.groupId)).map((t) => t.id));
  if (all && stillHere.size) await chrome.tabs.ungroup([...stillHere]);
  const groups = all ? [] : await chrome.tabGroups.query({ windowId });
  // New groups start collapsed, except ones holding the tab in view (collapsing that would make Chrome jump to another tab) or a tab from a group that was open.
  const [active] = await chrome.tabs.query({ windowId, active: true });
  const keepOpen = (ids) => ids.some((id) => id === active?.id || wasOpen.has(id));
  for (const { name, rename, tabIds: planned } of proposal) {
    const tabIds = planned.filter((id) => stillHere.has(id));
    if (tabIds.length === 0) continue;
    try {
      const existing = groups.find((g) => g.title === name);
      if (existing) {
        await chrome.tabs.group({ groupId: existing.id, tabIds });
        if (rename && renameMode === 'auto') await chrome.tabGroups.update(existing.id, { title: rename });
        if (rename && renameMode === 'ask') askRename(existing.id, name, rename);
      } else {
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { title: name, collapsed: !keepOpen(tabIds) });
      }
    } catch (e) {
      console.warn(`Skipped group "${name}":`, e.message); // e.g. the user is dragging a tab; the other groups still apply
    }
  }
}

// A full regroup replaces and renames the user's groups, so in "ask" mode it waits for a yes.
// The plan is parked in session storage because Chrome may stop this worker before a button is clicked.
async function askRegroup(windowId, proposal) {
  const id = `regroup|${windowId}`;
  await chrome.storage.session.set({ [id]: { proposal, at: Date.now(), layout: await layout(windowId) } });
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Replace your tab groups?',
    message: `New groups: ${proposal.map((g) => g.name).join(', ')}. Your current groups in this window will be dissolved.`,
    buttons: [{ title: 'Regroup' }, { title: 'Keep my groups' }],
  });
}

function showError(e) {
  // The badge is the only error surface: a service worker has no window to alert in.
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setTitle({ title: `AI Tab Grouper: ${e.message}` });
  console.error(e);
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

    const proposal = plan.map(({ name, tabs: idx, rename }) => ({ name, rename, tabIds: idx.map((i) => tabs[i].id) }));
    // Old groups are dissolved only after a usable plan, so a failed call or an empty plan leaves them intact.
    if (all && plan.length === 0) throw new Error('The AI proposed no groups, so nothing was changed.');
    if (all && cfg.rename === 'ask' && (await chrome.tabGroups.query({ windowId })).length) await askRegroup(windowId, proposal);
    else await applyPlan(windowId, all, proposal, cfg.rename);
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Regroup all tabs from scratch' });
  } catch (e) {
    showError(e);
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
