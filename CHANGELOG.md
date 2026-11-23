# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Vault webclient: "Add entry" button and create-entry flow for read-write vaults (entries are added to the first KDBX group and saved with the usual ETag precondition).
- KDBX signature validation on vault upload and content writes (admin upload, REST, WebDAV): files without the KDBX magic bytes are rejected with `400 Bad Request`.
- Documentation for the planned browser-extension basis (`KeePort:CorsOrigins` + token approach) in the README.

### Changed

- API endpoints no longer use redundant `async` signatures (CS1998 warnings eliminated); README clone URL updated to the real repository.

### Removed

- Dead `getFile()` client method in the vault webclient (called a non-existent backend endpoint).

## [0.1.0] - 2026-11-23

### Added

- Self-hosted KeePort backend with SQLite metadata and filesystem vault storage.
- Vault webclient with browser-only KDBX unlock/edit/save, dark/light mode, search, and auto-lock on tab hide.
- Admin console for first-run setup, users, vault files, ACLs, restore, and WebDAV credentials.
- KeePass KDBX compatibility through `kdbxweb` and `argon2-browser`, including KDBX 3.1/4 and optional key files.
- Role model with `Admin` and `User`, per-file `read` / `read-write` ACLs enforced across REST, Vault UI, and WebDAV.
- REST API for vault metadata/content sync with ETag preconditions and atomic writes.
- WebDAV endpoint supporting `OPTIONS`, `PROPFIND`, `GET`, `PUT`, `HEAD`, `LOCK`, and `UNLOCK` for existing permitted files.
- First-run one-time setup token, Argon2id password hashing, session cookies, CSRF protection, and auth rate limiting.
- Docker image, `docker-compose.yml`, deployment guide, and integration tests for roles/ACLs, ETag conflicts, and atomic writes.
