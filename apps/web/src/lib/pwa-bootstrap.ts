/**
 * CATCH THE INSTALL EVENT BEFORE REACT IS THERE TO HEAR IT.
 *
 * Chromium fires `beforeinstallprompt` once per page load, as soon as it
 * decides the site is installable, and that can be before the app's scripts
 * hydrate. A listener added in an effect then never hears it, and "Install
 * app" silently never appears on exactly the fast pages. This runs inline
 * during parsing (root layout, with the request's nonce) and parks the event
 * on `window.__daInstall`; lib/pwa.ts picks it up when it starts listening.
 *
 * A string, not a function, because it is written into the page as-is.
 */
export const INSTALL_BOOTSTRAP =
  'window.__daInstall={prompt:null,installed:false};addEventListener("beforeinstallprompt",function(e){window.__daInstall.prompt=e});addEventListener("appinstalled",function(){window.__daInstall.prompt=null;window.__daInstall.installed=true});';
