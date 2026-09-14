/** Vite's `?raw` import suffix — used to inline real card/icon artwork (see cardAssets.ts)
   so its `.icon-*` classes can be theme-coloured via CSS, which an <img src> can't do. */
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
