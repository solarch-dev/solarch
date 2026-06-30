/* Ambient declaration: @polar-sh/sdk "./webhooks" subpath'ini classic moduleResolution
 * altında tip olarak çözer. Runtime'da Node exports map gerçek modüle yönlendirir.
 * Tipleri SDK'nın gerçek .d.ts'inden devralır. */
declare module "@polar-sh/sdk/webhooks" {
  export * from "@polar-sh/sdk/dist/commonjs/webhooks.js";
}
