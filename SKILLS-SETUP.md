# Project-local review skills

Installed as pinned source bundles, with no global installation, active hooks, application dependencies, or root CI workflows added.

| Skill | Source revision | Destination |
| --- | --- | --- |
| Impeccable | `pbakaus/impeccable@0d6b47ea19b63afe15e3f93a44d5d9fbbc6fd275` | `.agents/skills/impeccable/` |
| Anti-AI-Slop | `ch040602/anti-ai-slop@171db9c7daa0e4507cd22f5ad4e8771343f79e72` | `.agents/skills/anti-ai-slop/` |

Impeccable was copied from the upstream `.agents/skills/impeccable` directory. Anti-AI-Slop's repository root is its skill bundle, so its supporting documentation, validators, examples, nested skills, and workflow templates remain vendored inside that directory. They have not been applied to RentifyPro. No nested Git repository was created.

## Local configuration

`AGENTS.md` restricts these skills to explicit, manual use and preserves `Rules.md`. `PRODUCT.md` and `DESIGN.md` record the existing project from source inspection. No application design changes were made.

Local changes relative to the pinned upstream bundles:

- Impeccable's `agents/openai.yaml`: disable implicit invocation and set a review-only default prompt.
- Anti-AI-Slop's `agents/openai.yaml`: add manual invocation policy and review-only default prompt.
- Both bundled Anti-AI-Slop nested skills receive `agents/openai.yaml` with implicit invocation disabled, so they cannot silently introduce the broader guardrail workflow if discovered.
- Anti-AI-Slop's `manifest.txt`: register the three local policy files for its bundle self-check.

Do not run Impeccable's launcher in this configuration; it can download its engine into the user profile. Reviews read local Markdown references and project context directly. Engine-dependent checks are not available unless a later request explicitly changes this setup. There is no `.codex/hooks.json` or live-mode configuration at the project root.

`skill-installation.json` contains the exact installed file inventory and SHA-256 hashes, source revisions, and the additional setup-document paths. Use it when reviewing or updating these bundles. Updates must preserve the local manual-use configuration and must not run upstream installers or apply guardrail packs implicitly.

## Future prompts

Use from this repository in Codex on the next turn. If the skill picker has not refreshed, start a new session in this project. You can also explicitly ask Codex to read the corresponding local `SKILL.md`.

```text
$impeccable critique frontend/src/admin/pages/DashboardView.jsx.
Review only. Follow AGENTS.md, PRODUCT.md, DESIGN.md, and Rules.md.
Preserve the existing identity and report findings without changing files.
```

```text
$anti-ai-slop Review the copy and layout in
frontend/src/admin/pages/DocumentsView.jsx for generic wording or unnecessary
decoration. Give evidence and specific suggestions; do not edit files.
```

```text
Use $impeccable and $anti-ai-slop to review the Customers page.
Combine overlapping findings, preserve RentifyPro's existing design,
and make no changes. Clearly identify checks that require a live browser.
```

For future implementation, explicitly name the target and approved change, for example: "Apply only finding 2 to the Documents page. Follow Rules.md and preserve all other behavior." A review alone never authorizes automatic fixes.
