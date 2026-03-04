import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Spindle',
  description: 'A Preact-based story format for Twine 2.',
  base: '/spindle/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@rohal12/spindle' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [{ text: 'Introduction', link: '/' }],
      },
      {
        text: 'Authoring',
        items: [
          { text: 'Markup', link: '/markup' },
          { text: 'Macros', link: '/macros' },
          { text: 'Variables', link: '/variables' },
          { text: 'Special Passages', link: '/special-passages' },
          { text: 'Widgets', link: '/widgets' },
        ],
      },
      {
        text: 'Systems',
        items: [
          { text: 'Saves', link: '/saves' },
          { text: 'Settings', link: '/settings' },
          { text: 'Story API', link: '/story-api' },
        ],
      },
      {
        text: 'Developer',
        items: [
          { text: 'npm Package', link: '/story-format-packages' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/rohal12/spindle' },
    ],
  },
});
