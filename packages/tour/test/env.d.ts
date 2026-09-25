// Vite `?raw` imports (the stylesheet is read as text by the overlay and styles tests).
declare module '*.css?raw' {
  const css: string
  export default css
}
