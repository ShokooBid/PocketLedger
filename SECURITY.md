# Security policy

## Supported development version

PocketLedger is pre-release software. Security fixes currently target the latest
code on `main`; no published release or older version has a support commitment.
Use synthetic data while the MVP security controls are being implemented.

## Report a vulnerability privately

Email the maintainer at [shk.bidmeshki@gmail.com](mailto:shk.bidmeshki@gmail.com).
Use a subject such as `PocketLedger security report`.

Do not open a GitHub issue or PR containing exploit details, credentials, real
financial records, or personal information. Even in this private repository,
issues and PRs are visible to repository collaborators. Contact the maintainer
first so disclosure and any sensitive reproduction material can be coordinated.

Include a brief description, affected commit/version, expected and actual
behavior, potential impact, and reproduction steps using synthetic data. Avoid
attaching active tokens or full database exports. If sensitive material is needed,
request a suitable private transfer method first. No response-time guarantee or
bug-bounty program is offered at this stage.

GitHub's private vulnerability reporting and repository advisory features are
documented for public repositories. This policy uses email so reports do not
depend on those features being available or enabled for this private repository.
See [GitHub repository security advisories](https://docs.github.com/en/code-security/concepts/vulnerability-reporting-and-management/repository-security-advisories).

## If you discover an exposed credential

Revoke or rotate the credential at its provider immediately. Treat a committed
credential as compromised even if the repository is private or the commit was
later deleted. Notify the maintainer privately without repeating the secret.
Removing a file in a new commit does not remove it from Git history. Coordinate
history cleanup and any investigation separately; do not rewrite shared history
without agreement.
