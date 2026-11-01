// Opening animation boot script (1 Nov 2026). Runs in <head> before the page paints:
// if the intro already played in this tab (or the device asks for less motion) it is hidden at once,
// otherwise the page waits behind it. Used by app/layout.js, the animation is components/IntroSplash.js.
export const INTRO_KEY = 'tudo-intro-seen';
export const INTRO_BOOT = `(function(){var d=document.documentElement;try{if(sessionStorage.getItem('${INTRO_KEY}')||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){d.classList.add('intro-done');}else{d.classList.add('intro-playing');}}catch(e){d.classList.add('intro-done');}})();`;
