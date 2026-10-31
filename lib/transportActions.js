/*
  Side menu actions for Transport (Report by dates, Excel, PDF, Email report).
  On /transport the page hears a window event and runs the action straight away.
  On any other page we open /transport?do=<action>; the page runs it once its data has loaded.
  Used by components/TransportSideNav.js (also inside the Office Expense side menu) and app/transport/page.js.
*/

export const TRANSPORT_ACTION_EVENT = 'transport-action';
export const TRANSPORT_RANGE_EVENT = 'rr-open-transport';
export const TRANSPORT_ACTIONS = ['range', 'excel', 'pdf', 'email'];

export function runTransportAction(router, path, act) {
  if (path === '/transport') {
    window.dispatchEvent(new CustomEvent(TRANSPORT_ACTION_EVENT, { detail: act }));
  } else {
    router.push(`/transport?do=${act}`);
  }
}
