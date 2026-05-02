# Convenience targets for ABG development.
# Run `make help` for a list.

.PHONY: help install gateway extension all clean test lint format release verify

help:
	@printf "ABG dev targets:\n\n"
	@printf "  make install      install Node + pnpm via mise, then extension deps\n"
	@printf "  make gateway      build Gateway.app and abg CLI (release)\n"
	@printf "  make extension    build Chrome extension to extension/dist/\n"
	@printf "  make all          gateway + extension\n"
	@printf "  make lint         biome check\n"
	@printf "  make format       biome format --write\n"
	@printf "  make test         run all available tests (swift + extension typecheck)\n"
	@printf "  make verify       lint + typecheck + build (CI-style)\n"
	@printf "  make clean        remove .build, extension/dist, Gateway.app\n"
	@printf "  make release      tagged release build (requires VERSION=x.y.z)\n"

install:
	mise trust
	mise install
	cd extension && pnpm install

gateway:
	./build-app.sh
	@printf "\nlink CLI to PATH:\n  ln -sf $$(pwd)/.build/release/abg /usr/local/bin/abg\n"

extension:
	cd extension && pnpm run build

all: gateway extension

clean:
	rm -rf .build extension/dist extension/node_modules Gateway.app

lint:
	cd extension && pnpm run lint

format:
	cd extension && pnpm run format

test:
	swift test
	cd extension && pnpm run typecheck

verify:
	cd extension && pnpm run typecheck && pnpm run lint
	swift test
	swift build -c release
	cd extension && pnpm run build

release:
ifndef VERSION
	$(error VERSION is required, e.g. make release VERSION=0.1.2)
endif
	@echo "Building release v$(VERSION)..."
	./build-app.sh
	cd extension && pnpm run build
	@echo "Tag: git tag -s v$(VERSION) -m 'v$(VERSION)' && git push origin v$(VERSION)"
