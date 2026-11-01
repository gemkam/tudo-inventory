// Opening animation boot script (1 Nov 2026). Runs in <head> before the page paints:
// on the MAIN page (/) the animation plays every time the page is opened or refreshed,
// on every other page it is hidden at once. Used by app/layout.js, the animation is components/IntroSplash.js.
export const INTRO_REPLAY = 'tudo-intro-replay'; // window event the "▶ Intro" button sends to play it again
export const INTRO_BOOT = `(function(){var d=document.documentElement;try{if(location.pathname==='/'){d.classList.add('intro-playing');}else{d.classList.add('intro-done');}}catch(e){d.classList.add('intro-done');}})();`;
