/* Shared page behaviour: language menu (crawlable links) + remembering the chosen language. */
(() => {
  "use strict";
  document.querySelectorAll(".lang-menu").forEach((menu) => {
    const btn = menu.querySelector(".lang-menu__btn");
    const list = menu.querySelector(".lang-menu__list");
    const close = () => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = list.hidden;
      list.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) { const cur = list.querySelector('[aria-current="true"]') || list.querySelector("a"); cur && cur.focus(); }
    });
    document.addEventListener("click", (e) => { if (!menu.contains(e.target)) close(); });
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
  });
  // Remember the language a visitor picks, so the home page sends them there next time.
  document.querySelectorAll("a[data-lang]").forEach((a) => a.addEventListener("click", () => {
    try { localStorage.setItem("tarkeez.lang", JSON.stringify(a.dataset.lang)); } catch { /* storage disabled */ }
  }));
})();
