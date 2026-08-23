# Convenience targets for ABG development.
# Run `make help` for a list.

.PHONY: help install gateway gateway-dev extension all clean test lint format dist release-dmg reproducible-build appstore-pkg docker-repro pages-dmg windows-dist pages-windows release verify

help:
	@printf "ABG dev targets:\n\n"
	@printf "  make install      install Node + pnpm via mise, then extension deps\n"
	@printf "  make gateway      build Agent Browser Gateway.app and abg CLI (release)\n"
	@printf "  make gateway-dev  build Agent Browser Gateway Dev.app and dev CLI (debug, port 8766)\n"
	@printf "  make extension    build Chrome extension to extension/dist/\n"
	@printf "  make all          gateway + extension\n"
	@printf "  make lint         biome check\n"
	@printf "  make format       biome format --write\n"
	@printf "  make test         run all available tests (swift + extension typecheck)\n"
	@printf "  make verify       lint + typecheck + build (CI-style)\n"
	@printf "  make dist         build macOS arm64 release zip and cask (requires VERSION=x.y.z)\n"
	@printf "  make release-dmg  build signed/notarized DMG for GitHub Release upload\n"
	@printf "  make reproducible-build build unsigned pinned artifacts, SBOM, and checksums\n"
	@printf "  make appstore-pkg build sandboxed Mac App Store package candidate (requires VERSION=x.y.z)\n"
	@printf "  make docker-repro build reproducible Linux abg CLI artifacts through Docker\n"
	@printf "  make windows-dist build Windows x64 zip (run from Windows with dotnet)\n"
	@printf "  make clean        remove .build, extension/dist, Agent Browser Gateway.app\n"
	@printf "  make release      tagged release build (requires VERSION=x.y.z)\n"

install:
	mise trust
	mise install
	cd extension && pnpm install

gateway:
	./build-app.sh
	@printf "\nlink CLI to PATH:\n  ln -sf $$(pwd)/.build/release/abg /usr/local/bin/abg\n"

gateway-dev:
	CONFIG=debug APP_VARIANT=dev ./build-app.sh

extension:
	cd extension && pnpm run build

all: gateway extension

clean:
	rm -rf .build dist extension/dist extension/node_modules "Agent Browser Gateway.app" "Agent Browser Gateway Dev.app" Gateway.app

lint:
	cd extension && pnpm run lint

format:
	cd extension && pnpm run format

test:
	swift test
	cd extension && pnpm run typecheck
	node --test scripts/safari-extension.test.mjs

verify:
	cd extension && pnpm run typecheck && pnpm run lint
	node --test scripts/resolve-reproducible-output.test.mjs
	node --test scripts/safari-extension.test.mjs
	swift test
	swift build -c release
	cd extension && pnpm run build

dist:
ifndef VERSION
	$(error VERSION is required, e.g. make dist VERSION=0.3.10)
endif
	VERSION="$(VERSION)" SIGN_IDENTITY="$(SIGN_IDENTITY)" NOTARY_PROFILE="$(NOTARY_PROFILE)" GITHUB_REPOSITORY="$(GITHUB_REPOSITORY)" CASK_OUTPUT="$(CASK_OUTPUT)" bash scripts/dist-macos-arm64.sh

reproducible-build:
	bash scripts/reproducible-build.sh

appstore-preflight:
	VERSION="$(VERSION)" BUILD_NUMBER="$(BUILD_NUMBER)" APPSTORE_PROVISIONING_PROFILE="$(APPSTORE_PROVISIONING_PROFILE)" APPSTORE_APP_SIGN_IDENTITY="$(APPSTORE_APP_SIGN_IDENTITY)" APPSTORE_INSTALLER_SIGN_IDENTITY="$(APPSTORE_INSTALLER_SIGN_IDENTITY)" bash scripts/appstore-preflight.sh

appstore-pkg:
ifndef VERSION
	$(error VERSION is required, e.g. make appstore-pkg VERSION=0.4.2)
endif
	VERSION="$(VERSION)" BUILD_NUMBER="$(BUILD_NUMBER)" APPSTORE_BUNDLE_ID="$(APPSTORE_BUNDLE_ID)" APPSTORE_PROVISIONING_PROFILE="$(APPSTORE_PROVISIONING_PROFILE)" APPSTORE_APP_SIGN_IDENTITY="$(APPSTORE_APP_SIGN_IDENTITY)" APPSTORE_INSTALLER_SIGN_IDENTITY="$(APPSTORE_INSTALLER_SIGN_IDENTITY)" bash scripts/dist-mac-app-store.sh

docker-repro:
	bash scripts/repro-docker-build.sh

release-dmg: dist
	VERSION="$(VERSION)" SIGN_IDENTITY="$(SIGN_IDENTITY)" NOTARY_PROFILE="$(NOTARY_PROFILE)" bash scripts/dist-pages-dmg.sh

pages-dmg: release-dmg

windows-dist:
ifndef VERSION
	$(error VERSION is required, e.g. make windows-dist VERSION=0.3.10)
endif
	powershell -ExecutionPolicy Bypass -File scripts/dist-windows-x64.ps1 -Version "$(VERSION)"

pages-windows: windows-dist

release: release-dmg
	@echo "Release artifacts for v$(VERSION) are in dist/"
	@echo "Tag: git tag -s v$(VERSION) -m 'v$(VERSION)' && git push origin v$(VERSION)"
