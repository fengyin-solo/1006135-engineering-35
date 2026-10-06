.PHONY: install ci frontend build check-seed typecheck test image up down

# 依赖一律照 package-lock.json 这份清单取，本地与镜像同源（镜像里也是 npm ci）。
install:
	cd frontend && npm install

ci:
	cd frontend && npm ci

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

typecheck:
	cd frontend && npm run typecheck

check-seed:
	cd frontend && npm run check:seed

test:
	cd frontend && npm test

# 容器镜像：缓存目录按提交重建，GIT_SHA 不同则依赖缓存作用域不同。
GIT_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo working)

image:
	GIT_SHA=$(GIT_SHA) docker compose build frontend

up:
	GIT_SHA=$(GIT_SHA) docker compose up -d

down:
	docker compose down
