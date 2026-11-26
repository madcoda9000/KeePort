# syntax=docker/dockerfile:1

FROM node:22-alpine AS web-build
WORKDIR /src

COPY web/vault/package.json web/vault/package-lock.json ./web/vault/
COPY web/admin/package.json web/admin/package-lock.json ./web/admin/
RUN cd web/vault && npm ci && cd ../admin && npm ci

COPY web/vault ./web/vault
COPY web/admin ./web/admin
COPY web/shared ./web/shared
RUN cd web/vault && npm run build && cd ../admin && npm run build
RUN mkdir -p /out/vault /out/admin \
    && cp -r web/vault/dist/. /out/vault/ \
    && cp -r web/admin/dist/. /out/admin/

FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS api-build
WORKDIR /src
COPY KeePort.sln ./
COPY src/KeePort.Api ./src/KeePort.Api
RUN dotnet restore src/KeePort.Api/KeePort.Api.csproj
COPY --from=web-build /out/vault ./src/KeePort.Api/wwwroot
COPY --from=web-build /out/admin ./src/KeePort.Api/wwwroot/admin
RUN dotnet publish src/KeePort.Api/KeePort.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime
WORKDIR /app
COPY --from=api-build /app/publish ./
RUN addgroup -S keeport -g 1000 \
    && adduser -S keeport -u 1000 -G keeport \
    && mkdir -p /data \
    && chown -R keeport:keeport /data /app \
    && printf '#!/bin/sh\n# Emergency commands, e.g. keeport-admin reset-mfa <username>\nexec dotnet /app/KeePort.Api.dll "$@"\n' > /usr/local/bin/keeport-admin \
    && chmod 755 /usr/local/bin/keeport-admin
ENV ASPNETCORE_URLS=http://+:8080 \
    KeePort__DataDir=/data \
    KeePort__CookieSecure=true
USER keeport
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["dotnet", "KeePort.Api.dll"]
