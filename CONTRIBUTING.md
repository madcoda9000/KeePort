# Contributing to KeePort

Thank you for helping! Bug reports, ideas, translations and code are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and suggesting features

- **Security problems:** never in a public issue — follow the [security policy](SECURITY.md).
- **Bugs and ideas:** open an [issue](https://github.com/madcoda9000/KeePort/issues/new/choose) and pick the matching form. Search the existing issues first.
- Never attach real vault files, passwords or personal data. Create a test vault instead.

## Before you write code

For anything bigger than a small fix, please open an issue first and describe what you plan. That avoids work on something that does not fit the project or is already in progress.

## Development setup

You need the **.NET 10 SDK** (pinned in `global.json`) and **Node.js 22**. The commands for the backend, the frontend dev servers, tests and lint are in the section *Development* of the [README](README.md).

Project layout:

| Folder | Content |
|---|---|
| `src/KeePort.Api` | ASP.NET Core backend: REST API, WebDAV, SQLite data layer |
| `web/vault` | React + TypeScript web vault |
| `web/admin` | React + TypeScript admin console |
| `web/shared` | Components, helpers and translations used by both frontends |
| `tests/KeePort.Api.Tests` | xUnit integration tests |

## Rules for changes

**Code**

- TypeScript in strict mode; functional React components.
- Every new method or function — C# and TypeScript, including lambdas — gets a doc comment.
- The frontends use [shadcn/ui](https://ui.shadcn.com/) components only. Build your own component only when shadcn/ui has nothing that fits.
- Keep the security model intact: the server never sees vault contents, master passwords or key files.

**Texts and translations**

- No user-facing text directly in the code. Every text goes into the catalogs (`web/*/src/i18n/*.ts`, `web/shared/i18n/messages/*.ts`) via `defineMessages` and `useT`/`translate`, in **English, German and French**.
- German uses the informal "du"; terms follow `web/shared/i18n/GLOSSARY.md`.
- `node --test web/shared/i18n/*.test.mjs` checks that every language is complete, and `node web/shared/i18n/find-untranslated.mjs` finds texts that were missed.

**Dependencies**

- Please do not add new npm or NuGet packages without discussing them in the issue first. Every dependency of a password manager is a risk that has to be worth it.

**Commits and changelog**

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), for example `fix(webdav): …` or `feat(vault): …`.
- Every change is recorded in [CHANGELOG.md](CHANGELOG.md) in the same commit, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — clean-ups without visible effect too. Add your entry at the top; the maintainer assigns the version number when releasing.

## Before you open a pull request

```bash
dotnet test
node --test web/vault/src/lib/*.test.mjs web/shared/*.test.mjs web/shared/i18n/*.test.mjs
(cd web/vault && npm run lint) && (cd web/admin && npm run lint)
./scripts/build-web.sh
```

Then open the pull request against `main` and fill in the checklist of the template. For visible changes, add screenshots in light and dark mode.

## License

By contributing you agree that your contribution is released under the project's [MIT License](LICENSE).
