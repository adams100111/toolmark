# PHP 8.4 CLI for the example's local gates when `php` is not on the host PATH (scripts/php.sh).
# CI uses shivammathur/setup-php on the runner instead.
FROM php:8.4-cli

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsqlite3-dev libonig-dev unzip git \
    && docker-php-ext-install pdo_sqlite mbstring pcntl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
