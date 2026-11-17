## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- QA/testing site behavior → invoke /qa
- Code review/diff check → invoke /review
- Ship/deploy/PR → invoke /ship

Do not suggest or auto-invoke other gstack skills: they run when the user types them, or when a running skill hands off to them (`gstack-config set proactive all` routes every skill).

## Testing

Run `npm test` (Node built-in test runner, files in `test/`). No dependencies to install.

## Prompt eval

The system prompt in `grouping.js` is checked against a real model by `eval/run.js` (6 fixed cases, 3 runs each; bars are in the file header). It costs a few small API calls, so it is run by hand with the owner's key, never in `npm test`:

- `EVAL_API_KEY=<key> npm run eval` (optional `EVAL_PROVIDER`, `EVAL_MODEL`, `EVAL_BASE_URL`, `EVAL_RUNS`)
- `npm run eval -- --dry` checks the script itself with canned replies and calls nothing.

Run it whenever `SYSTEM` or `buildPrompt` in `grouping.js` changes. Never print, log or commit the key.

## Versioning

- The version lives in one place: the `version` field of `manifest.json`. `.gstack/version-path` points gstack at it, so `/ship` reads and bumps that field. Never edit it by hand.
- Three numbers, `major.minor.patch`:
  - patch: bug fixes and small changes with no new feature.
  - minor: a new feature or setting a user can see. `/ship` asks before a minor bump.
  - major: a change that breaks existing settings or needs the user to do something after updating. `/ship` asks.
- `/ship` writes the `CHANGELOG.md` entry for each new version. Entries say what a user can now do, in plain words.
