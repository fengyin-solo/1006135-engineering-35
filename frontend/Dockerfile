# syntax=docker/dockerfile:1
# 基础镜像钉死：与本地同一大版本且 tag 精确，避免 latest 漂移导致镜像里依赖与本地不一致。
FROM node:20.20.2-alpine3.20 AS build
WORKDIR /srv/web

# 依赖清单：package.json + package-lock.json 一起进镜像，一律 npm ci 按锁清单安装，
# 本地与镜像取的是同一份钉死版本。npm 缓存目录按提交号重建（见 Makefile 的 COMMIT_SHA 传递）。
ARG COMMIT_SHA=local
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# 样例与源码
COPY . .

# Vite 缓存目录按提交号隔离：提交一变，目录即换，不复用旧提交的预打包缓存。
ENV VITE_CACHE_DIR=/srv/web/.cache/vite-${COMMIT_SHA}
RUN --mount=type=cache,target=/srv/web/.cache \
    npm run build

FROM nginx:1.27.5-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
