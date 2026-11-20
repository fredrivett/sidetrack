# Changelog entries

One file per change a Sidetrack user could notice, shown newest first at
`/changelog`. The format, the writing rules and the sign-off step are in
`AGENTS.md` under "Changelog"; `src/lib/changelog.ts` checks each file.

```markdown
---
date: 2026-11-19
type: new         # new | improved | fixed
pr: [303]
post: true        # optional: might be worth a post
for: self-hosters # optional
media: repeat.gif # optional, a file in public/changelog/
---
Repeats can keep to a weekday or to weekends, so Monday's task stays a Monday task even when you tick it off on a Wednesday.
```
