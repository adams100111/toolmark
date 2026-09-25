# Toolmark example: Inertia + Laravel 13

A Laravel 13 + Inertia 3 (React) app that exercises Toolmark end to end: a protocol-v1 bridge over
Reverb private channels, the [Laravel reference](../../docs/guides/laravel-reference.md) classes in
`app/Toolmark/` (kept byte-for-byte in sync with the guide), server-declared props tools, a
react-hook-form page, a wizard, an Inertia `<Form>` page and guided tours. Private; not published.

## Run it

PHP and Composer run through `scripts/php.sh`: host `php` when it is on `PATH`, otherwise the
`toolmark-php:8.4` Docker image built from `docker/Dockerfile` on first use.

```sh
pnpm -r --filter "./packages/*" build        # from the repository root
cd examples/inertia-laravel
scripts/php.sh composer install --no-interaction
scripts/php.sh composer run toolmark:setup    # .env, key, fresh SQLite database + seed
scripts/php.sh php artisan test
pnpm exec playwright install chromium
pnpm build
pnpm exec playwright test                     # starts artisan serve (8010) and Reverb (8081)
```

Sign in locally at `http://127.0.0.1:8010/testing/login/alice@example.test` (or `bob@…`).
Ports: app `8010`, Reverb `8081`. Run `toolmark:setup` only while the servers are stopped
(`migrate:fresh` truncates the SQLite file).

## What is where

- `app/Toolmark/*.php` — the Laravel reference (bridge, POST endpoint, `page_call`/`page_describe`,
  `confirmed` handler, props builder). `app/Agent/ScriptedAgentRunner.php` stands in for an LLM.
- `routes/channels.php` — `toolmark.{userId}.{conversationId}` authorizes only the owner.
- `routes/web.php` — pages, `POST /toolmark/bridge/{conversation}`, `POST /tour/plan`, and the
  `local`/`testing`-only helpers (`/testing/login/{email}`, `/testing/agent/script`,
  `/testing/agent/turns/{conversation}`).
- `resources/js/` — `toolmark.ts` (page wiring), pages, tours (`?tour=authored`, `?tour=planned`).
- `tests/Feature/` — PHPUnit: spec §12.2 MUSTs, the `confirmed` follow-up, testing routes, props
  builder authorization. `e2e/` — Playwright (Chromium).
