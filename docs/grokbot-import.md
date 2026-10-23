# Importing Grok Bot agents

A Grok Bot owner can bring an exported bot into Xiryn: the name and persona, durable memories, skills, and routines. Xiryn does not install the bot's marketplace plugins, and it does not turn routines on.

On **Agents**, choose **Import Grok Bot**. Paste either:

- the public `https://` share link, or
- the template JSON

**Preview** shows the host (for a link), the persona, and the counts and names of memories, skills, routines and connectors. **Confirm import** is what writes them. Confirming a link fetches it again, so the copy that is saved is the one on the server at that moment, not a plan the browser assembled.

From a terminal, on the machine where Xiryn's database lives:

```bash
npx tsx scripts/import-grokbot.ts https://example.com/share/your-bot --dry-run
npx tsx scripts/import-grokbot.ts template.json --dry-run
npx tsx scripts/import-grokbot.ts template.json
```

`--dry-run` prints the plan and writes nothing. A path that is not a link is read as a file. `-` reads stdin.

## Exporting from Grok Bot

Ask the bot to create a template or export of itself, or save the template JSON it produces (`CreateBotShareJson`). A `grokbot://app/v1/bot-template?id=…` link cannot be fetched from Xiryn. Paste the public https share link, or paste the JSON.

## What the file looks like

Unknown keys are ignored. A wrapper such as `{"version":1,"template":{…}}`, `{"bot":{…}}`, `{"data":{…}}` or `{"props":{"pageProps":{…}}}` is unwrapped when the object inside has a profile.

```json
{
  "profile": { "name": "Mira Example", "description": "What this agent is for." },
  "memory": [{ "kind": "profile", "createdAt": "2024-04-02", "content": "A durable fact." }],
  "skills": [{ "name": "Sample filing", "description": "When to use it.", "content": "The playbook, as prose." }],
  "routines": [{
    "slug": "weekday-slips",
    "name": "Weekday slips",
    "description": "What the run is for.",
    "content": "The task prompt.",
    "schedule": "15 8 * * 1-5",
    "timezone": "Europe/Lisbon",
    "enabled": true
  }],
  "plugins": [{ "pluginId": "gmail", "name": "Gmail" }],
  "gettingStarted": { "skill": "Sample filing" }
}
```

A sample with obviously fake data is `tests/fixtures/grokbot-agent.json`.

| Field | Becomes |
| --- | --- |
| `profile.name` | A new agent. A name that is already taken is saved as "Name (2)". |
| `profile.description` | The agent's standing orders, shown in full in the preview. |
| `memory` `kind: "profile"` | A note on that agent. `createdAt` (`YYYY-MM-DD`) is kept when it is a real date. |
| `memory` `kind: "log"` | The same, tagged as imported history. |
| `skills` | Skills in the shared library (`data/skills/<slug>/SKILL.md`). An existing slug is not overwritten; the new one is `slug-2`. |
| `routines` | Routines on the new agent. See below. |
| `plugins` | A checklist. Nothing is installed. Gmail, Google Calendar, Firecrawl and Telegram are named where Xiryn already has that connector. |
| `gettingStarted.skill` | Saved as a normal skill and named in the result. It is not run. |

Limits: 2 MB, 200 memories, 64 skills, 100 routines, 40 plugins. Strings that do not fit a Xiryn field are shortened and listed in the warnings, or skipped when they are far past the limit. Keys named `__proto__`, `constructor` or `prototype` reject the file.

## Share links

Xiryn fetches the link itself. The request is HTTPS, has no cookies and no Authorization header, and does not follow more than 3 redirects. Each hop is resolved and refused when any address is loopback, private, link-local (including `169.254.169.254`) or an IPv6 equivalent. The response must be JSON, HTML or text, at most 2 MB, within 10 seconds. A username or password in the URL is refused.

`XIRYN_GROKBOT_IMPORT_HOSTS` (Settings → Connectors, or the environment) lists the only hostnames a link may use. Empty, the default, allows any public https host. A listed host does not include its subdomains. The preview always shows the host so you can confirm it.

The page extractor is a heuristic. It has not been checked against a live Grok Bot share page, because that page's HTML is not part of this repository. It tries, in order:

1. JSON, including wrappers (`template`, `bot`, `data`, `props.pageProps`).
2. HTML: `<script type="application/json">`, `__NEXT_DATA__`, `self.__next_f.push` flight payloads, JSON-LD, and a JSON object in the page that has `profile` plus memories, skills, routines, plugins or `gettingStarted`.
3. The same URL again with `Accept: application/json`.
4. The same path with `.json` added.
5. `<link rel="alternate" type="application/json">` when that target passes the same checks.

If none of those contain a template, paste the JSON. That path does not depend on the share page.

## Safety

Imported text is data from outside this computer.

- Routines are created **turned off**, even when the file says `enabled: true`. A routine runs only after you turn it on. Read the task first.
- Xiryn's scheduler is this computer's local time: every day, weekdays, one weekday, every N hours, or once. A 5-field cron that matches one of those is stored that way. `CRON_TZ=Europe/Lisbon`, a separate `timezone`, `@daily`, `@hourly`, `@weekly` and `@every 2h` are converted when they fit, and the timezone is **not** applied — the preview says so. Anything else (`@monthly`, a day-of-month, several weekdays, a sub-hour `@every`) is saved **with no schedule** and left off. Edit it and set a time before you can turn it on.
- Memories are wrapped as untrusted data when they are placed in the agent's prompt, so a note cannot close that fence or be treated as a new system instruction. History notes are labelled imported history.
- Skills are prompt text, not programs. When an agent reads an imported skill, the body is wrapped the same way. Open it on the Skills page and save it if you want the agent to treat the playbook as yours; saving drops the import marker.
- The persona becomes standing orders, the same kind of text as an agent you write yourself. It is shown in the preview before confirm. Import does not execute it.
- Plugins are never installed and no connector token is taken from the file.
- Importing the same file again does not update the first agent and does not overwrite a skill. You get another agent, and skills whose names are taken are saved beside the originals.

Nothing in the import is sent to a model provider. The only network request is the share link you pasted, and only to the host you confirmed.
