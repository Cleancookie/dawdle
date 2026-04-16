FROM php:8.4-cli

# System packages — dev tools intentionally included (vim, jq, htop, etc.)
RUN apt-get update && apt-get install -y \
        curl git vim nano unzip zip wget less htop jq procps \
        libzip-dev libpng-dev libxml2-dev libonig-dev \
    && rm -rf /var/lib/apt/lists/*

# PHP extensions — only those not already compiled into php:8.4-cli
# (tokenizer, ctype, fileinfo, dom, xml, mbstring, pdo are already built-in)
RUN docker-php-ext-install \
        pdo_mysql \
        bcmath pcntl \
        zip \
    && pecl install redis \
    && docker-php-ext-enable redis

# Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

COPY docker/app/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
