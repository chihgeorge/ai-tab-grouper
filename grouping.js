// Pure prompt/parse logic. No chrome.* here so node can test it.

export const SYSTEM = `You organize browser tabs into groups by topic or task.
Reply with one JSON object and nothing else, no text before or after it, in this shape: {"groups":[{"name":"Short name","tabs":[0,3]}]}
Rules:
- "tabs" holds the tab numbers from the list.
- Group names: at most 3 words, in the main language of the tab titles.
- If a tab fits an existing group, use that group's exact name.
- If a tab does not fit an existing group's name but is the same kind of thing as that group (for example another framework next to a group named after one framework), still put it in that group under its exact current name, and add "rename":"Wider name" to that group so the name covers both. Leave "rename" out when the current name already fits.
- A new group needs at least 2 tabs. Leave out tabs that are unrelated to every group.`;

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

// Turns the model's reply into [{name, tabs:[index], rename?}], dropping anything invalid.
export function parsePlan(text, tabCount, groupNames = []) {
  // Models sometimes add a sentence after the JSON, and that sentence can hold braces of its own.
  // So take the shortest text from the first "{" that parses as JSON, not everything up to the last "}".
  const start = text.indexOf('{');
  let parsed;
  for (let end = text.indexOf('}', start); start >= 0 && end >= 0 && !parsed; end = text.indexOf('}', end + 1)) {
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  if (!parsed) throw new Error('AI reply had no JSON');
  const groups = parsed.groups;
  if (!Array.isArray(groups)) throw new Error('AI reply had no "groups" list');

  const seen = new Set();
  const plan = [];
  const cleanName = (g) => (typeof g?.name === 'string' ? g.name.trim().slice(0, 40) : '');
  const taken = new Set([...groupNames, ...groups.map(cleanName)]); // names a rename must not collide with
  for (const g of groups) {
    const name = cleanName(g);
    if (!name || !Array.isArray(g.tabs)) continue;
    const tabs = [...new Set(g.tabs)].filter((i) => Number.isInteger(i) && i >= 0 && i < tabCount && !seen.has(i));
    if (tabs.length < (groupNames.includes(name) ? 1 : 2)) continue;
    tabs.forEach((i) => seen.add(i));
    // A rename is only a proposal for an existing group, and never to a name another group has or is getting.
    const rename = groupNames.includes(name) && typeof g.rename === 'string' ? g.rename.trim().slice(0, 40) : '';
    const keep = rename && !taken.has(rename);
    if (keep) taken.add(rename);
    plan.push({ name, tabs, ...(keep && { rename }) });
  }
  return plan;
}
