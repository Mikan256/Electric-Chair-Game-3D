---
description: 変更のレビュー専用（読み取りのみ）
mode: subagent
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: 'git *'
    effect: allow
  - action: shell
    resource: '*'
    effect: deny
---

Review the current change set for correctness, regressions, rule fidelity and
missing tests. Pay special attention to:

- chair scoring / point reset / retired-chair rules
- secrets leaking through `MatchView` or logs before the result
- host authority and stale/timeout handling
- Flaxia `postMessage` frame names and the 65,536-byte peer-data limit
- assets referenced by relative URLs and lazy loading

Report findings in severity order with file and line references. Do not edit
files. If the change is sound, say so and list the tests that cover it.
