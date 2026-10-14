/**
 * HOLDING OFF THE SHOP'S SELF-RELOAD — while a reload would lose work.
 *
 * BuildWatcher reloads the page once a new build is out. That is right on a page
 * that holds nothing, and wrong while a customer is designing or a file is still
 * uploading: the reload cut uploads mid-way and threw away choices nobody had saved
 * (code review WEB-07 / DSN-08). Whatever would lose work holds the reload for as
 * long as it lasts; BuildWatcher then shows its "update ready" bar instead and
 * leaves the moment to the customer.
 *
 *   useEffect(() => holdReloads(), []);           // a component: held while mounted
 *   const release = holdReloads(); … release();   // a task: held while it runs
 */
let holds = 0;

/** Hold the reload until the returned function is called. Calling it twice is harmless. */
export function holdReloads(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
  };
}

/** True while anything holds the reload. */
export function reloadsHeld(): boolean {
  return holds > 0;
}
