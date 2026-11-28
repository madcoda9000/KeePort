## What and why

<!-- What does this change, and which issue does it address? For example: Fixes #123 -->

## How it was tested

<!-- Tests you added or ran, and what you checked by hand. -->

## Checklist

- [ ] An entry in `CHANGELOG.md` is part of this pull request
- [ ] `dotnet test`, the Node tests and `npm run lint` in both frontends pass
- [ ] New methods and functions have doc comments
- [ ] New texts are in the catalogs in English, German and French (`node --test web/shared/i18n/*.test.mjs`)
- [ ] Only shadcn/ui components are used in the frontends
- [ ] No new npm or NuGet packages, or they were agreed on in the issue
- [ ] Screenshots in light and dark mode are attached for visible changes
- [ ] No real passwords, vault files or personal data in code, tests or screenshots
