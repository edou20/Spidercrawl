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
      { text: 'SDKs', link: '/sdks/typescript' }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is Spidercrawl?', link: '/guide/what-is-spidercrawl' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' }
        ]
      },
      {
        text: 'Core Features',
        items: [
          { text: 'Intelligent Scraping', link: '/guide/scraping' },
          { text: 'Goal-Oriented Crawling', link: '/guide/crawling' },
          { text: 'Knowledge Graphs', link: '/guide/knowledge-graphs' },
          { text: 'AI Extraction', link: '/guide/extraction' }
        ]
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/api/reference' },
          { text: 'Scrape Endpoint', link: '/api/scrape' },
          { text: 'Crawl Endpoint', link: '/api/crawl' },
          { text: 'Search & RAG', link: '/api/search' }
        ]
      },
      {
        text: 'SDKs',
        items: [
          { text: 'TypeScript/Node.js', link: '/sdks/typescript' },
          { text: 'Python', link: '/sdks/python' }
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
