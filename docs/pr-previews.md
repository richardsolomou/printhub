# Pull request previews

Pull requests from branches in this repository deploy an isolated STL Quest container to Cloudflare. The workflow adds or updates a pull request comment with the preview URL after the container is healthy and seeded. Closing or merging the pull request deletes its Worker and container. A weekly workflow removes orphaned previews whose cleanup run failed.

Preview storage is intentionally disposable. Each deployment starts with a fresh SQLite database and local model store, creates a preview administrator, and uploads representative resin and filament requests. Cloudflare can also replace an idle container host, which resets that data. Never put personal information, private models, or production credentials in a preview.

The seeded account is `preview@stl.quest` with password `preview-preview-preview`. Cloudflare Access must protect preview URLs so these shared credentials are only usable by the team.

## Cloudflare setup

The repository needs these GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: a token that can edit Workers scripts and Containers for that account.
- `CF_ACCESS_CLIENT_ID`: the client ID of an Access service token allowed through the preview policy.
- `CF_ACCESS_CLIENT_SECRET`: the matching Access service-token secret.

The Cloudflare account must have the Workers Paid plan with Containers enabled and a `workers.dev` subdomain. Configure Access for Workers preview URLs with an identity policy for the team and a service-token policy for the GitHub workflow.

Create a protected GitHub environment named `pr-previews`, require approval from a maintainer, and restrict deployment branches to protected branches and selected repository branches. The environment approval keeps unreviewed pull-request code from receiving the Cloudflare and Access credentials.

The workflow names Workers `stlquest-pr-<number>`. Pull requests from forks run normal CI but do not receive previews because GitHub does not expose deployment secrets to forked code.

To redeploy, push another commit or rerun the workflow. To remove a preview manually, run:

```sh
pnpm exec wrangler delete --config wrangler.preview.jsonc --name stlquest-pr-123 --force
```
