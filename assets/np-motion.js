/*
  Nature Pick - motion layer (visual only).

  Adds the storefront's motion on top of the existing markup without changing any text, link or behaviour:
    - headings rise word by word into view (the words stay real text: only wrapped in spans);
    - blocks, cards and pictures settle in as they enter the viewport, in order;
    - pictures in the origin story and the hero drift at different speeds while scrolling (depth);
    - the sticky header steps aside while reading down and returns on the way up;
    - the hero's main button leans toward the pointer, category dishes tilt under it (fine pointers only);
    - the announcement strip runs as a slow band when it holds a single message.
  Everything waits for prefers-reduced-motion: with it, only the in-view fades remain (np-design.css).
  The hidden "before" states exist only under html.np-motion, which this file sets - without it, nothing is hidden.
*/
(() => {
  if (window.NPMotion) return;
  window.NPMotion = true;

  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  root.classList.add('np-motion');

  /* ------------------------------------------------------------ word-by-word headings */
  const SPLIT = [
    '.np-section-hero h1',
    'main h2.font-display',
    'np-product h1.font-display',
    'main section.border-b h1.font-display',
    '[data-b2b-banner] h2',
  ].join(',');

  function splitWords(heading) {
    if (heading.dataset.npSplit || heading.closest('[data-np-nosplit]')) return;
    heading.dataset.npSplit = '1';
    let index = 0;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (!node.textContent.trim()) return;
      const fragment = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          fragment.append(document.createTextNode(part));
          return;
        }
        const outer = document.createElement('span');
        outer.className = 'np-w';
        const inner = document.createElement('span');
        inner.className = 'np-w__i';
        inner.style.setProperty('--np-wi', String(index++));
        inner.textContent = part;
        outer.append(inner);
        fragment.append(outer);
      });
      node.replaceWith(fragment);
    });
    heading.classList.add('np-split');
  }

  /* ------------------------------------------------------------ in-view reveals */
  const REVEAL = [
    'main .section-label',
    'main h2.font-display + p',
    '[data-b2b-banner] .flex-shrink-0',
    'main section.border-y .grid > div',
    'main section.bg-\\[var\\(--color-olive\\)\\] ul > li',
    'main section.bg-\\[var\\(--color-olive\\)\\] .grid > *',
    'main details',
    'main section.container-page.py-10 .grid > [data-product-card]',
    'main np-product .grid.lg\\:grid-cols-2 > div:nth-child(2) > *',
    'np-product [data-gallery]',
    'main ol > li',
    'footer .grid > div',
    'main section.bg-\\[var\\(--color-paprika-light\\)\\] .container-page > *',
  ].join(',');

  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add('is-in');
              observer.unobserve(entry.target);
            });
          },
          { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
        )
      : null;

  function prepare(scope = document) {
    $$(SPLIT, scope).forEach((heading) => {
      splitWords(heading);
      if (!heading.classList.contains('is-in')) {
        if (observer) observer.observe(heading);
        else heading.classList.add('is-in');
      }
    });
    $$(REVEAL, scope).forEach((el) => {
      if (el.hasAttribute('data-np-in')) return;
      el.setAttribute('data-np-in', '');
      // order among siblings that reveal together (numbered, like a chase)
      const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.matches(REVEAL)) : [el];
      el.style.setProperty('--np-i', String(Math.min(siblings.indexOf(el), 8)));
      if (observer) observer.observe(el);
      else el.classList.add('is-in');
    });
  }

  /* ------------------------------------------------------------ header: away while reading down, back on the way up */
  function initHeader() {
    const bar = document.querySelector('.shopify-section-group-header-group');
    if (!bar) return;
    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const busy =
        document.body.classList.contains('np-scroll-lock') ||
        !!document.querySelector('#np-mobile-menu:not([hidden])') ||
        !!document.querySelector('[data-dropdown].is-open, [data-dropdown]:hover, [data-dropdown]:focus-within');
      bar.classList.toggle('np-head-scrolled', y > 12);
      if (busy || y < 160 || y < lastY - 4) bar.classList.remove('np-head-away');
      else if (y > lastY + 6) bar.classList.add('np-head-away');
      lastY = y;
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    bar.addEventListener('focusin', () => bar.classList.remove('np-head-away'));
    update();
  }

  /* ------------------------------------------------------------ depth: pictures drift at their own speed */
  function initParallax() {
    const layers = [
      ...$$('.np-section-hero .absolute.inset-0.-z-10 img').map((el) => ({ el, speed: 0.18 })),
      ...$$('main section.bg-\\[var\\(--color-olive\\)\\] .grid.grid-cols-2 > *').map((el, i) => ({ el, speed: i % 2 ? -0.08 : 0.06 })),
    ];
    if (!layers.length) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      layers.forEach(({ el, speed }) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > vh + 200) return;
        const offset = (rect.top + rect.height / 2 - vh / 2) * speed;
        el.style.setProperty('--np-drift', `${offset.toFixed(1)}px`);
      });
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ------------------------------------------------------------ fine pointers: magnetic button, tilting dishes */
  function initPointer() {
    $$('.np-section-hero .btn-primary').forEach((button) => {
      button.classList.add('np-magnetic');
      button.addEventListener('pointermove', (event) => {
        const rect = button.getBoundingClientRect();
        const x = (event.clientX - rect.left - rect.width / 2) / rect.width;
        const y = (event.clientY - rect.top - rect.height / 2) / rect.height;
        button.style.setProperty('--np-mx', `${(x * 10).toFixed(1)}px`);
        button.style.setProperty('--np-my', `${(y * 8).toFixed(1)}px`);
      });
      button.addEventListener('pointerleave', () => {
        button.style.setProperty('--np-mx', '0px');
        button.style.setProperty('--np-my', '0px');
      });
    });
    document.addEventListener('pointermove', (event) => {
      const dish = event.target.closest && event.target.closest('a.card-surface:not([data-product-card]) > :first-child');
      if (!dish) return;
      const rect = dish.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      dish.style.setProperty('--np-tx', `${(-y * 5).toFixed(2)}deg`);
      dish.style.setProperty('--np-ty', `${(x * 6).toFixed(2)}deg`);
      dish.style.setProperty('--np-gx', `${((x + 0.5) * 100).toFixed(1)}%`);
      dish.style.setProperty('--np-gy', `${((y + 0.5) * 100).toFixed(1)}%`);
    });
    document.addEventListener(
      'pointerout',
      (event) => {
        const dish = event.target.closest && event.target.closest('a.card-surface:not([data-product-card]) > :first-child');
        if (!dish || dish.contains(event.relatedTarget)) return;
        dish.style.setProperty('--np-tx', '0deg');
        dish.style.setProperty('--np-ty', '0deg');
      },
      true
    );
  }

  /* ------------------------------------------------------------ announcement: a slow band (single message only) */
  function initMarquee() {
    const strip = document.querySelector('[data-header] > div:first-child.bg-\\[var\\(--color-paprika\\)\\] > .container-page');
    if (!strip || strip.querySelector('a, button, form') || strip.children.length !== 1) return;
    const message = strip.firstElementChild;
    const track = document.createElement('div');
    track.className = 'np-marquee__track';
    for (let i = 0; i < 8; i++) {
      const copy = message.cloneNode(true);
      if (i > 0) copy.setAttribute('aria-hidden', 'true');
      track.append(copy);
    }
    message.replaceWith(track);
    strip.classList.add('np-marquee');
  }

  function start() {
    prepare();
    initHeader();
    if (reduce) return;
    initParallax();
    if (finePointer) initPointer();
    initMarquee();
    // the hero speaks first: its heading needs no scroll to arrive
    $$('.np-section-hero h1').forEach((h) => requestAnimationFrame(() => h.classList.add('is-in')));
  }

  // sections re-rendered later (cart, quick view, product variants, recommendations) get the same treatment
  if ('MutationObserver' in window) {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && node.closest && node.closest('main')) {
            prepare(node.parentElement || document);
            return;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
