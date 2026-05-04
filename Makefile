# Convenience targets for ABG development.
# Run `make help` for a list.

.PHONY: help install gateway extension all clean test lint format dist pages-dmg release verify

PAGES_OUTPUT_DIR ?= site/downloads

help:
	@printf "ABG dev targets:\n\n"
	@printf "  make install      install Node + pnpm via mise, then extension deps\n"
	@printf "  make gateway      build Agent Browser Gateway.app and abg CLI (release)\n"
	@printf "  make extension    build Chrome extension to extension/dist/\n"
	@printf "  make all          gateway + extension\n"
	@printf "  make lint         biome check\n"
	@printf "  make format       biome format --write\n"
	@printf "  make test         run all available tests (swift + extension typecheck)\n"
	@printf "  make verify       lint + typecheck + build (CI-style)\n"
	@printf "  make dist         build macOS arm64 release zip and cask (requires VERSION=x.y.z)\n"
	@printf "  make pages-dmg    build signed/notarized DMG and copy it to site/downloads\n"
	@printf "  make clean        remove .build, extension/dist, Agent Browser Gateway.app\n"
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
	rm -rf .build dist extension/dist extension/node_modules "Agent Browser Gateway.app" Gateway.app

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

dist:
ifndef VERSION
	$(error VERSION is required, e.g. make dist VERSION=0.3.1)
endif
	VERSION="$(VERSION)" SIGN_IDENTITY="$(SIGN_IDENTITY)" NOTARY_PROFILE="$(NOTARY_PROFILE)" GITHUB_REPOSITORY="$(GITHUB_REPOSITORY)" CASK_OUTPUT="$(CASK_OUTPUT)" bash scripts/dist-macos-arm64.sh

pages-dmg: dist
	VERSION="$(VERSION)" SIGN_IDENTITY="$(SIGN_IDENTITY)" NOTARY_PROFILE="$(NOTARY_PROFILE)" PAGES_OUTPUT_DIR="$(PAGES_OUTPUT_DIR)" bash scripts/dist-pages-dmg.sh

release: dist
	@echo "Release artifacts for v$(VERSION) are in dist/"
	@echo "Tag: git tag -s v$(VERSION) -m 'v$(VERSION)' && git push origin v$(VERSION)"
