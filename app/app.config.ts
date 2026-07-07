export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      secondary: 'violet',
      info: 'sky',
      warning: 'amber',
      neutral: 'slate'
    },
    dashboardSidebar: {
      slots: {
        root: 'transition-[width] duration-200 ease-in-out',
        header: 'overflow-x-hidden',
        body: 'overflow-x-hidden',
        footer: 'overflow-x-hidden'
      }
    }
  }
})
