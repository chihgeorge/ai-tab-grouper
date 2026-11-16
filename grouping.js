// Pure prompt/parse logic. No chrome.* here so node can test it.

export const SYSTEM = `You organize browser tabs into groups by topic or task.
Reply with JSON only, in this shape: {"groups":[{"name":"Short name","tabs":[0,3]}]}
Rules:
- "tabs" holds the tab numbers from the list.
- Group names: at most 3 words, in the main language of the tab titles.
- If a tab fits an existing group, use that group's exact name.
- A new group needs at least 2 tabs. Leave out tabs that fit nowhere.`;

// Query strings and fragments are dropped: they can hold tokens and personal data.
export function tabLine(i, tab) {
  let where = tab.url;
  try {
    const u = new URL(tab.url);
    where = u.host + u.pathname;
  } catch {}
  return `${i} | ${(tab.title || '').slice(0, 120)} | ${where.slice(0, 120)}`;
}

export function buildPrompt(tabs, groupNames) {
  return `Existing groups: ${JSON.stringify(groupNames)}\nTabs:\n${tabs.map((t, i) => tabLine(i, t)).join('\n')}`;
}

// Turns the model's reply into [{name, tabs:[index]}], dropping anything invalid.
export function parsePlan(text, tabCount, groupNames = []) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI reply had no JSON');
  const groups = JSON.parse(text.slice(start, end + 1)).groups;
  if (!Array.isArray(groups)) throw new Error('AI reply had no "groups" list');

  const seen = new Set();
  const plan = [];
  for (const g of groups) {
    const name = typeof g?.name === 'string' ? g.name.trim().slice(0, 40) : '';
    if (!name || !Array.isArray(g.tabs)) continue;
    const tabs = [...new Set(g.tabs)].filter((i) => Number.isInteger(i) && i >= 0 && i < tabCount && !seen.has(i));
    if (tabs.length < (groupNames.includes(name) ? 1 : 2)) continue;
    tabs.forEach((i) => seen.add(i));
    plan.push({ name, tabs });
  }
  return plan;
}
