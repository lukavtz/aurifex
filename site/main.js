/* Aurifex site behaviour: locale switching, reveals, sparks, magnetic CTA,
   terminal typing, copy buttons, sticky header. No dependencies. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(() => {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const STORE = "aurifex-lang";
  const LANGS = ["en", "ru", "zh"];
  const dict = window.AURIFEX_I18N || {};

  /* ------------------------------------------------------------- i18n */

  const meta = {
    title: document.querySelector('meta[property="og:title"]'),
    description: document.querySelector('meta[property="og:description"]'),
    ogImageAlt: document.querySelector('meta[property="og:image:alt"]'),
    twitterTitle: document.querySelector('meta[name="twitter:title"]'),
    twitterDescription: document.querySelector('meta[name="twitter:description"]'),
    descriptionTag: document.querySelector('meta[name="description"]'),
  };

  function pickLang() {
    const params = new URLSearchParams(location.search);
    const fromUrl = (params.get("lang") || "").toLowerCase();
    if (LANGS.includes(fromUrl)) return fromUrl;
    let stored = null;
    try {
      stored = localStorage.getItem(STORE);
    } catch {
      stored = null;
    }
    if (LANGS.includes(stored)) return stored;
    const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    return LANGS.includes(nav) ? nav : "en";
  }

  function applyLang(lang, remember) {
    const strings = dict[lang];
    if (!strings) return;
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    document.title = strings["meta.title"];

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const value = strings[el.dataset.i18n];
      if (typeof value === "string") el.textContent = value;
    });

    document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
      const value = strings[el.dataset.i18nAlt];
      if (typeof value === "string") el.setAttribute("alt", value);
    });

    document.querySelectorAll("[data-i18n-label]").forEach((el) => {
      const value = strings[el.dataset.i18nLabel];
      if (typeof value === "string") el.setAttribute("aria-label", value);
    });

    document.querySelectorAll(".lang__btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
    });

    if (meta.title) meta.title.setAttribute("content", strings["meta.title"]);
    if (meta.twitterTitle) meta.twitterTitle.setAttribute("content", strings["meta.title"]);
    if (meta.description) meta.description.setAttribute("content", strings["meta.description"]);
    if (meta.twitterDescription)
      meta.twitterDescription.setAttribute("content", strings["meta.description"]);
    if (meta.descriptionTag)
      meta.descriptionTag.setAttribute("content", strings["meta.description"]);
    if (meta.ogImageAlt) meta.ogImageAlt.setAttribute("content", strings["hero.artAlt"]);

    if (remember) {
      try {
        localStorage.setItem(STORE, lang);
      } catch {
        /* private mode: the URL still carries the choice */
      }
      const url = new URL(location.href);
      url.searchParams.set("lang", lang);
      history.replaceState({ lang }, "", url);
    }
  }

  const initialLang = pickLang();
  applyLang(initialLang, false);
  if (!new URLSearchParams(location.search).has("lang")) {
    const url = new URL(location.href);
    url.searchParams.set("lang", initialLang);
    history.replaceState({ lang: initialLang }, "", url);
  }

  document.querySelectorAll(".lang__btn").forEach((btn) => {
    btn.addEventListener("click", () => applyLang(btn.dataset.lang, true));
  });

  /* ---------------------------------------------------------- topbar */

  const topbar = document.querySelector(".topbar");
  let stuckFrame = 0;
  const syncTopbar = () => {
    stuckFrame = 0;
    topbar.classList.toggle("is-stuck", window.scrollY > 18);
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!stuckFrame) stuckFrame = requestAnimationFrame(syncTopbar);
    },
    { passive: true },
  );
  syncTopbar();

  /* --------------------------------------------------------- reveals */

  const revealTargets = Array.from(document.querySelectorAll(".reveal"));
  revealTargets.forEach((el) => {
    const siblings = Array.from(el.parentElement.children).filter((n) =>
      n.classList.contains("reveal"),
    );
    el.style.setProperty("--i", String(Math.min(siblings.indexOf(el), 5)));
  });

  const diagram = document.querySelector(".diagram");
  if (diagram) {
    diagram.querySelectorAll(".node").forEach((node, i) => {
      node.style.setProperty("--i", String(i));
    });
  }

  if ("IntersectionObserver" in window && !reduce.matches) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    revealTargets.forEach((el) => io.observe(el));
  } else {
    revealTargets.forEach((el) => el.classList.add("is-in"));
  }

  const diagramObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add("is-in");
              diagramObserver.unobserve(entry.target);
            });
          },
          { threshold: 0.2 },
        )
      : null;
  if (diagram && diagramObserver) diagramObserver.observe(diagram);
  else if (diagram) diagram.classList.add("is-in");

  /* ------------------------------------------------- --- sparks canvas */

  const canvas = document.getElementById("sparks");

  function paintSparks() {
    if (!canvas) return;
    const hero = canvas.parentElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let sparks = [];
    let pointerX = 0.5;
    let pointerY = 0.4;
    let pointerActive = false;
    let raf = 0;
    let last = 0;
    let visible = true;

    const count = () => Math.max(26, Math.min(78, Math.round(width / 17)));

    function seed(n) {
      sparks = Array.from({ length: n }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.5 + Math.random() * 1.4,
        vy: 0.11 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
        sway: 0.14 + Math.random() * 0.4,
        alpha: 0.16 + Math.random() * 0.5,
        teal: Math.random() < 0.14,
      }));
    }

    function resize() {
      const rect = hero.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed(count());
    }

    function frame(time) {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(48, time - (last || time));
      last = time;
      ctx.clearRect(0, 0, width, height);

      const px = pointerX * width;
      const py = pointerY * height;

      for (const s of sparks) {
        s.y -= s.vy * dt * 0.06;
        s.phase += dt * 0.0012;
        s.x += Math.sin(s.phase) * s.sway * 0.16;

        if (pointerActive) {
          const dx = s.x - px;
          const dy = s.y - py;
          const dist = Math.hypot(dx, dy);
          if (dist < 170 && dist > 0.001) {
            const push = (1 - dist / 170) * 0.5;
            s.x += (dx / dist) * push;
            s.y += (dy / dist) * push * 0.6;
          }
        }

        if (s.y < -6) {
          s.y = height + 6;
          s.x = Math.random() * width;
        }
        if (s.x < -8) s.x = width + 8;
        if (s.x > width + 8) s.x = -8;

        const twinkle = 0.72 + Math.sin(s.phase * 1.6) * 0.28;
        ctx.beginPath();
        ctx.fillStyle = s.teal
          ? `rgba(55, 196, 176, ${(s.alpha * twinkle).toFixed(3)})`
          : `rgba(255, 206, 120, ${(s.alpha * twinkle).toFixed(3)})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (raf || reduce.matches) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    resize();

    if (reduce.matches) {
      // Static field: texture without motion.
      sparks.forEach((s) => {
        ctx.beginPath();
        ctx.fillStyle = s.teal
          ? `rgba(55, 196, 176, ${(s.alpha * 0.6).toFixed(3)})`
          : `rgba(255, 206, 120, ${(s.alpha * 0.6).toFixed(3)})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      hero.addEventListener(
        "pointermove",
        (event) => {
          const rect = hero.getBoundingClientRect();
          pointerX = (event.clientX - rect.left) / Math.max(1, rect.width);
          pointerY = (event.clientY - rect.top) / Math.max(1, rect.height);
          pointerActive = true;
        },
        { passive: true },
      );
      hero.addEventListener("pointerleave", () => {
        pointerActive = false;
      });
      start();
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        (entries) => {
          visible = entries[0].isIntersecting;
          if (visible) start();
          else stop();
        },
        { threshold: 0 },
      ).observe(hero);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (visible) start();
    });

    let resizeFrame = 0;
    const onResize = () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
      });
    };
    if ("ResizeObserver" in window) new ResizeObserver(onResize).observe(hero);
    else window.addEventListener("resize", onResize, { passive: true });

    reduce.addEventListener?.("change", onResize);
  }

  paintSparks();

  /* -------------------------------------------------------- magnetic CTA */

  const magnet = document.querySelector("[data-magnetic]");
  if (magnet && finePointer.matches && !reduce.matches) {
    let settle = 0;
    magnet.addEventListener("pointermove", (event) => {
      const rect = magnet.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      magnet.style.transition = "none";
      magnet.style.transform = `translate3d(${(dx * 4).toFixed(2)}px, ${(dy * 3).toFixed(2)}px, 0)`;
    });
    magnet.addEventListener("pointerleave", () => {
      clearTimeout(settle);
      magnet.style.transition = "transform .4s cubic-bezier(.23,1,.32,1)";
      magnet.style.transform = "translate3d(0, 0, 0)";
      settle = setTimeout(() => {
        magnet.style.transition = "";
        magnet.style.transform = "";
      }, 420);
    });
  }

  /* ---------------------------------------------------------- terminal */

  const term = document.querySelector("[data-term]");
  const termBody = term ? term.querySelector(".term__body") : null;
  let termRun = 0;

  async function typeTerminal(force) {
    if (!termBody) return;
    const run = ++termRun;
    const lines = Array.from(termBody.querySelectorAll(".term__line"));
    if (!lines.length) return;

    lines.forEach((line) => {
      if (!line.dataset.text) line.dataset.text = line.textContent.trim();
      line.textContent = "";
      line.classList.remove("is-typed", "is-shown");
    });
    termBody.querySelectorAll(".term__caret").forEach((caret) => caret.remove());

    if (reduce.matches && !force) {
      lines.forEach((line) => {
        line.textContent = line.dataset.text;
        line.classList.add(line.dataset.termLine === "cmd" ? "is-typed" : "is-shown");
      });
      return;
    }

    for (const line of lines) {
      if (run !== termRun) return;
      const text = line.dataset.text;
      if (line.dataset.termLine === "cmd") {
        line.classList.add("is-typed");
        let shown = "";
        for (const char of text) {
          if (run !== termRun) return;
          shown += char;
          line.textContent = shown;
          await sleep(char === " " ? 26 : 15);
        }
        line.textContent = text;
        await sleep(240);
      } else {
        await sleep(90);
        line.textContent = text;
        line.classList.add("is-shown");
      }
    }

    if (run !== termRun) return;
    const caret = document.createElement("span");
    caret.className = "term__caret";
    caret.setAttribute("aria-hidden", "true");
    lines[lines.length - 1].append(caret);
  }

  if (term) {
    let started = false;
    const kick = () => {
      if (started) return;
      started = true;
      typeTerminal(false);
    };
    if ("IntersectionObserver" in window && !reduce.matches) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            kick();
            io.disconnect();
          }
        },
        { threshold: 0.35 },
      );
      io.observe(term);
    } else {
      kick();
    }

    const replay = term.querySelector("[data-term-replay]");
    if (replay) replay.addEventListener("click", () => typeTerminal(true));
  }

  /* ------------------------------------------------------------- copy */

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copyTarget);
      if (!source) return;
      const text = source.textContent.trim();
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        try {
          copied = document.execCommand("copy");
        } catch {
          copied = false;
        }
        area.remove();
      }
      if (!copied) return;
      const lang = document.documentElement.lang.slice(0, 2);
      const strings = dict[lang === "zh" ? "zh" : lang] || dict.en;
      button.dataset.copied = "true";
      button.textContent = strings["hero.copied"];
      setTimeout(() => {
        delete button.dataset.copied;
        button.textContent = strings["hero.copy"];
      }, 1600);
    });
  });
})();
