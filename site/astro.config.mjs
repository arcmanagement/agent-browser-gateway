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
          href: "https://github.com/arcmanagement/agent-browser-gateway",
        },
      ],
      sidebar: [
        {
          label: "Start",
          translations: { ja: "はじめに" },
          items: [
            { label: "Overview", slug: "docs" },
            { label: "Install", slug: "docs/install" },
            { label: "CLI", slug: "docs/cli" },
            { label: "Plugins", slug: "docs/plugins" },
          ],
        },
      ],
    }),
  ],
});
