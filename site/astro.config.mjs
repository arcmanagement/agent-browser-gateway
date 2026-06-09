import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://agent-browser-gateway.com",
  integrations: [
    starlight({
      title: "Agent Browser Gateway Docs",
      description:
        "Install Agent Browser Gateway, share browser tabs with local AI agents, and use the abg CLI safely.",
      defaultLocale: "root",
      locales: {
        root: {
          label: "English",
          lang: "en",
        },
        ja: {
          label: "日本語",
          lang: "ja",
        },
      },
      pagefind: true,
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/arcmanagement/homebrew-agent-browser-gateway",
        },
      ],
      sidebar: [
        {
          label: "Start",
          translations: { ja: "はじめに" },
          items: [
            { label: "Get Started", translations: { ja: "はじめに" }, slug: "docs" },
            { label: "Install", translations: { ja: "インストール" }, slug: "docs/install" },
            { label: "Distribution", translations: { ja: "Distribution" }, slug: "docs/distribution" },
            { label: "CLI", translations: { ja: "CLI" }, slug: "docs/cli" },
            { label: "Plugins", translations: { ja: "プラグイン" }, slug: "docs/plugins" },
            { label: "Architecture", translations: { ja: "アーキテクチャ" }, slug: "docs/architecture" },
            { label: "Security", translations: { ja: "セキュリティ" }, slug: "docs/security" },
            { label: "FAQ", translations: { ja: "FAQ" }, slug: "docs/faq" },
          ],
        },
      ],
    }),
  ],
});
