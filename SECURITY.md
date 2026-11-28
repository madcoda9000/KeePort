# Security policy

KeePort stores password vaults, so security reports are taken seriously and handled first.

## Supported versions

KeePort is in beta. Security fixes are made for the **latest release** only; please update before reporting and check whether the problem still exists there. The latest version is listed on the [Releases page](https://github.com/madcoda9000/KeePort/releases).

| Version | Security fixes |
|---|---|
| Latest 0.x release | ✅ |
| Older releases | ❌ — please update |

## Reporting a vulnerability

**Please do not report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub instead:

1. Open [**Report a vulnerability**](https://github.com/madcoda9000/KeePort/security/advisories/new) (the *Security* tab of this repository).
2. Describe the problem, the affected version and how to reproduce it. Logs, requests or a small proof of concept help — but never send real passwords, vault files or other personal data; use test data.

Only the maintainer can see the report. You can expect:

- a first answer within **7 days**,
- an assessment and, for a confirmed problem, a plan for the fix,
- a fixed release, after which the advisory is published. You are credited in the advisory and the changelog unless you prefer not to be.

Please give the fix time to ship before you disclose details elsewhere.

## Scope

In scope is everything in this repository: the server (REST API, WebDAV, admin console), the web vault, the Docker image and the scripts in `scripts/`.

Out of scope:

- Problems that need an attacker who already controls the server, the host or the `/data` volume.
- Setups that ignore the documented requirements, for example the admin console published to the internet (see the [deployment guide](docs/DEPLOYMENT.md#who-can-reach-the-admin-console)).
- Weaknesses in KeePass apps or in the KDBX format itself — please report those to their projects.
- Reports from automated scanners without a description of a real impact.

## How KeePort is built to stay safe

The design — vaults decrypted only in the browser, the server never receiving master passwords, the admin console kept off the internet — is described in the [security model](README.md#-security-model) in the README.
