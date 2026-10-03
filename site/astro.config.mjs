import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Code blocks use the same dark "instrument glass" in both themes as the landing page
// terminals, so command evidence always reads the same way.
const codeGlass = {
  background: "#090c0d",
  border: "rgba(255, 255, 255, 0.09)",
  title: "#84908c",
};

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
      favicon: "/favicon.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: "/fonts/Geist-Variable.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: "",
          },
        },
        { tag: "link", attrs: { rel: "icon", href: "/favicon.ico", sizes: "32x32" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        { tag: "meta", attrs: { property: "og:image", content: "https://agent-browser-gateway.com/assets/social-card.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://agent-browser-gateway.com/assets/social-card.png" } },
      ],
      customCss: ["./src/styles/tokens.css", "./src/styles/starlight.css"],
      components: {
        SiteTitle: "./src/components/docs/SiteTitle.astro",
        PageTitle: "./src/components/docs/PageTitle.astro",
      },
      expressiveCode: {
        defaultProps: { wrap: true, preserveIndent: true },
        themes: ["vitesse-black"],
        useStarlightDarkModeSwitch: false,
        useStarlightUiThemeColors: false,
        styleOverrides: {
          borderRadius: "12px",
          borderColor: codeGlass.border,
          codeBackground: codeGlass.background,
          codeFontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.7",
          codePaddingBlock: "0.95rem",
          codePaddingInline: "1.15rem",
          uiFontFamily: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
          focusBorder: "#3dff8f",
          scrollbarThumbColor: "rgba(255, 255, 255, 0.14)",
          scrollbarThumbHoverColor: "rgba(255, 255, 255, 0.24)",
          frames: {
            frameBoxShadowCssValue: "none",
            editorBackground: codeGlass.background,
            editorTabBarBackground: "#0d1112",
            editorTabBarBorderColor: codeGlass.border,
            editorTabBarBorderBottomColor: codeGlass.border,
            editorActiveTabBackground: codeGlass.background,
            editorActiveTabForeground: "#e6ece9",
            editorActiveTabIndicatorTopColor: "#3dff8f",
            editorActiveTabIndicatorBottomColor: "transparent",
            terminalBackground: codeGlass.background,
            terminalTitlebarBackground: "#0d1112",
            terminalTitlebarForeground: codeGlass.title,
            terminalTitlebarBorderBottomColor: codeGlass.border,
            terminalTitlebarDotsForeground: "rgba(255, 255, 255, 0.18)",
            terminalTitlebarDotsOpacity: "1",
            inlineButtonBackground: "rgba(255, 255, 255, 0.06)",
            inlineButtonBorder: "rgba(255, 255, 255, 0.14)",
            inlineButtonForeground: "#c2ccc8",
            tooltipSuccessBackground: "#19c46a",
            tooltipSuccessForeground: "#04130a",
          },
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
          translations: { ja: "導入" },
          items: [
            { label: "Get Started", translations: { ja: "はじめに" }, slug: "docs" },
            { label: "Install", translations: { ja: "インストール" }, slug: "docs/install" },
          ],
        },
        {
          label: "Guides",
          translations: { ja: "ガイド" },
          items: [
            { label: "CLI", translations: { ja: "CLI" }, slug: "docs/cli" },
            { label: "Plugins", translations: { ja: "プラグイン" }, slug: "docs/plugins" },
          ],
        },
        {
          label: "Reference",
          translations: { ja: "リファレンス" },
          items: [
            { label: "Security", translations: { ja: "セキュリティ" }, slug: "docs/security" },
            { label: "Architecture", translations: { ja: "アーキテクチャ" }, slug: "docs/architecture" },
            { label: "Distribution", translations: { ja: "配布" }, slug: "docs/distribution" },
            { label: "FAQ", translations: { ja: "FAQ" }, slug: "docs/faq" },
          ],
        },
      ],
    }),
  ],
});
