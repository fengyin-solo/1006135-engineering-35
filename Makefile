# 工程入口：依赖、样例、构建、镜像都从这份 Makefile 走。
# 提交号作为缓存命名空间：切了提交，npm/vite 缓存目录随之重建，不复用旧提交产物。
COMMIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo local)
NPM_CACHE   := $(CURDIR)/.cache/npm-$(COMMIT_SHA)
VITE_CACHE  := $(CURDIR)/.cache/vite-$(COMMIT_SHA)
export VITE_CACHE_DIR := $(VITE_CACHE)

.PHONY: install prepare reset frontend build image up clean

install:
	cd frontend && npm ci --cache $(NPM_CACHE)

# 准备入口：把样例灌进发布制品（幂等、可断点续跑），重复执行不会翻倍。
prepare:
	cd frontend && npm run prepare:samples

# 恢复入口：与 prepare 读同一套样例，清掉进度后回到初始样例状态。
reset:
	cd frontend && npm run reset:samples

frontend:
	cd frontend && npm run dev

build: prepare
	cd frontend && npm run build

image:
	docker compose build --build-arg COMMIT_SHA=$(COMMIT_SHA)

up:
	COMMIT_SHA=$(COMMIT_SHA) docker compose up --build

clean:
	rm -rf .cache frontend/dist frontend/.data frontend/public/data
