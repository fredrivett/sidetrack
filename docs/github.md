# Complete items when pull requests merge

Connect a GitHub repository, and pull requests update your items on their own:
put an item's ref in a PR title to link it, and it's marked done when the PR
merges.

## Set it up

1. Under **GitHub** in the menu under your avatar, set up a webhook to get a
   payload URL and secret.
2. In the repository on GitHub, go to Settings → Webhooks and add them, with
   content type `application/json`.
3. Choose **Let me select individual events**, tick **Pull requests**, and
   untick **Pushes**.

GitHub must be able to reach your instance, so a self-hosted one needs a public
address (see [HTTPS and a domain](self-hosting.md#https-and-a-domain)). One
webhook works for any number of repositories.

## How it works

- **Name items in the PR title** in square brackets, such as
  `Fix login [SDT-1]` or `[SDT-1, SDT-2]`, to link them. Refs resolve against
  your lists and the shared lists you've joined.
- **Add the owner's username** when more than one of those lists uses the
  same prefix, such as `[alice/SDT-1]`. A bare ref is ambiguous then, even if
  only one of the lists has that number.
- **A ref that matches no item, or several, is skipped.** If it linked an item
  before and is still in the title, that link stays.
- **Editing a ref out of the title** unlinks that item, unless the item was
  linked to the PR some other way first, such as by an agent with
  `link_item_to_pr` or in Sidetrack itself.
- **When the PR merges,** every linked item is completed, however it was
  linked.
- **When the PR closes without merging,** agents working on its items are
  taken off them. An item keeps its agent if it has another linked PR that
  isn't known to be merged or closed. The items stay open.

Every delivery is checked against the webhook's secret. The changes it makes
to items show in the audit log as `github`. Updates to a PR's state, which
show as its badge on the board, aren't logged.
