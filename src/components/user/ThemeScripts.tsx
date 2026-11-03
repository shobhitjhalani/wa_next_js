"use client";

import { useEffect } from "react";

const A = "/common_assets/";

// includes/footer.php scripts. The theme's plugins.js pulled Choices/Flatpickr in with
// document.writeln (and from the production domain), which cannot work after hydration,
// so the libraries are loaded here in order and initialised directly.
const SCRIPTS = [
  `${A}js/jquery.min.js`,
  `${A}libs/simplebar/simplebar.min.js`,
  `${A}libs/node-waves/waves.min.js`,
  `${A}libs/feather-icons/feather.min.js`,
  `${A}libs/choices.js/public/assets/scripts/choices.min.js`,
  `${A}libs/flatpickr/flatpickr.min.js`,
  `${A}js/app.js`,
];

type W = Window & {
  flatpickr?: (el: Element, opts: Record<string, unknown>) => unknown;
  Choices?: new (el: Element, opts: Record<string, unknown>) => unknown;
  feather?: { replace: () => void };
};

function load(src: string) {
  return new Promise<void>((resolve) => {
    if (document.querySelector(`script[data-theme-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.dataset.themeSrc = src;
    s.onload = s.onerror = () => resolve();
    document.body.appendChild(s);
  });
}

export default function ThemeScripts() {
  useEffect(() => {
    (async () => {
      for (const src of SCRIPTS) await load(src);
      const w = window as W;
      document.querySelectorAll('[data-provider="flatpickr"]').forEach((el) => {
        if ((el as unknown as { _flatpickr?: unknown })._flatpickr || !w.flatpickr) return;
        const range = el.getAttribute("data-range-date") === "true";
        const def = el.getAttribute("data-deafult-date") || (el as HTMLInputElement).value;
        w.flatpickr(el, {
          dateFormat: el.getAttribute("data-date-format") || "d-m-Y",
          mode: range ? "range" : "single",
          defaultDate: def ? def.split(" to ") : undefined,
        });
      });
      document.querySelectorAll("select[data-choices]").forEach((el) => {
        if (!w.Choices || el.closest(".choices")) return;
        new w.Choices(el, { searchEnabled: true, shouldSort: false, itemSelectText: "" });
      });
      w.feather?.replace();
    })();
  }, []);
  return null;
}
