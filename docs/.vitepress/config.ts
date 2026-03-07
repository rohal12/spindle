import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Spindle',
  description: 'A Preact-based story format for Twine 2.',
  base: '/spindle/',
  appearance: true,

  head: [['meta', { name: 'theme-color', content: '#6366f1' }]],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/markup' },
      { text: 'Macros', link: '/macros' },
      { text: 'Story API', link: '/story-api' },
      {
        text: 'npm',
        link: 'https://www.npmjs.com/package/@rohal12/spindle',
      },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [{ text: 'What is Spindle?', link: '/' }],
      },
      {
        text: 'Authoring',
        items: [
          { text: 'Markup', link: '/markup' },
          {
            text: 'Macros',
            link: '/macros',
            collapsed: true,
            items: [
              { text: 'Control Flow', link: '/macros#control-flow' },
              { text: 'Variables', link: '/macros#variables' },
              { text: 'Output', link: '/macros#output' },
              { text: 'Navigation', link: '/macros#navigation' },
              { text: 'Form Inputs', link: '/macros#form-inputs' },
              { text: 'Timing', link: '/macros#timing' },
              { text: 'Composition', link: '/macros#composition' },
              { text: 'Saves and UI', link: '/macros#saves-and-ui' },
            ],
          },
          { text: 'Variables', link: '/variables' },
          {
            text: 'Special Passages',
            link: '/special-passages',
            collapsed: true,
            items: [
              { text: 'StoryInit', link: '/special-passages#storyinit' },
              {
                text: 'StoryVariables',
                link: '/special-passages#storyvariables',
              },
              {
                text: 'StoryInterface',
                link: '/special-passages#storyinterface',
              },
              { text: 'SaveTitle', link: '/special-passages#savetitle' },
            ],
          },
          { text: 'StoryInterface', link: '/story-interface' },
          {
            text: 'Widgets',
            link: '/widgets',
            collapsed: true,
            items: [
              { text: 'Defining a Widget', link: '/widgets#defining-a-widget' },
              { text: 'Using a Widget', link: '/widgets#using-a-widget' },
              { text: 'Arguments', link: '/widgets#arguments' },
              { text: 'How Widgets Work', link: '/widgets#how-widgets-work' },
              { text: 'Example', link: '/widgets#example' },
            ],
          },
          {
            text: 'Custom Macros',
            link: '/custom-macros',
            collapsed: true,
            items: [
              {
                text: 'Registering a Macro',
                link: '/custom-macros#registering-a-macro',
              },
              { text: 'Reading State', link: '/custom-macros#reading-state' },
              { text: 'Mutating State', link: '/custom-macros#mutating-state' },
              { text: 'When Code Runs', link: '/custom-macros#when-code-runs' },
              {
                text: 'Variable Namespaces',
                link: '/custom-macros#variable-namespaces-at-a-glance',
              },
              {
                text: 'Complete Example',
                link: '/custom-macros#complete-example',
              },
            ],
          },
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
          { text: 'Automation', link: '/automation' },
          { text: 'npm Package', link: '/story-format-packages' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/rohal12/spindle' },
    ],

    footer: {
      message: 'Released under the Unlicense.',
      copyright: 'Public domain.',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/rohal12/spindle/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
