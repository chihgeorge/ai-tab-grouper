# Changelog

All notable changes to AI Tab Grouper. The version here is the `version` field of `manifest.json`, which is also the version Chrome shows.

## [0.2.0] - 2026-11-16

### Added
- **Regroup every tab from scratch.** Clicking the toolbar icon, or pressing `Alt+Shift+G`, ignores your current groups and asks the AI for a fresh set. If the AI proposes no groups, nothing changes.
- **You decide before your groups are replaced.** When the window already has groups, a notification lists the new names and waits for you to press Regroup. If your tabs change first, or you answer after 5 minutes, nothing changes.
- **Wider group names, with your OK.** When a new tab joins a group whose name no longer fits it, the AI can suggest a wider name, and a notification asks whether to use it.
- A setting to ask first, rename and regroup without asking, or never rename a group.

### Changed
- New groups start collapsed. A group stays open if it holds the tab you are looking at or tabs from a group you had open.
- The extension has its own icon.

### Fixed
- An AI reply with extra text after the JSON no longer fails.

## [0.1.0] - 2026-11-16

### Added
- Tabs are sorted into named tab groups by an AI model a few seconds after they load.
- A click on the toolbar icon regroups every tab in the window.
- Choice of AI provider with your own API key: Claude, OpenAI, Google Gemini, OpenRouter, or any OpenAI-compatible server.
