# AI Tab Grouper

A Chrome extension that sorts your open tabs into named tab groups. An AI model of your choice decides which tabs belong together.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. The settings page opens the first time you click the toolbar icon. Choose a provider, paste your API key, save.

## Use

- New tabs are placed into a group a few seconds after they finish loading.
- Click the toolbar icon to regroup every tab in the current window from scratch. Existing groups are dissolved and ignored, including ones you made by hand. Tabs that fit no group end up ungrouped. If the AI proposes no groups at all, nothing is changed.
- The default shortcut for the same action is `Alt+Shift+G`. Chrome leaves it unassigned if another extension already uses it; set or change it at `chrome://extensions/shortcuts`.
- Not yet verified: whether dissolving a group also removes Chrome's saved or synced copy of that tab group. If you rely on saved tab groups, try a full regroup on a throwaway window first.
- Tabs you grouped yourself are left alone in automatic mode. Pinned tabs and pages that are not `http`/`https` (such as `chrome://` pages) are never touched, even by a full regroup, so a group that holds one of those pages keeps it.
- A `!` badge on the icon means the last AI call failed, or that a full regroup got no groups back from the AI. Hover the icon to read why.

## Providers

| Provider | Default model | Key from |
|---|---|---|
| Claude (Anthropic) | `claude-haiku-5-5` | console.anthropic.com |
| OpenAI | `gpt-5-nano` | platform.openai.com |
| Google Gemini | `gemini-2.5-flash-lite` | aistudio.google.com |
| OpenRouter | `google/gemini-2.5-flash-lite` | openrouter.ai |
| Custom | (you choose) | any OpenAI-compatible server |

The model field is editable. Any small, cheap model is enough for this job.

For a local Ollama server, use base URL `http://localhost:11434/v1`, leave the key empty, and start Ollama with `OLLAMA_ORIGINS=chrome-extension://*` so it accepts requests from the extension.

## Privacy

The extension sends tab titles and addresses (query strings removed) from the current window, plus the names of your existing tab groups, to the provider you selected, and nowhere else. It does not run in incognito windows. The API key stays in `chrome.storage.local` on your device and is not synced.

## Develop

```bash
npm test
```

No build step and no dependencies. Design notes: [docs/designs/ai-tab-grouper.md](docs/designs/ai-tab-grouper.md).
