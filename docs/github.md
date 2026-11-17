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
  your lists and the shared lists you've joined. If a ref matches items in
  more than one list, add the list owner's username, such as `[alice/SDT-1]`.
  A ref that matches no item, or several, is skipped.
- **Editing a ref out of the title** unlinks that item, unless an agent linked
  it with `link_item_to_pr`.
- **When the PR merges,** every linked item is completed, however it was
  linked.
- **When the PR closes without merging,** agents working on its items are
  taken off them, unless an item has another open PR. The items stay open.

Every delivery is checked against the webhook's secret, and its changes show
in the audit log as `github`.
