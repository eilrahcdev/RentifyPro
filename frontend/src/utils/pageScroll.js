export function scrollPageToTop({ behavior = "smooth" } = {}) {
  const scroller = document.documentElement.classList.contains("rp-fixed-navbar-layout")
    ? document.body
    : window;
  scroller.scrollTo({ top: 0, left: 0, behavior });
}
