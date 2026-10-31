// Shared-element transitions name one pair of elements at a time, so the browser morphs one cover instead of
// capturing every card on a long list. On a list, [data-vt] art is named when its link is the page being opened
// or the page just left. On a detail page, [data-vt-peer] art is named only when the other page named the same
// thing: an unmatched layer would be drawn above the whole page for the length of the transition. Content that
// sits over a peer ([data-vt-with]) gets a layer of its own, so the morphing art stays underneath it.
(() => {
  const KEY = "vt-name";
  const store = (fn) => {
    try {
      return fn(sessionStorage);
    } catch {}
  };
  const path = (url) => new URL(url, location.href).pathname.replace(/\/$/, "");
  const all = () => document.querySelectorAll("[data-vt], [data-vt-peer], [data-vt-with]");
  const clear = () => all().forEach((el) => (el.style.viewTransitionName = ""));
  const name = (url) => {
    const target = path(url);
    for (const el of document.querySelectorAll("[data-vt]")) {
      const link = el.closest("a");
      const box = el.getBoundingClientRect();
      if (link && path(link.href) === target && box.bottom > 0 && box.top < innerHeight) {
        el.style.viewTransitionName = el.dataset.vt;
        return el.dataset.vt;
      }
    }
  };
  const peer = (vt) => {
    const el = [...document.querySelectorAll("[data-vt-peer]")].find((el) => el.dataset.vtPeer === vt);
    if (!el) return false;
    el.style.viewTransitionName = vt;
    for (const over of document.querySelectorAll("[data-vt-with]")) if (over.dataset.vtWith === vt) over.style.viewTransitionName = `${vt}-with`;
    return true;
  };
  // The pair a detail page arrived with, so going back to that page morphs the same element home.
  let arrival;
  addEventListener("pageswap", (e) => {
    const to = e.activation?.entry.url;
    if (!e.viewTransition || !to) return;
    const vt = name(to);
    if (vt) store((s) => s.setItem(KEY, vt));
    else if (arrival && path(arrival.from) === path(to)) peer(arrival.vt);
  });
  addEventListener("pagereveal", (e) => {
    clear();
    const vt = store((s) => s.getItem(KEY));
    store((s) => s.removeItem(KEY));
    if (!e.viewTransition) return;
    // Entrance animations would fight the morph; pages skip them when this class is set.
    document.documentElement.classList.add("vt-arrived");
    e.viewTransition.finished.finally(clear);
    const from = self.navigation?.activation?.from?.url;
    if (from && !name(from) && vt && peer(vt)) arrival = { from, vt };
  });
})();
