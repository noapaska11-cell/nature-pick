/*
 * Nature Pick storefront script (vanilla JS, no dependencies).
 * Everything that changes the cart goes through Shopify's own Cart / Section Rendering APIs,
 * so prices, discounts, stock limits and checkout always come from Shopify.
 */
(() => {
  'use strict';

  const NP = window.NP || (window.NP = {});
  const routes = NP.routes || {};
  const strings = NP.strings || {};

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const storage = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {
        /* storage unavailable: the choice still applies for this visit */
      }
    },
  };

  const CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M4 12.5 9 17.5 20 6.5"/></svg>';
  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M6 6l12 12 M18 6 6 18"/></svg>';

  /* ---------------------------------------------------------------- helpers */

  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const parseHTML = (html) => new DOMParser().parseFromString(html, 'text/html');

  const debounce = (fn, wait) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };

  /* Shopify's own money format ("{{amount_with_comma_separator}} kr"), so JS-built prices look exactly like the server-rendered ones */
  function formatWithShopifyFormat(cents, format) {
    const placeholder = /\{\{\s*(\w+)\s*\}\}/;
    const withDelimiters = (number, precision, thousands, decimal) => {
      const fixed = (Number(number) / 100).toFixed(precision);
      const parts = fixed.split('.');
      const whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
      return whole + (parts[1] ? decimal + parts[1] : '');
    };
    const kind = (format.match(placeholder) || [])[1];
    let value;
    switch (kind) {
      case 'amount':
        value = withDelimiters(cents, 2, ',', '.');
        break;
      case 'amount_no_decimals':
        value = withDelimiters(cents, 0, ',', '.');
        break;
      case 'amount_with_comma_separator':
        value = withDelimiters(cents, 2, '.', ',');
        break;
      case 'amount_no_decimals_with_comma_separator':
        value = withDelimiters(cents, 0, '.', ',');
        break;
      case 'amount_no_decimals_with_space_separator':
        value = withDelimiters(cents, 0, ' ', '.');
        break;
      case 'amount_with_space_separator':
        value = withDelimiters(cents, 2, ' ', ',');
        break;
      case 'amount_with_apostrophe_separator':
        value = withDelimiters(cents, 2, "'", '.');
        break;
      default:
        return null;
    }
    let text = format.replace(placeholder, value);
    // like Liquid's money_without_trailing_zeros
    if (Number(cents) % 100 === 0) text = text.replace(/[.,]00(?!\d)/, '');
    return text;
  }

  function formatMoney(cents) {
    if (NP.moneyFormat && NP.currency && NP.currency === NP.shopCurrency) {
      const exact = formatWithShopifyFormat(cents, NP.moneyFormat);
      if (exact) return exact;
    }
    const amount = Number(cents) / 100;
    try {
      const whole = Number.isInteger(amount);
      return new Intl.NumberFormat(NP.locale || 'sv', {
        style: 'currency',
        currency: NP.currency || 'EUR',
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (e) {
      return amount.toFixed(2);
    }
  }

  /* "125 g" / "4.5 kg" - same format as snippets/np-weight.liquid */
  function formatGrams(grams) {
    if (!(grams > 0)) return '';
    if (grams < 1000) return `${Math.round(grams)} g`;
    return `${Math.round(grams / 10) / 100} kg`;
  }

  /* B2B cartons (snippets/np-quantity.liquid with `box`): the visible [data-box-input] counts cartons, the hidden
     quantity field that Shopify's /cart/add receives is always cartons x pieces per carton. */
  function syncBoxQuantity(boxInput) {
    const wrapper = boxInput.closest('[data-quantity]');
    const hidden = wrapper && $('input[name="quantity"]', wrapper);
    const box = parseInt(wrapper && wrapper.dataset.boxSize, 10) || 1;
    if (!hidden) return;
    const cartons = Math.max(1, parseInt(boxInput.value, 10) || 1);
    hidden.value = String(cartons * box);
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('input', (event) => {
    if (event.target.matches && event.target.matches('[data-box-input]')) syncBoxQuantity(event.target);
  });
  document.addEventListener('change', (event) => {
    if (!(event.target.matches && event.target.matches('[data-box-input]'))) return;
    event.target.value = Math.max(1, parseInt(event.target.value, 10) || 1); // no 0, empty or fractional cartons
    syncBoxQuantity(event.target);
  });

  /* Pluralised text from data-count-one / -few / -other attributes (rendered by Liquid for counts 1, 3, 5) */
  function pluralText(el, n) {
    let category = 'other';
    try {
      category = new Intl.PluralRules(NP.locale || 'sv').select(n);
    } catch (e) {
      category = n === 1 ? 'one' : 'other';
    }
    if (category === 'two') category = 'few';
    const map = { one: ['countOne', '1'], few: ['countFew', '3'], other: ['countOther', '5'] };
    const [attr, sample] = map[category] || map.other;
    const template = el.dataset[attr] || el.dataset.countOther || '';
    return template.replace(sample, String(n));
  }

  let scrollLocks = 0;
  function lockScroll(lock) {
    scrollLocks = Math.max(0, scrollLocks + (lock ? 1 : -1));
    document.body.classList.toggle('np-scroll-lock', scrollLocks > 0);
  }

  function trapFocus(container, event) {
    if (event.key !== 'Tab') return;
    const focusable = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container).filter(
      (el) => el.offsetParent !== null
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------ scroll reveal */

  function initReveal(root = document) {
    const nodes = $$('.np-reveal:not([data-reveal-init])', root);
    if (!nodes.length) return;
    const instant =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window) ||
      document.documentElement.classList.contains('shopify-design-mode');
    if (instant) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );
    nodes.forEach((node) => {
      node.dataset.revealInit = '1';
      observer.observe(node);
    });
  }

  /* --------------------------------------------------------------------- toast */

  const toast = {
    timer: null,
    el() {
      return $('[data-toast]');
    },
    hide() {
      const el = this.el();
      if (el) el.classList.remove('is-visible');
    },
    show(html) {
      const el = this.el();
      if (!el) return;
      clearTimeout(this.timer);
      el.innerHTML = html;
      // restart the transition when a toast replaces another one
      void el.offsetWidth;
      el.classList.add('is-visible');
      this.timer = setTimeout(() => this.hide(), 3500);
    },
    added(item, quantity) {
      const image = item.featured_image && item.featured_image.url ? item.featured_image.url : item.image;
      const src = image ? image + (image.includes('?') ? '&' : '?') + 'width=112' : '';
      const qty = quantity > 1 ? quantity + ' × ' : '';
      const picture = src
        ? `<img src="${escapeHtml(src)}" alt="" width="56" height="56" class="h-14 w-14 flex-shrink-0 rounded-xl bg-white object-cover">`
        : '<span class="h-14 w-14 flex-shrink-0 rounded-xl bg-[var(--color-cream-soft)]"></span>';
      this.show(
        `<div class="flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3 shadow-xl shadow-black/10">
          ${picture}
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-olive-dark)]">${CHECK_ICON} ${escapeHtml(strings.added)}</p>
            <p class="truncate text-sm font-medium text-[var(--color-charcoal)]">${qty}${escapeHtml(item.product_title || item.title)}</p>
            <p class="text-xs text-[var(--color-charcoal-soft)]">${formatMoney(item.final_line_price != null ? item.final_line_price : item.price * quantity)}</p>
          </div>
          <div class="flex flex-shrink-0 flex-col items-end gap-1.5">
            <button type="button" data-toast-close aria-label="${escapeHtml(strings.dismissToast)}" class="text-[var(--color-charcoal-soft)] hover:text-[var(--color-charcoal)]">${CLOSE_ICON}</button>
            <a href="${escapeHtml(routes.cart)}" class="whitespace-nowrap text-xs font-semibold text-[var(--color-paprika-dark)] hover:underline">${escapeHtml(strings.viewCart)}</a>
          </div>
        </div>`
      );
    },
    error(message) {
      this.show(
        `<div class="flex items-start gap-3 rounded-2xl border border-[var(--color-paprika)] bg-[var(--color-paper)] p-4 text-sm text-[var(--color-paprika-dark)] shadow-xl shadow-black/10" role="alert">
          <p class="flex-1">${escapeHtml(message || strings.cartError)}</p>
          <button type="button" data-toast-close aria-label="${escapeHtml(strings.dismissToast)}" class="text-[var(--color-charcoal-soft)] hover:text-[var(--color-charcoal)]">${CLOSE_ICON}</button>
        </div>`
      );
    },
  };

  /* ---------------------------------------------------------------------- cart */

  const cart = {
    lastFocus: null,

    sectionIds() {
      const ids = [];
      if ($('[data-cart-drawer]')) ids.push('np-cart-drawer');
      const page = $('[data-cart-page]');
      if (page && page.dataset.sectionId) ids.push(page.dataset.sectionId);
      return ids;
    },

    async request(url, payload) {
      const sections = this.sectionIds();
      const body = Object.assign({}, payload);
      if (sections.length) {
        body.sections = sections.join(',');
        body.sections_url = window.location.pathname;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      let data = {};
      try {
        data = await response.json();
      } catch (e) {
        /* non-JSON error page */
      }
      if (!response.ok || data.status) {
        const error = new Error(data.description || data.message || strings.cartError);
        error.data = data;
        throw error;
      }
      return data;
    },

    async add(items) {
      const data = await this.request(routes.cartAdd, { items });
      await this.afterChange(data);
      return data;
    },

    async change(key, quantity) {
      const data = await this.request(routes.cartChange, { id: key, quantity });
      await this.afterChange(data);
      return data;
    },

    async afterChange(data) {
      if (data.sections) {
        this.applySections(data.sections);
      } else {
        const response = await fetch(routes.cartJson, { headers: { Accept: 'application/json' } });
        const current = await response.json();
        this.setCount(current.item_count);
      }
    },

    applySections(sections) {
      Object.keys(sections).forEach((id) => {
        const html = sections[id];
        if (!html) return;
        const doc = parseHTML(html);
        if (id === 'np-cart-drawer') {
          const liveDrawer = $('[data-cart-drawer-content]');
          const nextDrawer = $('[data-cart-drawer-content]', doc);
          if (liveDrawer && nextDrawer) liveDrawer.innerHTML = nextDrawer.innerHTML;
          const root = $('[data-cart-drawer]', doc);
          if (root) this.setCount(root.dataset.cartCount);
        } else {
          const nextPage = $('[data-cart-page]', doc);
          const livePage = $('[data-cart-page]');
          if (nextPage && livePage) {
            livePage.innerHTML = nextPage.innerHTML;
            livePage.dataset.cartCount = nextPage.dataset.cartCount;
            this.setCount(nextPage.dataset.cartCount);
          }
        }
      });
      // cart line items aren't [data-np-price] elements, so the price-view MutationObserver never sees
      // this swap - re-apply the B2B minimum-order gate here directly (applyB2bMinimumGate is a hoisted
      // function declaration further down, always defined by the time a cart change can call this)
      applyB2bMinimumGate();
    },

    setCount(count) {
      const n = Number(count) || 0;
      $$('[data-cart-badge]').forEach((badge) => {
        badge.textContent = n;
        badge.hidden = n < 1;
      });
    },

    open(trigger) {
      const drawer = $('[data-cart-drawer]');
      if (!drawer) {
        window.location.href = routes.cart;
        return;
      }
      if (drawer.dataset.open === 'true') return;
      drawer.dataset.open = 'true';
      this.lastFocus = trigger || document.activeElement;
      $('.np-overlay', drawer).classList.add('is-open');
      const panel = $('[data-cart-panel]', drawer);
      panel.classList.add('is-open');
      lockScroll(true);
      requestAnimationFrame(() => panel.focus({ preventScroll: true }));
    },

    close() {
      const drawer = $('[data-cart-drawer]');
      if (!drawer || drawer.dataset.open !== 'true') return;
      drawer.dataset.open = 'false';
      $('.np-overlay', drawer).classList.remove('is-open');
      $('[data-cart-panel]', drawer).classList.remove('is-open');
      lockScroll(false);
      if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true });
    },

    showError(scope, message) {
      const box = scope && $('[data-cart-error]', scope);
      if (box) {
        box.textContent = message;
        box.hidden = false;
      } else {
        toast.error(message);
      }
    },

    clearError(scope) {
      const box = scope && $('[data-cart-error]', scope);
      if (box) box.hidden = true;
    },
  };

  /* Reads a product form (id, quantity, selling plan, line item properties) into a cart/add item */
  function itemFromForm(form) {
    const data = new FormData(form);
    const item = { id: Number(data.get('id')), quantity: Math.max(1, parseInt(data.get('quantity'), 10) || 1) };
    const plan = data.get('selling_plan');
    if (plan) item.selling_plan = plan;
    const properties = {};
    data.forEach((value, key) => {
      const match = key.match(/^properties\[(.+)\]$/);
      if (match && value) properties[match[1]] = value;
    });
    if (Object.keys(properties).length) item.properties = properties;
    return item;
  }

  async function handleAjaxForm(form) {
    if (form.dataset.busy) return;
    form.dataset.busy = '1';
    const feedback = form.dataset.cartFeedback || 'toast';
    const buttons = $$('[data-add-button]', form);
    if (form.id) buttons.push(...$$(`[data-add-button][form="${form.id}"]`));
    const submitButtons = $$('button[type="submit"]', form).filter((b) => !buttons.includes(b));
    const all = [...buttons, ...submitButtons];
    all.forEach((b) => b.setAttribute('aria-busy', 'true'));
    cart.clearError(form);
    try {
      const item = itemFromForm(form);
      const data = await cart.add([item]);
      const line = (data.items && data.items[0]) || data;
      if (feedback === 'toast') toast.added(line, item.quantity);
      if (feedback === 'drawer') cart.open(form.querySelector('button[type="submit"]'));
      if (feedback === 'label') flashAdded(buttons);
      if (form.dataset.closeQuickView) closeQuickView();
    } catch (error) {
      cart.showError(form, error.message);
    } finally {
      all.forEach((b) => b.removeAttribute('aria-busy'));
      delete form.dataset.busy;
    }
  }

  function flashAdded(buttons) {
    buttons.forEach((button) => {
      if (button.dataset.flashing) return;
      button.dataset.flashing = '1';
      const original = button.innerHTML;
      button.innerHTML = `${CHECK_ICON} ${escapeHtml(button.dataset.labelAdded || strings.added)}`;
      setTimeout(() => {
        button.innerHTML = original;
        delete button.dataset.flashing;
      }, 2000);
    });
  }

  /* ---------------------------------------------------------------- quick view */

  let quickViewTrigger = null;

  async function openQuickView(url, trigger) {
    const modal = $('[data-quick-view-modal]');
    const content = $('[data-quick-view-content]');
    if (!modal || !content) {
      window.location.href = url;
      return;
    }
    quickViewTrigger = trigger;
    content.innerHTML = `<div class="flex justify-center rounded-3xl bg-[var(--color-paper)] p-16 text-[var(--color-charcoal-soft)]" role="status" aria-label="${escapeHtml(strings.loading)}"><span class="np-spinner"></span></div>`;
    modal.hidden = false;
    lockScroll(true);
    try {
      const separator = url.includes('?') ? '&' : '?';
      const response = await fetch(`${url}${separator}section_id=np-quick-view`);
      if (!response.ok) throw new Error('quick view failed');
      const doc = parseHTML(await response.text());
      const section = $('.shopify-section', doc) || doc.body;
      content.innerHTML = section.innerHTML;
      const closeButton = $('[data-quick-view-close]', content);
      if (closeButton) closeButton.focus();
    } catch (e) {
      closeQuickView();
      window.location.href = url;
    }
  }

  function closeQuickView() {
    const modal = $('[data-quick-view-modal]');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    $('[data-quick-view-content]', modal).innerHTML = '';
    lockScroll(false);
    if (quickViewTrigger && quickViewTrigger.focus) quickViewTrigger.focus({ preventScroll: true });
    quickViewTrigger = null;
  }

  /* -------------------------------------------------------------------- search */

  const search = {
    controller: null,
    modal: () => $('[data-search-modal]'),

    open(trigger) {
      const modal = this.modal();
      if (!modal || !modal.hidden) return;
      this.trigger = trigger;
      modal.hidden = false;
      lockScroll(true);
      const input = $('[data-search-input]', modal);
      requestAnimationFrame(() => input && input.focus());
    },

    close() {
      const modal = this.modal();
      if (!modal || modal.hidden) return;
      modal.hidden = true;
      lockScroll(false);
      const input = $('[data-search-input]', modal);
      const results = $('[data-search-results]', modal);
      if (input) input.value = '';
      if (results) {
        results.hidden = true;
        results.innerHTML = '';
      }
      if (this.controller) this.controller.abort();
      if (this.trigger && this.trigger.focus) this.trigger.focus({ preventScroll: true });
    },

    async query(term) {
      const modal = this.modal();
      const results = $('[data-search-results]', modal);
      if (!results) return;
      const q = term.trim();
      if (!q) {
        results.hidden = true;
        results.innerHTML = '';
        return;
      }
      if (this.controller) this.controller.abort();
      this.controller = new AbortController();
      try {
        const url = `${routes.predictiveSearch}?q=${encodeURIComponent(q)}&section_id=np-predictive-search&resources[type]=product&resources[limit]=8&resources[options][unavailable_products]=last`;
        const response = await fetch(url, { signal: this.controller.signal });
        if (!response.ok) throw new Error('search failed');
        const doc = parseHTML(await response.text());
        const inner = $('#np-predictive-search-results', doc);
        results.innerHTML = inner ? inner.innerHTML : '';
        results.hidden = false;
      } catch (e) {
        if (e.name !== 'AbortError') results.hidden = true;
      }
    },
  };

  /* ------------------------------------------------------------------ wishlist */

  const WISHLIST_KEY = 'np-wishlist';
  const wishlist = {
    get() {
      try {
        const list = JSON.parse(storage.get(WISHLIST_KEY) || '[]');
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    },
    set(list) {
      storage.set(WISHLIST_KEY, JSON.stringify(list));
      this.sync();
      document.dispatchEvent(new CustomEvent('np:wishlist', { detail: list }));
    },
    toggle(handle) {
      const list = this.get();
      const index = list.indexOf(handle);
      if (index === -1) list.push(handle);
      else list.splice(index, 1);
      this.set(list);
    },
    sync(root = document) {
      const list = this.get();
      $$('[data-wishlist-toggle]', root).forEach((button) => {
        const saved = list.includes(button.dataset.handle);
        button.setAttribute('aria-pressed', String(saved));
        button.setAttribute('aria-label', (saved ? button.dataset.labelRemove : button.dataset.labelAdd) || '');
      });
      $$('[data-wishlist-count]').forEach((badge) => {
        badge.textContent = list.length;
        badge.hidden = list.length === 0;
      });
    },
  };

  class NPWishlist extends HTMLElement {
    connectedCallback() {
      this.cards = new Map();
      this.onChange = () => this.render();
      document.addEventListener('np:wishlist', this.onChange);
      this.render();
    }

    disconnectedCallback() {
      document.removeEventListener('np:wishlist', this.onChange);
    }

    show(state) {
      $('[data-wishlist-loading]', this).hidden = state !== 'loading';
      $('[data-wishlist-empty]', this).hidden = state !== 'empty';
      $('[data-wishlist-filled]', this).hidden = state !== 'filled';
    }

    async fetchCard(handle) {
      if (this.cards.has(handle)) return this.cards.get(handle);
      try {
        const response = await fetch(`${this.dataset.productsBase}/${encodeURIComponent(handle)}?section_id=np-product-card-ajax`);
        if (!response.ok) return null;
        const doc = parseHTML(await response.text());
        const card = $('[data-product-card]', doc);
        if (!card) return null;
        this.cards.set(handle, card.outerHTML);
        return card.outerHTML;
      } catch (e) {
        return null;
      }
    }

    async render() {
      const grid = $('[data-wishlist-grid]', this);
      const list = wishlist.get();
      if (!list.length) {
        grid.innerHTML = '';
        this.show('empty');
        return;
      }
      const known = new Set($$('[data-product-card]', grid).map((el) => el.dataset.productHandle));
      const missing = list.filter((h) => !known.has(h));
      if (missing.length && !known.size) this.show('loading');
      const fetched = await Promise.all(missing.map((h) => this.fetchCard(h)));
      // drop cards that were un-hearted, append the new ones
      $$('[data-product-card]', grid).forEach((el) => {
        if (!list.includes(el.dataset.productHandle)) el.remove();
      });
      const gone = [];
      fetched.forEach((html, i) => {
        if (html) grid.insertAdjacentHTML('beforeend', html);
        else gone.push(missing[i]);
      });
      if (gone.length) {
        // products that no longer exist in the store
        storage.set(WISHLIST_KEY, JSON.stringify(list.filter((h) => !gone.includes(h))));
        wishlist.sync();
      }
      const count = $$('[data-product-card]', grid).length;
      if (!count) {
        this.show('empty');
        return;
      }
      $('[data-wishlist-count-label]', this).textContent = pluralText(this, count);
      this.show('filled');
      wishlist.sync(grid);
    }
  }

  /* ------------------------------------------------------------- product page */

  class NPProduct extends HTMLElement {
    connectedCallback() {
      const json = $('[data-variants]', this);
      this.variants = json ? JSON.parse(json.textContent) : [];
      this.sectionId = this.dataset.sectionId;
      this.url = this.dataset.productUrl;
      this.addEventListener('change', (event) => {
        if (event.target.matches('[data-option-index]')) this.onOptionChange();
      });
      this.addEventListener('input', (event) => {
        if (event.target.matches('input[name="quantity"]')) this.updateTotals();
      });
      this.addEventListener('click', (event) => {
        const thumb = event.target.closest('[data-gallery-thumb]');
        if (thumb) this.showMedia(thumb.dataset.mediaId);
        if (event.target.closest('[data-qty-minus],[data-qty-plus]')) requestAnimationFrame(() => this.updateTotals());
      });
      this.updateTotals();
    }

    selectedOptions() {
      return $$('[data-variant-picker] input[type="radio"]:checked', this)
        .sort((a, b) => Number(a.dataset.optionIndex) - Number(b.dataset.optionIndex))
        .map((input) => input.value);
    }

    currentVariant() {
      const options = this.selectedOptions();
      return this.variants.find((variant) => variant.options.every((value, i) => value === options[i])) || null;
    }

    async onOptionChange() {
      const variant = this.currentVariant();
      if (!variant) {
        $$('[data-add-button]', this).forEach((button) => {
          button.disabled = true;
          const label = $('[data-add-label]', button);
          if (label) label.textContent = strings.unavailable;
        });
        return;
      }
      const idInput = $('[data-variant-id]', this);
      if (idInput) idInput.value = variant.id;
      try {
        window.history.replaceState({}, '', `${window.location.pathname}?variant=${variant.id}`);
      } catch (e) {
        /* ignore */
      }
      if (variant.featured_media) this.showMedia(String(variant.featured_media.id));
      await this.refresh(variant.id);
    }

    async refresh(variantId) {
      const quantityInput = $('input[name="quantity"]', this);
      const quantity = quantityInput ? quantityInput.value : 1;
      const cartonsInput = $('[data-box-input]', this);
      const cartons = cartonsInput ? cartonsInput.value : 1;
      try {
        const response = await fetch(`${this.url}?variant=${variantId}&section_id=${this.sectionId}`);
        if (!response.ok) return;
        const doc = parseHTML(await response.text());
        ['weight', 'price', 'buy', 'notify', 'specs', 'sticky'].forEach((name) => {
          const live = $(`[data-swap="${name}"]`, this);
          const next = $(`[data-swap="${name}"]`, doc);
          if (!live || !next) return;
          live.innerHTML = next.innerHTML;
          if (next.dataset.unitPrice !== undefined) live.dataset.unitPrice = next.dataset.unitPrice;
          // the new variant may or may not have a wholesale price: take its B2B data as-is, including absence
          ['unitPriceRetail', 'unitPriceShop'].forEach((key) => {
            if (next.dataset[key] !== undefined) live.dataset[key] = next.dataset[key];
            else delete live.dataset[key];
          });
        });
        const freshBoxes = $('[data-box-input]', this);
        if (freshBoxes) {
          // cartons: keep the carton count (the new variant may have another carton size)
          freshBoxes.value = cartons;
          syncBoxQuantity(freshBoxes);
        } else {
          const freshQuantity = $('input[name="quantity"]', this);
          if (freshQuantity) freshQuantity.value = quantity;
        }
        if (window.Shopify && window.Shopify.PaymentButton && window.Shopify.PaymentButton.init) window.Shopify.PaymentButton.init();
        this.updateTotals();
      } catch (e) {
        /* keep the current markup; the form still posts the right variant id */
      }
    }

    showMedia(mediaId) {
      $$('[data-gallery-item]', this).forEach((item) => {
        item.hidden = item.dataset.mediaId !== String(mediaId);
      });
      $$('[data-gallery-thumb]', this).forEach((thumb) => {
        thumb.setAttribute('aria-current', String(thumb.dataset.mediaId === String(mediaId)));
      });
    }

    updateTotals() {
      const buy = $('[data-swap="buy"]', this);
      if (!buy) return;
      const useRetail = currentPriceView() === 'retail' && buy.dataset.unitPriceRetail !== undefined;
      let unit = Number(useRetail ? buy.dataset.unitPriceRetail : buy.dataset.unitPrice);
      if (!useRetail && buy.dataset.unitPriceShop !== undefined) {
        const converted = fromShopCents(buy.dataset.unitPriceShop);
        if (converted !== null) unit = converted;
      }
      if (!Number.isFinite(unit)) return;
      const input = $('input[name="quantity"]', this);
      const quantity = Math.max(1, parseInt(input && input.value, 10) || 1);
      const total = formatMoney(unit * quantity);
      $$('[data-add-total]', this).forEach((el) => (el.textContent = total));
      $$('[data-sticky-total]', this).forEach((el) => (el.textContent = total));
      // B2B cartons: "2 cartons x 36 pcs x 19 kr = 1 368 kr excl. VAT"
      $$('[data-box-summary]', this).forEach((el) => {
        const box = parseInt(el.dataset.boxSize, 10) || 1;
        const template = useRetail ? el.dataset.templateRetail : el.dataset.template;
        el.textContent = (template || '')
          .replace('%BOXES%', String(Math.max(1, Math.round(quantity / box))))
          .replace('%PCS%', String(box))
          .replace('%UNIT%', formatMoney(unit))
          .replace('%TOTAL%', total)
          .replace('%WEIGHT%', formatGrams((Number(el.dataset.pieceGrams) || 0) * quantity));
      });
    }
  }

  class NPRecommendations extends HTMLElement {
    connectedCallback() {
      if (this.dataset.loaded || !this.dataset.url) return;
      if (!('IntersectionObserver' in window)) {
        this.load();
        return;
      }
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            this.observer.disconnect();
            this.load();
          }
        },
        { rootMargin: '0px 0px 300px 0px' }
      );
      this.observer.observe(this);
    }

    async load() {
      this.dataset.loaded = '1';
      try {
        const response = await fetch(this.dataset.url);
        if (!response.ok) return;
        const doc = parseHTML(await response.text());
        const next = $('np-recommendations', doc);
        if (next && next.innerHTML.trim()) {
          this.innerHTML = next.innerHTML;
          wishlist.sync(this);
        }
      } catch (e) {
        /* recommendations are optional */
      }
    }
  }

  /* ------------------------------------------------------ small custom elements */

  class NPOriginMap extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', (event) => {
        const step = event.target.closest('[data-origin-step]');
        if (step) this.select(Number(step.dataset.originStep));
      });
    }

    select(index) {
      $$('[data-origin-step]', this).forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.originStep) === index)));
      $$('[data-origin-place]', this).forEach((place, i) => {
        place.classList.toggle('text-[var(--color-paprika-dark)]', i === index);
        place.classList.toggle('text-[var(--color-charcoal-soft)]', i !== index);
      });
      $$('[data-origin-detail]', this).forEach((detail) => {
        const active = Number(detail.dataset.originDetail) === index;
        if (active && detail.hidden) {
          detail.hidden = false;
          detail.style.animation = 'none';
          void detail.offsetHeight;
          detail.style.animation = '';
        } else if (!active) {
          detail.hidden = true;
        }
      });
    }
  }

  class NPTabs extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-tab]');
        if (tab) this.select(tab.dataset.tab);
      });
      this.names = $$('[data-tab]', this).map((tab) => tab.dataset.tab);
      const fromHash = () => {
        const name = window.location.hash.slice(1);
        return this.names.includes(name) ? name : null;
      };
      // deep links such as /pages/b2b#login open the matching tab
      const initial = fromHash();
      this.select(initial || this.dataset.default || this.names[0]);
      if (initial) requestAnimationFrame(() => this.scrollIntoView({ block: 'start' }));
      window.addEventListener('hashchange', () => {
        const name = fromHash();
        if (name) {
          this.select(name);
          this.scrollIntoView({ block: 'start' });
        }
      });
    }

    select(name) {
      $$('[data-tab]', this).forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
      $$('[data-panel]', this).forEach((panel) => {
        panel.hidden = panel.dataset.panel !== name;
      });
    }
  }

  class NPGiftBox extends HTMLElement {
    connectedCallback() {
      this.min = parseInt(this.dataset.min, 10) || 3;
      this.addEventListener('click', (event) => {
        const tile = event.target.closest('[data-gift-tile]');
        if (tile) {
          tile.setAttribute('aria-pressed', String(tile.getAttribute('aria-pressed') !== 'true'));
          this.update();
          return;
        }
        if (event.target.closest('[data-gift-add]')) this.addBox();
      });
      this.update();
    }

    selected() {
      return $$('[data-gift-tile][aria-pressed="true"]', this);
    }

    update() {
      const chosen = this.selected();
      const total = chosen.reduce((sum, tile) => sum + Number(tile.dataset.price), 0);
      $('[data-gift-count]', this).textContent = pluralText(this, chosen.length);
      $('[data-gift-hint]', this).textContent = chosen.length < this.min ? this.dataset.hint : `${this.dataset.labelTotal}: ${formatMoney(total)}`;
      $('[data-gift-add]', this).disabled = chosen.length < this.min;
    }

    async addBox() {
      const button = $('[data-gift-add]', this);
      const chosen = this.selected();
      if (chosen.length < this.min || button.dataset.busy) return;
      button.dataset.busy = '1';
      cart.clearError(this);
      try {
        await cart.add(chosen.map((tile) => ({ id: Number(tile.dataset.variantId), quantity: 1 })));
        const label = $('[data-gift-add-label]', button);
        const icon = $('[data-gift-add-icon]', button);
        const original = label.textContent;
        const originalIcon = icon.innerHTML;
        label.textContent = this.dataset.labelAdded;
        icon.innerHTML = CHECK_ICON;
        setTimeout(() => {
          label.textContent = original;
          icon.innerHTML = originalIcon;
        }, 2500);
      } catch (error) {
        cart.showError(this, error.message);
      } finally {
        delete button.dataset.busy;
      }
    }
  }

  /* ------------------------------------------------------------ B2B accounts */
  /* Client-side checks of the B2B forms - for the visitor's convenience only: the verification service validates every
     field again (lib/verify.mjs) and never trusts what the browser sends. The VAT rules mirror its lib/countries.mjs
     (a FORMAT check - whether the number is real is only known from EU VIES or the owner's manual check). */
  const B2B_VAT_RULES = {
    AT: ['AT', /^U\d{8}$/, 'ATU12345678'], BE: ['BE', /^[01]\d{9}$/, 'BE0123456789'], BG: ['BG', /^\d{9,10}$/, 'BG123456789'],
    CY: ['CY', /^\d{8}[A-Z]$/, 'CY12345678X'], CZ: ['CZ', /^\d{8,10}$/, 'CZ12345678'], DE: ['DE', /^\d{9}$/, 'DE123456789'],
    DK: ['DK', /^\d{8}$/, 'DK12345678'], EE: ['EE', /^\d{9}$/, 'EE123456789'], GR: ['EL', /^\d{9}$/, 'EL123456789'],
    ES: ['ES', /^[A-Z0-9]\d{7}[A-Z0-9]$/, 'ESB12345678'], FI: ['FI', /^\d{8}$/, 'FI12345678'], FR: ['FR', /^[A-HJ-NP-Z0-9]{2}\d{9}$/, 'FR12345678901'],
    HR: ['HR', /^\d{11}$/, 'HR12345678901'], HU: ['HU', /^\d{8}$/, 'HU12345678'], IE: ['IE', /^(\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/, 'IE1234567T'],
    IT: ['IT', /^\d{11}$/, 'IT12345678901'], LT: ['LT', /^(\d{9}|\d{12})$/, 'LT123456789'], LU: ['LU', /^\d{8}$/, 'LU12345678'],
    LV: ['LV', /^\d{11}$/, 'LV12345678901'], MT: ['MT', /^\d{8}$/, 'MT12345678'], NL: ['NL', /^\d{9}B\d{2}$/, 'NL123456789B01'],
    PL: ['PL', /^\d{10}$/, 'PL1234567890'], PT: ['PT', /^\d{9}$/, 'PT123456789'], RO: ['RO', /^\d{2,10}$/, 'RO12345678'],
    SE: ['SE', /^\d{10}01$/, 'SE123456789001'], SI: ['SI', /^\d{8}$/, 'SI12345678'], SK: ['SK', /^\d{10}$/, 'SK1234567890'],
    NO: ['NO', /^\d{9}(MVA)?$/, 'NO123456789MVA'], CH: ['CHE', /^\d{9}(MWST|TVA|IVA)?$/, 'CHE123456789'], GB: ['GB', /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, 'GB123456789'],
  };

  /* OIB = Croatian tax number and the Croatian VAT number: 11 digits, last one an ISO 7064 (MOD 11,10) check digit */
  function isValidOib(oib) {
    if (!/^\d{11}$/.test(oib)) return false;
    let a = 10;
    for (let i = 0; i < 10; i++) {
      a = (a + Number(oib[i])) % 10;
      if (a === 0) a = 10;
      a = (a * 2) % 11;
    }
    return (11 - a) % 10 === Number(oib[10]);
  }

  /* VAT number for the selected country, prefix optional -> { vat } or { error: 'required' | 'vat' | 'vat_country' } */
  function b2bVatFor(country, raw) {
    const rule = B2B_VAT_RULES[country];
    const clean = String(raw || '').toUpperCase().replace(/[\s.\-/]/g, '');
    if (!clean) return { error: 'required' };
    // a country without a known VAT format: its tax / VAT number as written (the owner checks it)
    if (!rule) return /^[A-Z0-9]{4,20}$/.test(clean) ? { vat: clean } : { error: 'vat' };
    const [prefix, re] = rule;
    let number = clean;
    if (clean.startsWith(prefix)) number = clean.slice(prefix.length);
    else if (country === 'GR' && clean.startsWith('GR')) number = clean.slice(2);
    else if (/^[A-Z]{2}/.test(clean) && !re.test(clean)) return { error: 'vat_country' };
    if (!re.test(number) || (country === 'HR' && !isValidOib(number))) return { error: 'vat' };
    return { vat: prefix + number };
  }

  const B2B_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const B2B_NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

  function b2bPasswordProblem(password, email) {
    if (!password) return 'required';
    if (password.length < 8 || password.length > 128) return 'password_length';
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'password_weak';
    const local = String(email || '').split('@')[0].toLowerCase();
    if (local.length >= 4 && password.toLowerCase().includes(local)) return 'password_weak';
    return '';
  }

  /* Registration fields (snippets/np-b2b-registration-fields.liquid, data-field="...") -> { values, errors }.
     Same message keys as the service's answers, so both show the same texts. */
  function checkB2bRegistration(root, withPassword) {
    const get = (field) => {
      const input = $(`[data-field="${field}"]`, root);
      return input ? String(input.value || '') : '';
    };
    const squash = (value) => value.replace(/\s+/g, ' ').trim();
    const values = {
      firstName: squash(get('firstName')),
      lastName: squash(get('lastName')),
      email: get('email').trim(),
      phone: get('phone').trim(),
      country: get('country'),
      street: squash(get('street')),
      zip: squash(get('zip')).toUpperCase(),
      city: squash(get('city')),
      vat: get('vat'),
    };
    const errors = {};
    ['firstName', 'lastName'].forEach((field) => {
      if (!values[field]) errors[field] = 'required';
      else if (!B2B_NAME_RE.test(values[field])) errors[field] = 'name';
    });
    if (!values.email) errors.email = 'required';
    else if (!B2B_EMAIL_RE.test(values.email)) errors.email = 'email';
    values.phone = b2bFullPhone(root, values.phone);
    const phoneDigits = values.phone.replace(/\D/g, '');
    if (!get('phone').trim()) errors.phone = 'required';
    else if (!/^\+?[\d\s()./-]+$/.test(values.phone) || phoneDigits.length < 6 || phoneDigits.length > 15) errors.phone = 'phone';
    const countrySelect = $('[data-country-select]', root);
    if (!values.country) errors.country = 'country';
    else if (countrySelect && !Array.from(countrySelect.options).some((option) => option.value && option.value === values.country)) errors.country = 'country';
    if (!values.street) errors.street = 'required';
    else if (!/\p{L}/u.test(values.street)) errors.street = 'address';
    if (!values.zip) errors.zip = 'required';
    else if (!/^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(values.zip)) errors.zip = 'zip';
    if (!values.city) errors.city = 'required';
    else if (!/\p{L}/u.test(values.city)) errors.city = 'address';
    if (values.country) {
      const vat = b2bVatFor(values.country, values.vat);
      if (vat.error) errors.vat = vat.error;
      else values.vat = vat.vat;
    } else if (!values.vat.trim()) errors.vat = 'required';
    if (withPassword) {
      values.password = get('password');
      values.passwordConfirm = get('passwordConfirm');
      const weak = b2bPasswordProblem(values.password, values.email);
      if (weak) errors.password = weak;
      if (!values.passwordConfirm) errors.passwordConfirm = 'required';
      else if (values.passwordConfirm !== values.password) errors.passwordConfirm = 'password_mismatch';
    }
    return { values, errors };
  }

  /* data-msg-* of snippets/np-b2b-messages.liquid by message key: 'password_mismatch' -> data-msg-password-mismatch */
  function b2bMessage(host, key) {
    const name = 'msg' + String(key || 'generic').split(/[_-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    return host.dataset[name] || host.dataset.msgGeneric || '';
  }

  /* Shows one message per field (data-error-for) and marks the input; returns the first invalid input */
  function showB2bErrors(host, root, errors, fields) {
    let first = null;
    fields.forEach((field) => {
      const target = $(`[data-error-for="${field}"]`, root);
      const input = $(`[data-field="${field}"]`, root);
      const text = errors[field] ? b2bMessage(host, errors[field]) : '';
      if (target) {
        target.textContent = text;
        target.hidden = !text;
      }
      if (input) {
        input.setAttribute('aria-invalid', text ? 'true' : 'false');
        if (text && !first) first = input;
      }
    });
    return first;
  }

  const B2B_REGISTRATION_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'country', 'street', 'zip', 'city', 'vat', 'password', 'passwordConfirm'];

  /* The phone as the service receives it: "+<dialling code> <number>" - the number without its national trunk 0
     (091 234 5678 in Croatia -> +385 91 234 5678; Italy, San Marino and the Vatican keep it). A number the visitor
     already wrote internationally (+.. or 00..) is taken as it is. */
  function b2bFullPhone(root, raw) {
    const number = String(raw || '').trim();
    if (!number) return '';
    if (number.startsWith('+')) return number;
    if (number.startsWith('00')) return '+' + number.slice(2);
    const dialSelect = $('[data-dial-select]', root);
    const option = dialSelect && dialSelect.selectedOptions[0];
    if (!option || !option.dataset.dial) return number;
    const national = ['IT', 'SM', 'VA'].includes(option.value) ? number : number.replace(/^0+/, '');
    return `+${option.dataset.dial} ${national}`;
  }

  /* "HR" -> 🇭🇷 (regional indicator symbols) */
  const flagOf = (code) => String(code).toUpperCase().replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)));

  /* Country and dialling-code dropdowns in the visitor's language (Liquid renders English names), alphabetical.
     The dialling code shows "🇭🇷 +385 Hrvatska" and follows the selected country until the visitor picks a code
     themselves; the VAT placeholder follows the country (e.g. DE123456789). */
  function setupB2bCountry(root) {
    const select = $('[data-country-select]', root);
    if (!select || select.dataset.ready) return;
    select.dataset.ready = '1';
    const dialSelect = $('[data-dial-select]', root);
    const locale = NP.locale || 'en';
    let names = null;
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' });
    } catch (e) {
      names = null; // no Intl.DisplayNames: the English names stay
    }
    const nameOf = (option) => (names && names.of(option.value)) || option.textContent;
    const sortOptions = (target, label) => {
      const options = Array.from(target.options).filter((option) => option.value);
      options.forEach((option) => {
        option.dataset.name = nameOf(option);
        option.textContent = label(option);
      });
      options.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name, locale)).forEach((option) => target.append(option));
    };
    sortOptions(select, (option) => option.dataset.name);
    if (dialSelect) sortOptions(dialSelect, (option) => `${flagOf(option.value)} +${option.dataset.dial} ${option.dataset.name}`);

    const vat = $('[data-vat-input]', root);
    const sync = () => {
      const rule = B2B_VAT_RULES[select.value];
      if (vat) vat.placeholder = rule ? rule[2] : '';
      if (dialSelect && !dialSelect.dataset.touched && select.value) dialSelect.value = select.value;
    };
    select.addEventListener('change', sync);
    if (dialSelect) {
      dialSelect.addEventListener('change', () => {
        dialSelect.dataset.touched = '1';
        showB2bErrors(root.closest('np-b2b-register, np-b2b-native') || root, root, {}, ['phone']);
      });
    }
    sync();
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try {
      data = await response.json();
    } catch (e) {
      /* not JSON */
    }
    return { response, data };
  }

  function setB2bBusy(button, label, icon, busy, labels) {
    button.disabled = busy;
    if (label) label.textContent = busy ? labels.busy : labels.idle;
    if (icon) {
      if (busy) {
        icon.dataset.icon = icon.innerHTML;
        icon.innerHTML = '<span class="np-spinner block"></span>';
      } else if (icon.dataset.icon) {
        icon.innerHTML = icon.dataset.icon;
      }
    }
  }

  /* B2B registration with the verification service: first/last name, e-mail, phone, country, company address, VAT
     number, password + confirmation. Shows: pending (waits for approval, confirmation e-mail sent), approved, or
     "already registered". The password is only ever sent to the service over HTTPS, never stored in the browser. */
  class NPB2BRegister extends HTMLElement {
    connectedCallback() {
      this.form = $('[data-b2b-form]', this);
      if (!this.form) return;
      setupB2bCountry(this.form);
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submit();
      });
      this.form.addEventListener('input', (event) => {
        const field = event.target.dataset && event.target.dataset.field;
        if (field) showB2bErrors(this, this.form, {}, [field]);
        this.showFormError('');
      });
      this.addEventListener('click', (event) => {
        if (!event.target.closest('[data-b2b-go-login]')) return;
        const tabs = this.closest('np-tabs');
        if (tabs && tabs.select) {
          event.preventDefault();
          tabs.select('login');
          const email = $('#b2b-login-email');
          if (email) email.focus();
        }
      });
    }

    showFormError(text) {
      const box = $('[data-b2b-error]', this);
      if (!box) return;
      box.textContent = text;
      box.hidden = !text;
    }

    async submit() {
      if (this.busy) return;
      const { values, errors } = checkB2bRegistration(this.form, true);
      const first = showB2bErrors(this, this.form, errors, B2B_REGISTRATION_FIELDS);
      if (first) {
        first.focus();
        return;
      }
      this.showFormError('');
      this.busy = true;
      const button = $('[data-b2b-submit]', this);
      const labels = { busy: this.dataset.labelVerifying, idle: this.dataset.labelSubmit };
      setB2bBusy(button, $('[data-b2b-submit-label]', this), $('[data-b2b-submit-icon]', this), true, labels);
      try {
        const website = String((this.form.elements.website && this.form.elements.website.value) || '');
        const { response, data } = await postJson(this.dataset.endpoint, Object.assign({ locale: NP.locale, website }, values));
        if (response.status === 400 && data.errors) {
          const firstServer = showB2bErrors(this, this.form, data.errors, B2B_REGISTRATION_FIELDS);
          if (firstServer) firstServer.focus();
          return;
        }
        if (data.status === 'exists' || ['approved', 'pending'].includes(data.status)) {
          this.form.hidden = true;
          $$('[data-b2b-result]', this).forEach((panel) => {
            panel.hidden = panel.dataset.b2bResult !== data.status;
          });
          return;
        }
        this.showFormError(b2bMessage(this, data.error === 'rate-limit' ? 'rate_limit' : 'generic'));
      } catch (e) {
        this.showFormError(b2bMessage(this, 'generic'));
      } finally {
        // the passwords never stay in the page longer than needed
        $$('input[type="password"]', this.form).forEach((input) => {
          if (this.form.hidden) input.value = '';
        });
        this.busy = false;
        setB2bBusy(button, $('[data-b2b-submit-label]', this), $('[data-b2b-submit-icon]', this), false, labels);
      }
    }
  }

  /* B2B registration WITHOUT a verification service (the default): the same field checks, then the form is posted to
     Shopify's own contact endpoint (no password - it would travel by e-mail). The request arrives in the store inbox
     and the owner approves the company by hand in the Shopify admin (add the customer tag). */
  class NPB2BNative extends HTMLElement {
    connectedCallback() {
      this.form = $('form', this);
      if (!this.form) return;
      this.form.noValidate = true; // translated messages of the theme instead of the browser's own
      setupB2bCountry(this.form);
      this.form.addEventListener('submit', (event) => {
        const { values, errors } = checkB2bRegistration(this.form, false);
        const first = showB2bErrors(this, this.form, errors, B2B_REGISTRATION_FIELDS);
        if (first) {
          event.preventDefault();
          first.focus();
          return;
        }
        // send the normalised values (VAT with prefix, no spaces; phone with its dialling code) and one name for
        // Shopify's contact form
        $('[data-field="vat"]', this.form).value = values.vat;
        $('[data-field="phone"]', this.form).value = values.phone;
        const name = $('[data-b2b-native-name]', this.form);
        if (name) name.value = `${values.firstName} ${values.lastName}`;
      });
      this.form.addEventListener('input', (event) => {
        const field = event.target.dataset && event.target.dataset.field;
        if (field) showB2bErrors(this, this.form, {}, [field]);
      });
    }
  }

  /* B2B company login: e-mail + password. The service answers with a signed session token (7 days, re-checked on every
     visit and ended by a password change, suspension or revocation), stored in this browser so <np-b2b-session> can
     show the logged-in view. "Forgot password" asks for a link to set a new one (always answers "sent"). */
  const B2B_SESSION_KEY = 'np-b2b-session';

  class NPB2BLogin extends HTMLElement {
    connectedCallback() {
      this.form = $('[data-b2b-login-form]', this);
      if (!this.form) return;
      this.forgotForm = $('[data-b2b-forgot-form]', this);
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submit();
      });
      this.form.addEventListener('input', (event) => {
        const field = event.target.dataset && event.target.dataset.field;
        if (field) showB2bErrors(this, this.form, {}, [field]);
        this.showFormError('');
      });
      const forgot = $('[data-b2b-forgot]', this);
      if (forgot) forgot.addEventListener('click', () => this.showForgot(true));
      const back = $('[data-b2b-back]', this);
      if (back) back.addEventListener('click', () => this.showForgot(false));
      if (this.forgotForm) {
        this.forgotForm.addEventListener('submit', (event) => {
          event.preventDefault();
          this.requestLink();
        });
      }
    }

    showForgot(open) {
      $('[data-login-panel]', this).hidden = open;
      $('[data-forgot-panel]', this).hidden = !open;
      if (open) {
        const email = $('[data-field="email"]', this.forgotForm);
        email.value = email.value || $('[data-field="email"]', this.form).value;
        $('[data-b2b-forgot-message]', this).hidden = true;
        email.focus();
      } else {
        $('[data-field="password"]', this.form).focus();
      }
    }

    showFormError(text) {
      const box = $('[data-b2b-login-error]', this);
      if (!box) return;
      box.textContent = text;
      box.hidden = !text;
    }

    async submit() {
      if (this.busy) return;
      const email = $('[data-field="email"]', this.form).value.trim();
      const password = $('[data-field="password"]', this.form).value;
      const errors = {};
      if (!email) errors.email = 'required';
      else if (!B2B_EMAIL_RE.test(email)) errors.email = 'email';
      if (!password) errors.password = 'required';
      const first = showB2bErrors(this, this.form, errors, ['email', 'password']);
      if (first) {
        first.focus();
        return;
      }
      this.showFormError('');
      this.busy = true;
      const button = $('[data-b2b-login-submit]', this);
      const labels = { busy: this.dataset.labelVerifying, idle: this.dataset.labelSubmit };
      setB2bBusy(button, $('[data-b2b-login-submit-label]', this), $('[data-b2b-login-submit-icon]', this), true, labels);
      try {
        const { data } = await postJson(this.dataset.endpoint, { email, password, locale: NP.locale });
        if (data.status === 'ok' && data.token) {
          storage.set(B2B_SESSION_KEY, JSON.stringify({ token: data.token, company: data.company || '' }));
          window.location.hash = '';
          window.location.reload(); // <np-b2b-session> picks the stored token up and shows the B2B shop panel
          return;
        }
        // invalid (wrong e-mail or password - never which of the two), pending, rejected, suspended, unverified
        const key = data.error === 'rate-limit' ? 'rate_limit' : ['invalid', 'pending', 'rejected', 'suspended', 'unverified'].includes(data.status) ? data.status : 'generic';
        this.showFormError(b2bMessage(this, key));
        $('[data-field="password"]', this.form).value = '';
      } catch (e) {
        this.showFormError(b2bMessage(this, 'generic'));
      } finally {
        this.busy = false;
        setB2bBusy(button, $('[data-b2b-login-submit-label]', this), $('[data-b2b-login-submit-icon]', this), false, labels);
      }
    }

    async requestLink() {
      if (this.busy) return;
      const input = $('[data-field="email"]', this.forgotForm);
      const email = input.value.trim();
      const error = !email ? 'required' : B2B_EMAIL_RE.test(email) ? '' : 'email';
      const errorBox = $('[data-b2b-forgot-error]', this);
      errorBox.hidden = true;
      if (showB2bErrors(this, this.forgotForm, error ? { email: error } : {}, ['email'])) {
        input.focus();
        return;
      }
      this.busy = true;
      const button = $('[data-b2b-forgot-submit]', this);
      button.disabled = true;
      try {
        const { data } = await postJson(this.dataset.passwordEndpoint, { email, locale: NP.locale });
        if (data.status === 'sent') $('[data-b2b-forgot-message]', this).hidden = false;
        else {
          errorBox.textContent = b2bMessage(this, data.error === 'rate-limit' ? 'rate_limit' : 'generic');
          errorBox.hidden = false;
        }
      } catch (e) {
        errorBox.textContent = b2bMessage(this, 'generic');
        errorBox.hidden = false;
      } finally {
        this.busy = false;
        button.disabled = false;
      }
    }
  }

  /* Links the service e-mails, finished on the B2B page: #password=<token> (set a new password) and #verify=<token>
     (confirm the e-mail address). The token is read and removed from the address bar at once, so it does not stay in
     the history or get shared along with the page URL. */
  class NPB2BAccountLinks extends HTMLElement {
    connectedCallback() {
      this.handle();
      // a link pasted into a tab that already shows the B2B page only changes the fragment - no page load
      window.addEventListener('hashchange', () => this.handle());
    }

    handle() {
      const match = window.location.hash.match(/^#(password|verify)=(.+)$/);
      if (!match) return;
      const [, kind, raw] = match;
      let token = '';
      try {
        token = decodeURIComponent(raw);
      } catch (e) {
        token = '';
      }
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (e) {
        /* old browser: the fragment stays, nothing else happens */
      }
      if (kind === 'verify') this.verify(token);
      else this.showPassword(token);
    }

    async verify(token) {
      let ok = false;
      try {
        const { data } = await postJson(this.dataset.verifyEndpoint, { token });
        ok = data.status === 'ok';
      } catch (e) {
        ok = false;
      }
      const panel = $(`[data-verify-result="${ok ? 'ok' : 'failed'}"]`, this);
      if (panel) panel.hidden = false;
    }

    showPassword(token) {
      const panel = $('[data-password-panel]', this);
      const form = $('[data-b2b-password-form]', this);
      if (!panel || !form) return;
      this.token = token; // the newest link wins
      panel.hidden = false;
      form.hidden = false;
      $('[data-b2b-password-done]', this).hidden = true;
      requestAnimationFrame(() => panel.scrollIntoView({ block: 'start' }));
      $('[data-field="password"]', form).focus();
      if (this.formReady) return;
      this.formReady = true;
      form.addEventListener('input', (event) => {
        const field = event.target.dataset && event.target.dataset.field;
        if (field) showB2bErrors(this, form, {}, [field]);
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (this.busy) return;
        const password = $('[data-field="password"]', form).value;
        const passwordConfirm = $('[data-field="passwordConfirm"]', form).value;
        const errors = {};
        const weak = b2bPasswordProblem(password, '');
        if (weak) errors.password = weak;
        if (!passwordConfirm) errors.passwordConfirm = 'required';
        else if (passwordConfirm !== password) errors.passwordConfirm = 'password_mismatch';
        const first = showB2bErrors(this, form, errors, ['password', 'passwordConfirm']);
        if (first) {
          first.focus();
          return;
        }
        const errorBox = $('[data-b2b-password-error]', this);
        errorBox.hidden = true;
        this.busy = true;
        const button = $('[data-b2b-password-submit]', this);
        button.disabled = true;
        try {
          const { data } = await postJson(this.dataset.resetEndpoint, { token: this.token, password, passwordConfirm });
          if (data.status === 'ok') {
            form.hidden = true;
            $('[data-b2b-password-done]', this).hidden = false;
            // straight to the login tab with the new password
            const tabs = $('np-tabs');
            if (tabs && tabs.select) tabs.select('login');
            storage.set(B2B_SESSION_KEY, ''); // any older session ended with the password change
          } else if (data.status === 'invalid' && data.errors) {
            const firstServer = showB2bErrors(this, form, data.errors, ['password', 'passwordConfirm']);
            if (firstServer) firstServer.focus();
          } else {
            errorBox.textContent = b2bMessage(this, data.status === 'link-invalid' ? 'link_invalid' : data.error === 'rate-limit' ? 'rate_limit' : 'generic');
            errorBox.hidden = false;
          }
        } catch (e) {
          errorBox.textContent = b2bMessage(this, 'generic');
          errorBox.hidden = false;
        } finally {
          this.busy = false;
          button.disabled = false;
          $$('input[type="password"]', form).forEach((input) => {
            input.value = '';
          });
        }
      });
    }
  }

  /* Shows the logged-in ("B2B shop") panel instead of the register/login tabs when a stored login is present, and
     re-checks it against the service in the background: a company the owner revokes loses the wholesale view again
     on its next visit without waiting for the 30-day token to expire. */
  class NPB2BSession extends HTMLElement {
    connectedCallback() {
      this.guest = $('[data-b2b-guest]', this);
      this.active = $('[data-b2b-active]', this);
      if (!this.guest || !this.active) return;
      const logoutButton = $('[data-b2b-logout]', this);
      if (logoutButton) logoutButton.addEventListener('click', () => this.logout());

      const stored = this.readSession();
      if (!stored) {
        this.showGuest();
        return;
      }
      this.showActive(stored.company); // optimistic: avoids a flash of the tabs while the background check runs
      this.verify(stored.token);
    }

    readSession() {
      let parsed;
      try {
        parsed = JSON.parse(storage.get(B2B_SESSION_KEY) || '');
      } catch (e) {
        return null;
      }
      return parsed && parsed.token ? parsed : null;
    }

    showGuest() {
      this.guest.hidden = false;
      this.active.hidden = true;
    }

    showActive(company) {
      this.guest.hidden = true;
      this.active.hidden = false;
      const text = $('[data-b2b-active-text]', this.active);
      if (text && this.dataset.activeTextTemplate) text.textContent = this.dataset.activeTextTemplate.replace('%COMPANY%', company || '');
    }

    logout() {
      storage.set(B2B_SESSION_KEY, '');
      this.showGuest();
    }

    async verify(token) {
      if (!this.dataset.endpoint) return; // no verification service configured: trust the cached session as-is
      try {
        const response = await fetch(this.dataset.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await response.json().catch(() => ({}));
        if (data.status === 'invalid') this.logout();
        else if (data.status === 'ok') this.showActive(data.company);
        // "error" (Shopify briefly unreachable): keep the optimistic view and try again on the next page load
      } catch (e) {
        /* network error: keep the optimistic view */
      }
    }
  }

  /* ------------------------------------------------------------ B2B price view */
  /* Lets an approved B2B customer (header toggle, only shown once real B2B pricing is active)
     switch every price on the site between the wholesale price (default) and the regular retail
     price, e.g. to see what an end customer would pay. Pure display preference, remembered in this
     browser - it never changes what Shopify actually charges (cart and checkout always show the
     real Shopify-computed price). A MutationObserver re-applies it to prices that appear later
     (product cards loaded via AJAX, quick view, search, collection re-renders, ...).
     Declared here, before customElements.define() below, because an already-upgraded <np-product>
     can call updateTotals() -> currentPriceView() synchronously the moment it is defined. */
  const PRICE_VIEW_KEY = 'np-price-view'; // 'b2b' (default) | 'retail'

  const currentPriceView = () => (storage.get(PRICE_VIEW_KEY) === 'retail' ? 'retail' : 'b2b');

  /* The B2B price list and minimum order are entered in the shop's currency (SEK). Liquid has no exchange
     rate, so for any other storefront currency the theme renders them as data-*-shop-cents and they are
     converted here with Shopify's own live rate. Returns null when the rate is unknown - callers then keep
     the server-rendered fallback (the retail price) instead of showing an unconverted number. */
  function fromShopCents(cents) {
    const amount = Number(cents);
    if (!Number.isFinite(amount)) return null;
    if (!NP.currency || NP.currency === NP.shopCurrency) return amount;
    const rate = Number(window.Shopify && window.Shopify.currency && window.Shopify.currency.rate);
    return rate > 0 ? Math.round(amount * rate) : null;
  }

  function applyPriceView(view, root = document) {
    $$('[data-np-price][data-b2b-price]', root).forEach((el) => {
      const strike = $('[data-price-strike]', el);
      const main = $('[data-price-main]', el);
      const badge = $('[data-price-badge]', el);
      if (!main) return;
      if (el.dataset.b2bShopCents !== undefined && !el.dataset.b2bText) {
        const cents = fromShopCents(el.dataset.b2bShopCents);
        if (cents === null) return; // no rate: the retail price stays, without the B2B badge
        el.dataset.b2bText = formatMoney(cents);
      }
      const retail = view === 'retail';
      main.textContent = retail ? el.dataset.retailText : el.dataset.b2bText;
      if (strike) strike.hidden = retail;
      if (badge) badge.hidden = retail;
    });
    $$('[data-price-view-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', String(view === 'retail'));
      button.textContent = view === 'retail' ? button.dataset.labelShowB2b : button.dataset.labelShowRetail;
    });
    $$('[data-swap="buy"][data-unit-price-retail]').forEach((buy) => {
      const productEl = buy.closest('np-product');
      if (productEl && productEl.updateTotals) productEl.updateTotals();
    });
    applyB2bMinimumGate();
  }

  /* The B2B minimum order (Theme settings > B2B / wholesale > "B2B minimum order value") only applies
     while viewing B2B prices: switched to "regular prices" there is no minimum. data-b2b-minimum-met
     carries the server's B2B-view verdict (rendered with the cart, via Section Rendering API on every
     add/change); this only decides whether that verdict is currently enforced. Called from
     applyPriceView() (toggle, initial load) and from cart.applySections() (after every cart change),
     since cart line items are not [data-np-price] elements the price MutationObserver would catch. */
  /* Wholesale value of the cart in its own currency, from np-b2b-cart-wholesale's two parts: price-list lines
     (shop currency, converted) + all other lines (already in the cart's currency). null without a rate. */
  function wholesaleCartCents(el) {
    const listed = fromShopCents(el.dataset.wholesaleListed);
    const other = Number(el.dataset.wholesaleOther);
    return listed === null || !Number.isFinite(other) ? null : listed + other;
  }

  /* Re-checks a minimum-order notice in the cart's own currency (see fromShopCents) and fills in its amounts */
  function syncB2bMinimum(el) {
    if (!NP.currency || NP.currency === NP.shopCurrency) return; // the server already compared like with like
    // a fixed amount for this currency (e.g. EUR:1000) is used as-is, the shop-currency amount is converted
    const minimum = el.dataset.minimumInCartCurrency === 'true' ? Number(el.dataset.minimumCents) : fromShopCents(el.dataset.minimumCents);
    const total = wholesaleCartCents(el);
    if (minimum === null || total === null) return; // no rate: keep the server's verdict
    const met = total >= minimum;
    el.dataset.minimumMet = String(met);
    $$('[data-minimum-state]', el).forEach((state) => {
      state.hidden = state.dataset.minimumState !== (met ? 'met' : 'not-met');
    });
    $$('[data-minimum-text]', el).forEach((text) => {
      text.textContent = (text.dataset.template || '')
        .replace('%MINIMUM%', formatMoney(minimum))
        .replace('%REMAINING%', formatMoney(Math.max(0, minimum - total)));
    });
  }

  /* B2B cart lines (snippets/np-b2b-cart-line.liquid): in a currency other than the shop's the wholesale breakdown
     is left empty by Liquid and filled in here with Shopify's live rate; hidden while viewing regular prices. */
  function syncB2bCartLines(retailView) {
    $$('[data-b2b-cart-line]').forEach((el) => {
      if (!el.textContent.trim()) {
        const unit = fromShopCents(el.dataset.unitShopCents);
        const quantity = Number(el.dataset.quantity) || 0;
        if (unit !== null) {
          el.textContent = (el.dataset.template || '')
            .replace('%CARTONS%', el.dataset.cartons || String(quantity))
            .replace('%PCS%', el.dataset.box || '')
            .replace('%UNIT%', formatMoney(unit))
            .replace('%TOTAL%', formatMoney(unit * quantity));
        }
      }
      el.hidden = retailView || !el.textContent.trim();
    });
    $$('[data-b2b-cart-weight]').forEach((el) => {
      el.hidden = retailView;
    });
  }

  /* Money in any currency: the storefront's own format for the cart currency, Intl otherwise (e.g. "100 €" pallet
     price in a SEK cart - the B2B checkout is then presented in EUR) */
  function formatMoneyIn(cents, currency) {
    if (!currency || currency === NP.currency) return formatMoney(cents);
    const amount = Number(cents) / 100;
    try {
      return new Intl.NumberFormat(NP.locale || 'sv', {
        style: 'currency',
        currency,
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (e) {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }

  /* Pallet price in the visitor's currency (B2B promotion: 100 EUR per pallet, converted at the verification service's
     daily ECB rate - the same cached rate its checkout charges with). Kept 30 minutes in this browser; if the service
     moved to a new rate meanwhile, the checkout answers with the new amount and it is stored here (rememberPalletPrice).
     { currency, cents, baseCurrency?, baseCents?, rateDate? } or null (not loaded / no service). */
  const PALLET_PRICE_KEY = 'np-pallet-price';
  const PALLET_PRICE_TTL_MS = 30 * 60 * 1000;
  const palletPriceState = { value: null, pending: null };

  function rememberPalletPrice(value) {
    palletPriceState.value = value;
    storage.set(PALLET_PRICE_KEY, JSON.stringify({ ...value, cartCurrency: NP.currency, at: Date.now() }));
    applyPalletPriceTexts();
  }

  function loadPalletPrice() {
    if (!NP.palletPriceUrl || !NP.currency) return Promise.resolve(null);
    if (palletPriceState.value) return Promise.resolve(palletPriceState.value);
    try {
      const saved = JSON.parse(storage.get(PALLET_PRICE_KEY) || 'null');
      if (saved && saved.cartCurrency === NP.currency && Date.now() - saved.at < PALLET_PRICE_TTL_MS) {
        palletPriceState.value = saved;
        applyPalletPriceTexts();
        return Promise.resolve(saved);
      }
    } catch (e) {
      /* unreadable: fetch again */
    }
    if (!palletPriceState.pending) {
      const url = `${NP.palletPriceUrl}?currency=${encodeURIComponent(NP.currency)}&shop=${encodeURIComponent(NP.shopCurrency || '')}`;
      palletPriceState.pending = fetch(url, { headers: { Accept: 'application/json' } })
        .then((response) => response.json())
        .then((data) => {
          if (data.status !== 'ok') return null;
          rememberPalletPrice({ currency: data.currency, cents: data.cents, baseCurrency: data.baseCurrency, baseCents: data.baseCents, rateDate: data.rateDate });
          applyB2bMinimumGate(); // re-renders the cart's pallet summary with the price
          return palletPriceState.value;
        })
        .catch(() => null)
        .finally(() => {
          palletPriceState.pending = null;
        });
    }
    return palletPriceState.pending;
  }

  /* Promotion texts (np-b2b-pallet-promo.liquid): "Svaka paleta samo %PRICE%!" in the visitor's currency */
  function applyPalletPriceTexts() {
    const price = palletPriceState.value;
    if (!price) return;
    const text = formatMoneyIn(price.cents, price.currency);
    $$('[data-pallet-price-template]').forEach((el) => {
      el.textContent = (el.dataset.palletPriceTemplate || '').replace(/%PRICE%/g, text);
    });
  }

  /* B2B pallet shipping (snippets/np-b2b-pallet-summary.liquid): cart lines + pieces per carton -> cartons -> pallets
     -> pallets x price per pallet, with window.NPPallets (assets/np-pallets.js, B2B customers only). The B2B checkout
     of the verification service runs the same file and charges exactly this as the draft order's shipping line.
     Lines of the same variant are merged first, like the service does. null when the script is missing. */
  function palletQuote(el) {
    if (!el || !window.NPPallets) return null;
    try {
      const raw = JSON.parse(($('[data-b2b-pallet-lines]', el) || {}).textContent || '[]');
      const merged = new Map();
      raw.forEach((line) => {
        const key = String(line.variant);
        const current = merged.get(key) || { quantity: 0, box: line.box };
        current.quantity += Number(line.quantity) || 0;
        merged.set(key, current);
      });
      const P = window.NPPallets;
      // the service's price for this currency (already converted) - until it has loaded, the configured price with a
      // "pending" mark (the numbers that depend on it are then not shown yet)
      const price = palletPriceState.value;
      const settings = {
        boxDimensions: P.parseBoxDimensions(el.dataset.boxDimensions),
        pallet: P.parsePallet(el.dataset.palletSize),
        palletPrices: price ? new Map([[price.currency, price.cents]]) : P.parsePalletPrices(el.dataset.palletPrices),
      };
      const quote = P.quote(Array.from(merged.values()), settings, NP.currency, NP.shopCurrency);
      quote.pricePending = !price && Boolean(NP.palletPriceUrl);
      if (price && price.baseCurrency) quote.basePrice = { currency: price.baseCurrency, cents: price.baseCents, date: price.rateDate };
      return quote;
    } catch (e) {
      if (window.console) console.error('[Nature Pick] pallet calculation failed:', e);
      return null;
    }
  }

  const palletCountText = (el, n) => pluralText(el, n);
  const palletFormula = (el, quote) =>
    (el.dataset.formula || '%COUNT% × %PRICE% = %TOTAL%')
      .replace('%COUNT%', String(quote.pallets))
      .replace('%PRICE%', formatMoneyIn(quote.pricePerPalletCents, quote.currency))
      .replace('%TOTAL%', formatMoneyIn(quote.shippingCents, quote.currency));

  /* Recalculated on load and after every cart change (cart.applySections -> applyB2bMinimumGate). While a B2B
     customer views regular prices the checkout is Shopify's ordinary one, so the pallet parts are hidden then. */
  function syncB2bPallets(retailView) {
    applyPalletPriceTexts(); // a re-rendered cart brings the promotion back with Liquid's price
    $$('[data-b2b-pallets]').forEach((el) => {
      const quote = palletQuote(el);
      el.npPalletQuote = quote;
      if (!quote) return;
      $('[data-pallet-count]', el).textContent = String(quote.pallets);
      $('[data-pallet-price]', el).textContent = quote.pricePending ? '…' : formatMoneyIn(quote.pricePerPalletCents, quote.currency);
      $('[data-pallet-shipping]', el).textContent = quote.pricePending ? '…' : formatMoneyIn(quote.shippingCents, quote.currency);
      const base = $('[data-pallet-base]', el);
      if (base) {
        base.hidden = !quote.basePrice;
        if (quote.basePrice) {
          const date = quote.basePrice.date ? new Date(`${quote.basePrice.date}T12:00:00Z`).toLocaleDateString(NP.locale || undefined) : '';
          base.textContent = (base.dataset.template || '').replace('%BASE%', formatMoneyIn(quote.basePrice.cents, quote.basePrice.currency)).replace('%DATE%', date);
        }
      }
      const cartons = $('[data-pallet-cartons]', el);
      if (cartons) cartons.textContent = `${palletCountText(el, quote.pallets)} · ${(cartons.dataset.template || '').replace('%CARTONS%', String(quote.cartons))}`;
      const estimated = $('[data-pallet-estimated]', el);
      if (estimated) estimated.hidden = !quote.estimated;
    });
    $$('[data-b2b-pallet-only]').forEach((el) => {
      el.hidden = retailView;
    });
    $$('[data-b2b-retail-only]').forEach((el) => {
      el.hidden = !retailView;
    });
  }

  /* "Continue with the purchase?" before every checkout (np-cart.liquid, [data-checkout-confirm]). Resolves true for
     YES, false for NO / Escape / backdrop. With `pallets` (B2B pallet checkout) it also shows pallets and shipping. */
  const checkoutConfirm = {
    resolve: null,
    lastFocus: null,
    el: () => $('[data-checkout-confirm]'),
    ask({ quote, source, changed } = {}) {
      const modal = this.el();
      if (!modal) return Promise.resolve(true); // no modal on this page: behave as before
      const block = $('[data-confirm-pallets]', modal);
      const yes = $('[data-confirm-answer="yes"]', modal);
      const withPallets = Boolean(block && quote);
      if (block) {
        block.hidden = !withPallets;
        if (withPallets) {
          $('[data-confirm-pallet-count]', block).textContent = palletCountText(source, quote.pallets);
          $('[data-confirm-shipping]', block).textContent = palletFormula(source, quote);
          $('[data-confirm-changed]', block).hidden = !changed;
        }
      }
      yes.textContent = withPallets ? yes.dataset.labelPallets : yes.dataset.labelSimple;
      if (this.resolve) this.resolve(false);
      this.lastFocus = document.activeElement;
      modal.hidden = false;
      lockScroll(true);
      requestAnimationFrame(() => yes.focus({ preventScroll: true }));
      return new Promise((resolve) => {
        this.resolve = resolve;
      });
    },
    answer(yes) {
      const modal = this.el();
      if (!modal || modal.hidden) return;
      modal.hidden = true;
      lockScroll(false);
      const resolve = this.resolve;
      this.resolve = null;
      if (!yes && this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true });
      if (resolve) resolve(yes);
    },
  };

  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('[data-confirm-answer]');
    if (button && button.closest('[data-checkout-confirm]')) checkoutConfirm.answer(button.dataset.confirmAnswer === 'yes');
  });

  /* Retail (B2C) checkout, and a B2B customer's ordinary checkout: the cart form's normal submit to Shopify's checkout,
     only asked for confirmation first. YES submits exactly as before (same button, so name="checkout" is sent). */
  document.addEventListener('submit', async (event) => {
    const form = event.target;
    const button = event.submitter;
    if (!button || !button.matches || !button.matches('[data-checkout-confirm-trigger]')) return;
    if (form.dataset.checkoutConfirmed) {
      delete form.dataset.checkoutConfirmed;
      return;
    }
    event.preventDefault();
    if (await checkoutConfirm.ask()) {
      form.dataset.checkoutConfirmed = '1';
      if (typeof form.requestSubmit === 'function') form.requestSubmit(button);
      else {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = button.name;
        hidden.value = button.value || '';
        form.append(hidden);
        form.submit();
      }
    }
  });

  function applyB2bMinimumGate() {
    const retailView = currentPriceView() === 'retail';
    syncB2bCartLines(retailView);
    syncB2bPallets(retailView);
    $$('[data-b2b-minimum-order]').forEach((el) => {
      syncB2bMinimum(el);
      el.hidden = retailView;
    });
    $$('[data-b2b-wholesale-total]').forEach((el) => {
      const value = $('[data-b2b-wholesale-total-value]', el);
      if (value && !value.textContent.trim()) {
        const cents = wholesaleCartCents(el);
        if (cents !== null) value.textContent = formatMoney(cents);
      }
      el.hidden = retailView || !(value && value.textContent.trim());
    });
    $$('[data-checkout-button][data-b2b-minimum-met]').forEach((button) => {
      const page = button.closest('[data-cart-page]');
      const notice = page && $('[data-b2b-minimum-order]', page);
      if (notice) button.dataset.b2bMinimumMet = notice.dataset.minimumMet;
      const blocked = !retailView && button.dataset.b2bMinimumMet === 'false';
      button.disabled = blocked;
      button.setAttribute('aria-disabled', String(blocked));
      button.classList.toggle('pointer-events-none', blocked);
      button.classList.toggle('opacity-50', blocked);
    });
  }

  function setPriceView(view) {
    storage.set(PRICE_VIEW_KEY, view);
    applyPriceView(view);
  }

  /* B2B checkout at wholesale prices (cart page, only rendered for a B2B customer when the verification service is
     configured): instead of Shopify's normal checkout, the cart goes to the service, which creates a draft order with
     the price-list prices for the signed-in company and answers with that order's Shopify checkout URL. Needs the
     company's e-mail + password sign-in from the B2B page (the token <np-b2b-session> keeps). Switched to "regular prices"
     the button is an ordinary checkout again.
     Before the order is created the company confirms "continue with the purchase?" with its pallets and pallet shipping.
     The service counts the pallets again with the same code and only creates the order when the count matches the
     confirmed one; otherwise (cart changed meanwhile, script missing) it answers with its numbers and the company
     confirms those - so the shipping shown here is always the shipping Shopify's checkout charges. */
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-checkout-button][data-b2b-checkout]');
    if (!button || currentPriceView() === 'retail') return;
    event.preventDefault();
    if (button.dataset.busy) return;

    const message = $('[data-b2b-checkout-message]', button.closest('[data-cart-page]') || document);
    const show = (text, link) => {
      if (!message) return;
      message.textContent = text || '';
      if (link) {
        const a = document.createElement('a');
        a.href = link;
        a.className = 'ml-1 font-semibold underline';
        a.textContent = '→';
        message.append(a);
      }
      message.hidden = !text;
    };

    let session = null;
    try {
      session = JSON.parse(storage.get(B2B_SESSION_KEY) || 'null');
    } catch (e) {
      session = null;
    }
    if (!session || !session.token) {
      show(button.dataset.msgLogin, `${button.dataset.b2bPageUrl}#login`);
      return;
    }

    const page = button.closest('[data-cart-page]') || document;
    const palletEl = $('[data-b2b-pallets]', page);
    await loadPalletPrice();
    let quote = palletQuote(palletEl);
    if (quote && quote.pricePending) quote = null; // no price from the service: it answers with its numbers below
    show('');
    if (!(await checkoutConfirm.ask({ quote, source: palletEl }))) return; // NO: stay on the cart

    const label = button.textContent;
    button.dataset.busy = '1';
    button.disabled = true;
    button.textContent = button.dataset.labelBusy || label;
    try {
      const cart = await fetch(NP.routes.cartJson, { headers: { Accept: 'application/json' } }).then((r) => r.json());
      const lines = cart.items.map((item) => ({ variantId: String(item.variant_id), quantity: item.quantity }));
      let data = {};
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(button.dataset.b2bCheckout, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            token: session.token,
            lines,
            currency: NP.currency,
            locale: NP.locale,
            expectedPallets: quote ? quote.pallets : -1,
            expectedPalletPriceCents: quote ? quote.pricePerPalletCents : -1,
            expectedShippingCurrency: quote ? quote.currency : '',
          }),
        });
        data = await response.json().catch(() => ({}));
        if (data.status !== 'pallets') break;
        // the service counted differently than the page showed: confirm its numbers (they are what will be charged)
        quote = { pallets: data.pallets, cartons: data.cartons, pricePerPalletCents: data.pricePerPalletCents, shippingCents: data.shippingCents, currency: data.shippingCurrency };
        rememberPalletPrice({ currency: data.shippingCurrency, cents: data.pricePerPalletCents, baseCurrency: data.baseCurrency, baseCents: data.baseCents, rateDate: data.rateDate });
        applyB2bMinimumGate();
        if (!(await checkoutConfirm.ask({ quote, source: palletEl, changed: true }))) {
          data = { status: 'cancelled' };
          break;
        }
      }
      if (data.status === 'ok' && data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.status === 'session') {
        storage.set(B2B_SESSION_KEY, ''); // expired or revoked: sign in again on the B2B page
        show(button.dataset.msgLogin, `${button.dataset.b2bPageUrl}#login`);
      } else if (data.status === 'minimum') show(button.dataset.msgMinimum);
      else if (data.status === 'unavailable') show(button.dataset.msgUnavailable);
      else if (data.status === 'cartons') show(button.dataset.msgCartons);
      else if (data.status !== 'cancelled') show(button.dataset.msgError);
    } catch (e) {
      show(button.dataset.msgError);
    }
    delete button.dataset.busy;
    button.textContent = label;
    applyB2bMinimumGate(); // restores the disabled state the minimum-order gate wants
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyPriceView(currentPriceView()));
  } else {
    applyPriceView(currentPriceView());
  }

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('[data-np-price][data-b2b-price]') || node.querySelector?.('[data-np-price][data-b2b-price]')) {
          applyPriceView(currentPriceView());
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-price-view-toggle]');
    if (!toggle) return;
    setPriceView(currentPriceView() === 'retail' ? 'b2b' : 'retail');
  });

  if (!customElements.get('np-b2b-native')) customElements.define('np-b2b-native', NPB2BNative);
  if (!customElements.get('np-b2b-register')) customElements.define('np-b2b-register', NPB2BRegister);
  if (!customElements.get('np-b2b-login')) customElements.define('np-b2b-login', NPB2BLogin);
  if (!customElements.get('np-b2b-session')) customElements.define('np-b2b-session', NPB2BSession);
  if (!customElements.get('np-b2b-account-links')) customElements.define('np-b2b-account-links', NPB2BAccountLinks);
  if (!customElements.get('np-wishlist')) customElements.define('np-wishlist', NPWishlist);
  if (!customElements.get('np-product')) customElements.define('np-product', NPProduct);
  if (!customElements.get('np-recommendations')) customElements.define('np-recommendations', NPRecommendations);
  if (!customElements.get('np-origin-map')) customElements.define('np-origin-map', NPOriginMap);
  if (!customElements.get('np-tabs')) customElements.define('np-tabs', NPTabs);
  if (!customElements.get('np-gift-box')) customElements.define('np-gift-box', NPGiftBox);

  /* -------------------------------------------------------------- cookie banner */

  const COOKIE_KEY = 'naturepick-cookie-consent';

  function applyConsent(value) {
    const granted = value === 'accepted';
    const setConsent = () => {
      if (window.Shopify && window.Shopify.customerPrivacy && typeof window.Shopify.customerPrivacy.setTrackingConsent === 'function') {
        window.Shopify.customerPrivacy.setTrackingConsent({ analytics: granted, marketing: granted, preferences: granted, sale_of_data: granted }, () => {});
      }
    };
    if (window.Shopify && window.Shopify.customerPrivacy) {
      setConsent();
    } else if (window.Shopify && typeof window.Shopify.loadFeatures === 'function') {
      window.Shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], (error) => {
        if (!error) setConsent();
      });
    }
  }

  function initCookieBanner() {
    const banner = $('[data-cookie-banner]');
    if (!banner) return;
    if (!storage.get(COOKIE_KEY)) banner.hidden = false;
    banner.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-cookie-choice]');
      if (!choice) return;
      const value = choice.dataset.cookieChoice;
      storage.set(COOKIE_KEY, value);
      banner.hidden = true;
      applyConsent(value);
    });
  }

  /* ---------------------------------------------------------- address book (account) */

  function initAddresses() {
    const container = $('[data-customer-addresses]');
    if (!container || container.dataset.ready) return;
    container.dataset.ready = '1';

    if (window.Shopify && window.Shopify.CountryProvinceSelector) {
      if ($('#AddressCountryNew')) new window.Shopify.CountryProvinceSelector('AddressCountryNew', 'AddressProvinceNew', { hideElement: 'AddressProvinceContainerNew' });
      $$('[data-address-country-select]', container).forEach((select) => {
        const id = select.dataset.formId;
        new window.Shopify.CountryProvinceSelector(`AddressCountry_${id}`, `AddressProvince_${id}`, { hideElement: `AddressProvinceContainer_${id}` });
      });
    }

    const toggle = (button, open) => {
      const expanded = open === undefined ? button.getAttribute('aria-expanded') === 'false' : open;
      button.setAttribute('aria-expanded', String(expanded));
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      if (panel) panel.hidden = !expanded;
    };

    container.addEventListener('click', (event) => {
      const expander = event.target.closest('button[aria-expanded]');
      if (expander) toggle(expander);
      const reset = event.target.closest('button[type="reset"]');
      if (reset) {
        const wrapper = reset.closest('[data-address]');
        const opener = wrapper && $('button[aria-expanded]', wrapper);
        if (opener) toggle(opener, false);
      }
      const del = event.target.closest('button[data-confirm-message]');
      if (del && window.confirm(del.getAttribute('data-confirm-message')) && window.Shopify && window.Shopify.postLink) {
        window.Shopify.postLink(del.dataset.target, { parameters: { _method: 'delete' } });
      }
    });
  }

  /* ------------------------------------------------------------------- QR code */

  function initQR() {
    const targets = $$('[data-qr]:not([data-qr-done])');
    if (!targets.length || typeof window.qrcode !== 'function') return false;
    targets.forEach((el) => {
      const qr = window.qrcode(0, 'M');
      qr.addData(el.dataset.url);
      qr.make();
      const count = qr.getModuleCount();
      const margin = 1;
      const size = count + margin * 2;
      let path = '';
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
        }
      }
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
      el.dataset.qrDone = '1';
    });
    return true;
  }

  /* --------------------------------------------------------------- global events */

  function setDropdown(dropdown, open) {
    dropdown.classList.toggle('is-open', open);
    const toggleButton = $('[data-dropdown-toggle]', dropdown);
    if (toggleButton) toggleButton.setAttribute('aria-expanded', String(open));
  }

  function setMobileMenu(open) {
    const menu = $('#np-mobile-menu');
    const button = $('[data-menu-toggle]');
    if (!menu || !button) return;
    const isOpen = !menu.hidden;
    if (isOpen === open) return;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    $('[data-menu-icon-open]', button).hidden = open;
    $('[data-menu-icon-close]', button).hidden = !open;
    lockScroll(open);
  }

  document.addEventListener('click', (event) => {
    const target = event.target;

    const changeButton = target.closest('[data-cart-change]');
    if (changeButton) {
      event.preventDefault();
      const scope = changeButton.closest('[data-cart-page], [data-cart-drawer]');
      cart.clearError(scope);
      cart.change(changeButton.dataset.lineKey, Number(changeButton.dataset.quantity)).catch((error) => cart.showError(scope, error.message));
      return;
    }

    const cartOpen = target.closest('[data-cart-open]');
    if (cartOpen) {
      event.preventDefault();
      cart.open(cartOpen);
      return;
    }
    if (target.closest('[data-cart-close]')) {
      cart.close();
      return;
    }

    if (target.closest('[data-toast-close]')) {
      toast.hide();
      return;
    }

    const wishlistToggle = target.closest('[data-wishlist-toggle]');
    if (wishlistToggle) {
      event.preventDefault();
      wishlist.toggle(wishlistToggle.dataset.handle);
      return;
    }

    const quickView = target.closest('[data-quick-view]');
    if (quickView) {
      event.preventDefault();
      openQuickView(quickView.dataset.productUrl, quickView);
      return;
    }
    if (target.closest('[data-quick-view-close]')) {
      closeQuickView();
      return;
    }

    const searchOpen = target.closest('[data-search-open]');
    if (searchOpen) {
      event.preventDefault();
      search.open(searchOpen);
      return;
    }
    if (target.closest('[data-search-close]')) {
      search.close();
      return;
    }

    const minus = target.closest('[data-qty-minus]');
    const plus = target.closest('[data-qty-plus]');
    if (minus || plus) {
      const wrapper = target.closest('[data-quantity]');
      const boxInput = $('[data-box-input]', wrapper);
      if (boxInput) {
        // B2B cartons: the visible field counts cartons, the hidden quantity field follows (syncBoxQuantity)
        boxInput.value = Math.max(1, (parseInt(boxInput.value, 10) || 1) + (plus ? 1 : -1));
        syncBoxQuantity(boxInput);
        return;
      }
      const input = $('input[name="quantity"]', wrapper);
      const min = parseInt(input.min, 10) || 1;
      const step = parseInt(input.step, 10) || 1;
      const next = (parseInt(input.value, 10) || min) + (plus ? step : -step);
      input.value = Math.max(min, next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    const dropdownToggle = target.closest('[data-dropdown-toggle]');
    if (dropdownToggle) {
      const dropdown = dropdownToggle.closest('.np-dropdown');
      const willOpen = !dropdown.classList.contains('is-open');
      $$('.np-dropdown.is-open').forEach((d) => setDropdown(d, false));
      setDropdown(dropdown, willOpen);
      return;
    }
    $$('.np-dropdown.is-open').forEach((d) => {
      if (!d.contains(target)) setDropdown(d, false);
    });

    const menuToggle = target.closest('[data-menu-toggle]');
    if (menuToggle) {
      setMobileMenu($('#np-mobile-menu').hidden);
      return;
    }

    const quickContactToggle = target.closest('[data-quick-contact-toggle]');
    if (quickContactToggle) {
      const widget = quickContactToggle.closest('[data-quick-contact]');
      const panel = $('[data-quick-contact-panel]', widget);
      const open = panel.hidden;
      panel.hidden = !open;
      quickContactToggle.setAttribute('aria-expanded', String(open));
      quickContactToggle.setAttribute('aria-label', open ? quickContactToggle.dataset.labelClose : quickContactToggle.dataset.labelOpen);
      $('[data-icon-open]', quickContactToggle).hidden = open;
      $('[data-icon-close]', quickContactToggle).hidden = !open;
      return;
    }
    const widgetOpen = $('[data-quick-contact-panel]:not([hidden])');
    if (widgetOpen && !target.closest('[data-quick-contact]')) {
      const widget = widgetOpen.closest('[data-quick-contact]');
      widgetOpen.hidden = true;
      const button = $('[data-quick-contact-toggle]', widget);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', button.dataset.labelOpen);
      $('[data-icon-open]', button).hidden = false;
      $('[data-icon-close]', button).hidden = true;
    }

    const recoverToggle = target.closest('[data-toggle-recover]');
    if (recoverToggle) {
      const login = $('[data-login-panel]');
      const recover = $('[data-recover-panel]');
      const showRecover = recover.hidden;
      recover.hidden = !showRecover;
      login.hidden = showRecover;
      return;
    }

    const copyLink = target.closest('[data-copy-link]');
    if (copyLink && navigator.clipboard) {
      navigator.clipboard.writeText(copyLink.dataset.copyLink).then(() => {
        const original = copyLink.innerHTML;
        copyLink.innerHTML = `${CHECK_ICON} ${escapeHtml(strings.linkCopied)}`;
        setTimeout(() => (copyLink.innerHTML = original), 2000);
      });
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest && event.target.closest('form[data-ajax-cart]');
    if (form) {
      event.preventDefault();
      handleAjaxForm(form);
    }
  });

  document.addEventListener('change', (event) => {
    const auto = event.target.closest && event.target.closest('[data-autosubmit]');
    if (auto && auto.form) {
      if (typeof auto.form.requestSubmit === 'function') auto.form.requestSubmit();
      else auto.form.submit();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches && event.target.matches('[data-search-input]')) debouncedSearch(event.target.value);
  });
  const debouncedSearch = debounce((value) => search.query(value), 250);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const openDropdown = $('.np-dropdown.is-open');
      if (openDropdown) setDropdown(openDropdown, false);
      const drawer = $('[data-cart-drawer]');
      if (drawer && drawer.dataset.open === 'true') cart.close();
      const quick = $('[data-quick-view-modal]');
      if (quick && !quick.hidden) closeQuickView();
      const searchModal = search.modal();
      if (searchModal && !searchModal.hidden) search.close();
      const menu = $('#np-mobile-menu');
      if (menu && !menu.hidden) setMobileMenu(false);
      checkoutConfirm.answer(false);
      toast.hide();
    }
    if (event.key === 'Tab') {
      const drawer = $('[data-cart-drawer][data-open="true"] [data-cart-panel]');
      if (drawer) trapFocus(drawer, event);
      const quick = $('[data-quick-view-modal]:not([hidden]) [role="dialog"]');
      if (quick) trapFocus(quick, event);
      const searchDialog = $('[data-search-modal]:not([hidden]) [role="dialog"]');
      if (searchDialog) trapFocus(searchDialog, event);
      const confirmDialog = $('[data-checkout-confirm]:not([hidden]) [data-confirm-dialog]');
      if (confirmDialog) trapFocus(confirmDialog, event);
    }
  });

  // Opening the mobile menu on a wider screen would leave the page scroll locked
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) setMobileMenu(false);
  });

  // Back/forward cache: refresh anything that depends on the cart or the wishlist
  window.addEventListener('pageshow', (event) => {
    wishlist.sync();
    if (event.persisted) {
      fetch(routes.cartJson, { headers: { Accept: 'application/json' } })
        .then((response) => response.json())
        .then((current) => cart.setCount(current.item_count))
        .catch(() => {});
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === WISHLIST_KEY) {
      wishlist.sync();
      document.dispatchEvent(new CustomEvent('np:wishlist'));
    }
  });

  /* --------------------------------------------------------------------- start */

  // one failing initialiser must never stop the others (or leave the page half hidden)
  const attempt = (label, fn) => {
    try {
      fn();
    } catch (error) {
      if (window.console) console.error('[Nature Pick] ' + label + ' failed:', error);
    }
  };

  function init() {
    attempt('reveal', () => initReveal());
    // tells the safety net in the page head that the script is running
    document.documentElement.setAttribute('data-np-ready', '1');
    attempt('wishlist', () => wishlist.sync());
    attempt('pallet price', () => loadPalletPrice());
    attempt('cookie banner', () => initCookieBanner());
    attempt('addresses', () => initAddresses());
    attempt('qr code', () => {
      if (!initQR()) window.addEventListener('load', initQR);
    });
    attempt('password recovery', () => {
      if (window.location.hash === '#recover') {
        const login = $('[data-login-panel]');
        const recover = $('[data-recover-panel]');
        if (login && recover) {
          login.hidden = true;
          recover.hidden = false;
        }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Theme editor: re-run the initialisers for sections that are added or changed
  document.addEventListener('shopify:section:load', (event) => {
    initReveal(event.target);
    wishlist.sync(event.target);
    initAddresses();
    initQR();
  });
})();
