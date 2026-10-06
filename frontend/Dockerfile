# syntax=docker/dockerfile:1.6
# 镜像依赖与本地取同一份清单：package-lock.json 钉死全部版本，一律 npm ci，
# 不再出现本地/容器解析出不同小版本、构建过了起来缺原生包（rollup 平台包）的情况。
ARG NODE_IMAGE=node:20.20.2-alpine3.21

FROM ${NODE_IMAGE} AS build
WORKDIR /srv/web

# 缓存目录按提交重建：GIT_SHA 由 compose/CI 传入，每个提交一个独立 npm 缓存作用域，
# 不会拿旧提交的依赖缓存污染新提交；同一提交内仍可复用，加速流水线。
ARG GIT_SHA=working
ENV NPM_CONFIG_CACHE=/npm-cache/${GIT_SHA}

# 先拷依赖清单做一层缓存：清单不变就复用，清单一变整层重建。
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=npm-${GIT_SHA},target=/npm-cache/${GIT_SHA} \
    npm ci --no-audit --no-fund

# 再拷源码构建。build 内含 check:seed：越限样例/两处条数不同源直接让镜像构建失败。
COPY . .
RUN --mount=type=cache,id=npm-${GIT_SHA},target=/npm-cache/${GIT_SHA} \
    npm run build

# 运行期只放静态制品 + 固定版本的轻量服务器，不再用 dev server 顶着（dev 依赖差异是
# “构建时过、起来空白”的主要来源）。
FROM nginx:1.27.5-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
