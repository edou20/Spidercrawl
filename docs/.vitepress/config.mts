import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Spidercrawl",
  description: "The AI-Native Web Intelligence Engine",
  head: [['link', { rel: 'icon', href: '/favicon.svg' }]],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/reference' },
      { text: 'GitHub', link: 'https://github.com/edou20/Spidercrawl' }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'Hosted deployment', link: '/guide/deployment-hosted' }
        ]
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/api/reference' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/edou20/Spidercrawl' }
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present Spidercrawl Team'
    }
  }
})
