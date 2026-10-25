## Branch
<!-- source → target, e.g. feat/my-feature → main -->
`<branch>` → `main`

## Overview
**TL;DR:** <!-- one sentence -->

| | Before | After |
|---|---|---|
| <!-- aspect --> | <!-- before --> | <!-- after --> |

## Motivation
<!-- 2-3 sentences max: why this change exists, what problem it solves -->

## Changes
<!-- bullet list of what changed, grouped by area if needed -->
-

## API contracts
<!-- List any added, changed or removed endpoints, tool signatures, DB columns, env vars, or config keys.
     Write "None" if nothing changed. -->

| Type | Name | Change |
|---|---|---|
| <!-- endpoint / tool / column / env --> | <!-- name --> | <!-- added / changed / removed --> |

## Risk
**Level:** <!-- LOW / MEDIUM / HIGH -->

<!-- One sentence justifying the risk level. -->

| Area | Risk | Mitigation |
|---|---|---|
| <!-- e.g. DB migration --> | <!-- what could go wrong --> | <!-- how it is mitigated --> |

## Checklist
- [ ] `npm run check` passes (typecheck, lint, format)
- [ ] `npm run build` passes
- [ ] Migration added if `db/schema.ts` changed
- [ ] API contracts section filled (or marked None)
- [ ] Risk level set to LOW / MEDIUM / HIGH with justification
- [ ] No secrets, telemetry or new hosted services introduced
