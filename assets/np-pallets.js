/*
 * Nature Pick - B2B pallet calculation (cart -> cartons -> pallets -> pallet shipping).
 *
 * ONE source, two copies that must stay byte-identical (the service's test suite compares them):
 *   theme:   assets/np-pallets.js                      (browser: window.NPPallets, B2B customers only)
 *   service: b2b-verify-service/lib/pallets.cjs        (Node: require / import - the draft order's shipping line)
 * so the pallet count a company sees in the cart is exactly the one its Shopify checkout charges.
 *
 * Cartons: the pieces per carton come from the price list (SKU:PRICE:BOX:GRAMS, the existing source of truth - not
 * decided here); cartons = ceil(quantity / BOX). Carton dimensions per BOX value come from Theme settings > B2B >
 * "Carton dimensions" (BOX:LxWxH in cm, "*" = any other carton size).
 *
 * Pallets: a real 3D packing, not a volume estimate. Cartons stand upright and may be turned 90 degrees. They are
 * packed in horizontal layers on the pallet footprint (a layer is as high as its tallest carton; different carton
 * types may share a layer), then the layers are stacked up to the maximum load height:
 *   1. per carton type the densest layer pattern (guillotine search over all "normal" cut positions, both
 *      orientations, e.g. 5 cartons of 42x32 on 120x80 instead of the naive 4);
 *   2. full layers of one type, then the leftover cartons of every type go - tallest first - into free space of
 *      layers that are at least as high (maximal-rectangles placement), otherwise into new layers;
 *   3. layers are stacked into as few pallets as possible (exact search over the layer heights for normal orders,
 *      first-fit-decreasing for very large ones).
 * Two variants (leftovers into existing layers or not) are computed and the one with fewer pallets wins.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NPPallets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_BOX_DIMENSIONS = '36:40x30x18\n30:40x25x19.5\n20:42x32x19.5\n60:42x32x14\n*:42x32x19.5';
  var DEFAULT_PALLET = '120x80x160';
  var DEFAULT_PALLET_PRICES = 'EUR:100';
  // a SKU sold per piece (no carton size in the price list) is counted in "*" cartons of this many pieces
  var LOOSE_PIECES_PER_BOX = 20;
  // all dimensions are handled on a half-centimetre grid (integers), so 19.5 cm is exact
  var GRID = 2;
  var EXACT_STACKING_STATES = 20000;

  var toGrid = function (cm) {
    return Math.round(cm * GRID);
  };
  var toCm = function (units) {
    return units / GRID;
  };

  /* ------------------------------------------------------------------ settings */

  // "40x30x18", "40 × 30 × 18", "40*30*19,5" -> { l, w, h } in cm, or null
  function parseDims(text) {
    var parts = String(text || '')
      .replace(/,/g, '.')
      .split(/[x×*]/i)
      .map(function (s) {
        return Number(String(s).trim());
      });
    if (parts.length !== 3 || !parts.every(function (n) { return Number.isFinite(n) && n > 0; })) return null;
    return { l: parts[0], w: parts[1], h: parts[2] };
  }

  // Theme setting "Carton dimensions": one line per carton size, BOX:LxWxH, "*" for every other size.
  // Blank -> the defaults (36/30/20/60 + "*").
  function parseBoxDimensions(text) {
    var source = String(text || '').trim() ? String(text) : DEFAULT_BOX_DIMENSIONS;
    var byCapacity = new Map();
    var fallback = null;
    source.split(/\r?\n/).forEach(function (line) {
      var index = line.indexOf(':');
      if (index < 0) return;
      var key = line.slice(0, index).trim();
      var dims = parseDims(line.slice(index + 1));
      if (!dims) return;
      if (key === '*') fallback = dims;
      else if (/^\d+$/.test(key) && Number(key) > 0) byCapacity.set(Number(key), dims);
    });
    return { byCapacity: byCapacity, fallback: fallback };
  }

  // Theme setting "Pallet": LxWxMAXHEIGHT in cm (load height, cartons only)
  function parsePallet(text) {
    return parseDims(text) || parseDims(DEFAULT_PALLET);
  }

  // Theme setting "Shipping price per pallet": CURRENCY:AMOUNT per line -> Map(CURRENCY -> cents)
  function parsePalletPrices(text) {
    var source = String(text || '').trim() ? String(text) : DEFAULT_PALLET_PRICES;
    var map = new Map();
    source.split(/\r?\n/).forEach(function (line) {
      var parts = line.split(':').map(function (s) { return (s || '').trim(); });
      var cents = Math.round(Number(String(parts[1] || '').replace(',', '.')) * 100);
      if (/^[A-Za-z]{3}$/.test(parts[0]) && parts[1] && Number.isFinite(cents) && cents >= 0) map.set(parts[0].toUpperCase(), cents);
    });
    return map;
  }

  // The pallet price in the currency the customer shops in:
  //   1. a fixed line for the cart's currency (e.g. SEK:1150) wins;
  //   2. otherwise the first line is the base price (EUR:100) and `convert(cents, from, to)` (the service's daily
  //      exchange rate) turns it into the cart's currency, e.g. 100 EUR -> 1 120 SEK;
  //   3. without a rate: the shop currency's line, else the base price in its own currency.
  // The B2B draft order is presented in the returned currency, so cart and checkout show the same amount.
  function palletPriceFor(prices, cartCurrency, shopCurrency, convert) {
    var cart = String(cartCurrency || '').toUpperCase();
    var shop = String(shopCurrency || '').toUpperCase();
    if (prices.has(cart)) return { currency: cart, cents: prices.get(cart) };
    var first = prices.entries().next();
    if (first.done) return null;
    var base = { currency: first.value[0], cents: first.value[1] };
    if (cart && typeof convert === 'function') {
      var converted = convert(base.cents, base.currency, cart);
      if (Number.isFinite(converted) && converted > 0) return { currency: cart, cents: Math.round(converted), base: base };
    }
    if (prices.has(shop)) return { currency: shop, cents: prices.get(shop) };
    return base;
  }

  /* -------------------------------------------------------------------- cartons */

  // lines: [{ quantity, box }] (box = pieces per carton from the price list, 0/1/empty = sold per piece)
  // -> carton types with their counts; `estimated` = some carton size had no dimensions of its own ("*" used)
  function cartonsForLines(lines, boxDimensions) {
    var dims = boxDimensions || parseBoxDimensions('');
    var types = new Map();
    var estimated = false;
    var missing = false;
    (lines || []).forEach(function (line) {
      var quantity = Math.max(0, Math.floor(Number(line && line.quantity) || 0));
      if (!quantity) return;
      var box = Math.floor(Number(line.box) || 0);
      var perCarton = box > 1 ? box : LOOSE_PIECES_PER_BOX;
      var size = box > 1 ? dims.byCapacity.get(box) : null;
      if (!size) {
        size = dims.fallback;
        estimated = true;
      }
      if (!size) {
        missing = true;
        return;
      }
      var cartons = Math.ceil(quantity / perCarton);
      var key = size.l + 'x' + size.w + 'x' + size.h;
      var type = types.get(key);
      if (!type) {
        type = { key: key, l: size.l, w: size.w, h: size.h, count: 0, capacities: [] };
        types.set(key, type);
      }
      type.count += cartons;
      if (type.capacities.indexOf(box > 1 ? box : 1) < 0) type.capacities.push(box > 1 ? box : 1);
    });
    var list = Array.from(types.values());
    return {
      types: list,
      total: list.reduce(function (sum, t) { return sum + t.count; }, 0),
      estimated: estimated,
      missing: missing,
    };
  }

  /* ------------------------------------------------ densest layer of one carton */

  // all positions a*i + b*j <= limit (the only cut positions a guillotine pattern needs)
  function normalPositions(limit, a, b) {
    var set = new Set();
    for (var i = 0; i * a <= limit; i++) for (var j = 0; i * a + j * b <= limit; j++) set.add(i * a + j * b);
    return Array.from(set).sort(function (x, y) { return x - y; });
  }

  var layerCache = new Map();

  // Densest guillotine pattern of identical a x b rectangles (either orientation) on an X x Y area, grid units.
  // -> { count, rects: [{ x, y, l, w }] }
  function bestLayer(X, Y, a, b) {
    var cacheKey = [X, Y, a, b].join(',');
    if (layerCache.has(cacheKey)) return layerCache.get(cacheKey);
    var nx = normalPositions(X, a, b);
    var ny = normalPositions(Y, a, b);
    var down = function (list, v) {
      var best = 0;
      for (var i = 0; i < list.length && list[i] <= v; i++) best = list[i];
      return best;
    };
    var memo = new Map();

    function solve(x, y) {
      x = down(nx, x);
      y = down(ny, y);
      var key = x * 100000 + y;
      if (memo.has(key)) return memo.get(key);
      var straight = Math.floor(x / a) * Math.floor(y / b);
      var turned = Math.floor(x / b) * Math.floor(y / a);
      var best = straight >= turned ? { count: straight, kind: 'grid', turned: false } : { count: turned, kind: 'grid', turned: true };
      memo.set(key, best); // provisional, guards against cycles
      for (var i = 0; i < nx.length && nx[i] <= x / 2; i++) {
        var cx = nx[i];
        if (!cx) continue;
        var n1 = solve(cx, y).count + solve(x - cx, y).count;
        if (n1 > best.count) best = { count: n1, kind: 'v', at: cx };
      }
      for (var j = 0; j < ny.length && ny[j] <= y / 2; j++) {
        var cy = ny[j];
        if (!cy) continue;
        var n2 = solve(x, cy).count + solve(x, y - cy).count;
        if (n2 > best.count) best = { count: n2, kind: 'h', at: cy };
      }
      memo.set(key, best);
      return best;
    }

    function build(x0, y0, x, y, out) {
      var node = solve(x, y);
      if (!node.count) return;
      if (node.kind === 'grid') {
        var l = node.turned ? b : a;
        var w = node.turned ? a : b;
        for (var i = 0; (i + 1) * l <= x; i++) for (var j = 0; (j + 1) * w <= y; j++) out.push({ x: x0 + i * l, y: y0 + j * w, l: l, w: w });
      } else if (node.kind === 'v') {
        build(x0, y0, node.at, y, out);
        build(x0 + node.at, y0, x - node.at, y, out);
      } else {
        build(x0, y0, x, node.at, out);
        build(x0, y0 + node.at, x, y - node.at, out);
      }
    }

    var rects = [];
    build(0, 0, X, Y, rects);
    // fill order: column by column from one side, so a partial layer leaves one compact free area
    rects.sort(function (p, q) { return p.x - q.x || p.y - q.y; });
    var result = { count: rects.length, rects: rects };
    layerCache.set(cacheKey, result);
    return result;
  }

  /* ------------------------------------------- free space of a layer (max rects) */

  function overlaps(p, q) {
    return p.x < q.x + q.l && q.x < p.x + p.l && p.y < q.y + q.w && q.y < p.y + p.w;
  }
  function contains(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.l <= outer.x + outer.l && inner.y + inner.w <= outer.y + outer.w;
  }

  function occupy(free, used) {
    var next = [];
    free.forEach(function (f) {
      if (!overlaps(f, used)) {
        next.push(f);
        return;
      }
      if (used.x > f.x) next.push({ x: f.x, y: f.y, l: used.x - f.x, w: f.w });
      if (used.x + used.l < f.x + f.l) next.push({ x: used.x + used.l, y: f.y, l: f.x + f.l - used.x - used.l, w: f.w });
      if (used.y > f.y) next.push({ x: f.x, y: f.y, l: f.l, w: used.y - f.y });
      if (used.y + used.w < f.y + f.w) next.push({ x: f.x, y: used.y + used.w, l: f.l, w: f.y + f.w - used.y - used.w });
    });
    return next.filter(function (r, i) {
      if (r.l <= 0 || r.w <= 0) return false;
      for (var k = 0; k < next.length; k++) {
        if (k !== i && contains(next[k], r) && !(contains(r, next[k]) && k > i)) return false;
      }
      return true;
    });
  }

  function newLayer(X, Y) {
    return { height: 0, boxes: [], free: [{ x: 0, y: 0, l: X, w: Y }] };
  }

  function putBox(layer, type, rect) {
    layer.boxes.push({ key: type.key, x: rect.x, y: rect.y, l: rect.l, w: rect.w, h: type.gh });
    layer.height = Math.max(layer.height, type.gh);
    layer.free = occupy(layer.free, rect);
  }

  // best-short-side-fit into the layer's free space, both orientations; false when the carton does not fit
  function tryPlace(layer, type) {
    var best = null;
    layer.free.forEach(function (f) {
      [[type.gl, type.gw], [type.gw, type.gl]].forEach(function (o) {
        if (o[0] > f.l || o[1] > f.w) return;
        var shortSide = Math.min(f.l - o[0], f.w - o[1]);
        var longSide = Math.max(f.l - o[0], f.w - o[1]);
        if (!best || shortSide < best.s || (shortSide === best.s && longSide < best.t)) best = { s: shortSide, t: longSide, rect: { x: f.x, y: f.y, l: o[0], w: o[1] } };
      });
    });
    if (!best) return false;
    putBox(layer, type, best.rect);
    return true;
  }

  /* ------------------------------------------------------------ layers of cartons */

  function buildLayers(types, X, Y, fillExisting) {
    var layers = [];
    var ordered = types.slice().sort(function (p, q) {
      return q.gh - p.gh || q.gl * q.gw - p.gl * p.gw;
    });
    ordered.forEach(function (type) {
      var pattern = bestLayer(X, Y, type.gl, type.gw);
      var left = type.count;
      var full = Math.floor(left / pattern.count);
      var addPatternLayer = function (n) {
        var layer = newLayer(X, Y);
        for (var i = 0; i < n; i++) putBox(layer, type, pattern.rects[i]);
        layers.push(layer);
      };
      for (var f = 0; f < full; f++) addPatternLayer(pattern.count);
      left -= full * pattern.count;
      if (!left) return;
      if (fillExisting) {
        // tallest types came first, so every existing layer is at least as high: closest height first
        var candidates = layers
          .filter(function (layer) { return layer.height >= type.gh && layer.free.length; })
          .sort(function (p, q) { return p.height - q.height; });
        for (var c = 0; c < candidates.length && left > 0; c++) {
          while (left > 0 && tryPlace(candidates[c], type)) left--;
        }
      }
      while (left > 0) {
        var n = Math.min(left, pattern.count);
        addPatternLayer(n);
        left -= n;
      }
    });
    return layers;
  }

  /* ------------------------------------------------------- stacking layers (1D) */

  // Fewest stacks of height <= H: exact search over the distinct layer heights when the state space is small (normal
  // orders), first-fit decreasing otherwise. -> array of stacks, each an array of layer indexes
  function stackLayers(heights, H) {
    if (!heights.length) return [];
    var distinct = Array.from(new Set(heights)).sort(function (a, b) { return b - a; });
    var counts = distinct.map(function (h) {
      return heights.filter(function (x) { return x === h; }).length;
    });
    var states = counts.reduce(function (p, c) { return p * (c + 1); }, 1);
    var plan = states <= EXACT_STACKING_STATES ? exactStacks(distinct, counts, H) : null;
    var byHeight = new Map();
    heights.forEach(function (h, index) {
      if (!byHeight.has(h)) byHeight.set(h, []);
      byHeight.get(h).push(index);
    });
    if (plan) {
      return plan.map(function (pattern) {
        var stack = [];
        pattern.forEach(function (k, i) {
          for (var n = 0; n < k; n++) stack.push(byHeight.get(distinct[i]).pop());
        });
        return stack;
      });
    }
    var order = heights.map(function (h, i) { return i; }).sort(function (p, q) { return heights[q] - heights[p]; });
    var stacks = [];
    order.forEach(function (index) {
      var target = null;
      for (var s = 0; s < stacks.length; s++) {
        if (stacks[s].used + heights[index] <= H) {
          target = stacks[s];
          break;
        }
      }
      if (!target) {
        target = { used: 0, layers: [] };
        stacks.push(target);
      }
      target.used += heights[index];
      target.layers.push(index);
    });
    return stacks.map(function (s) { return s.layers; });
  }

  function exactStacks(sizes, counts, H) {
    var memo = new Map();
    function patterns(rest) {
      // every maximal combination that fits one stack
      var out = [];
      var current = sizes.map(function () { return 0; });
      (function walk(i, room) {
        if (i === sizes.length) {
          var maximal = sizes.every(function (s, k) { return current[k] === rest[k] || s > room; });
          if (maximal && current.some(function (n) { return n > 0; })) out.push(current.slice());
          return;
        }
        for (var n = Math.min(rest[i], Math.floor(room / sizes[i])); n >= 0; n--) {
          current[i] = n;
          walk(i + 1, room - n * sizes[i]);
        }
        current[i] = 0;
      })(0, H);
      return out;
    }
    function solve(rest) {
      if (rest.every(function (n) { return n === 0; })) return [];
      var key = rest.join(',');
      if (memo.has(key)) return memo.get(key);
      var best = null;
      patterns(rest).forEach(function (p) {
        var sub = solve(rest.map(function (n, k) { return n - p[k]; }));
        if (sub && (!best || sub.length + 1 < best.length)) best = [p].concat(sub);
      });
      memo.set(key, best);
      return best;
    }
    return solve(counts.slice());
  }

  /* ------------------------------------------------------------------- pallets */

  // lines: [{ quantity, box }]; options: { boxDimensions, pallet } (parsed settings, defaults when omitted)
  // -> { pallets, cartons, boxTypes, plan: [{ height, layers: [{ height, boxes: [{ key, x, y, l, w, h }] }] }],
  //      lowerBound, estimated, unpackable }   (all plan measures in cm)
  function packPallets(lines, options) {
    options = options || {};
    var pallet = options.pallet || parsePallet('');
    var cartons = cartonsForLines(lines, options.boxDimensions || parseBoxDimensions(''));
    var X = toGrid(pallet.l);
    var Y = toGrid(pallet.w);
    var H = toGrid(pallet.h);
    var unpackable = [];
    var types = [];
    cartons.types.forEach(function (t) {
      var type = { key: t.key, count: t.count, gl: toGrid(t.l), gw: toGrid(t.w), gh: toGrid(t.h) };
      if (type.gh > H || !bestLayer(X, Y, type.gl, type.gw).count) unpackable.push(t.key);
      else types.push(type);
    });

    var best = null;
    [true, false].forEach(function (fillExisting) {
      var layers = buildLayers(types, X, Y, fillExisting);
      var stacks = stackLayers(layers.map(function (l) { return l.height; }), H);
      var used = stacks.reduce(function (sum, s) {
        return sum + s.reduce(function (a, i) { return a + layers[i].height; }, 0);
      }, 0);
      if (!best || stacks.length < best.stacks.length || (stacks.length === best.stacks.length && used < best.used)) best = { layers: layers, stacks: stacks, used: used };
    });

    var plan = best.stacks.map(function (stack) {
      var layers = stack
        .map(function (i) { return best.layers[i]; })
        .sort(function (p, q) { return q.height - p.height; });
      return {
        height: toCm(layers.reduce(function (a, l) { return a + l.height; }, 0)),
        layers: layers.map(function (layer) {
          return {
            height: toCm(layer.height),
            boxes: layer.boxes.map(function (b) {
              return { key: b.key, x: toCm(b.x), y: toCm(b.y), l: toCm(b.l), w: toCm(b.w), h: toCm(b.h) };
            }),
          };
        }),
      };
    });

    var boxVolume = types.reduce(function (sum, t) { return sum + t.gl * t.gw * t.gh * t.count; }, 0);
    return {
      pallets: plan.length + unpackable.length,
      cartons: cartons.total,
      boxTypes: cartons.types.map(function (t) {
        return { key: t.key, l: t.l, w: t.w, h: t.h, count: t.count, capacities: t.capacities };
      }),
      plan: plan,
      lowerBound: Math.ceil(boxVolume / (X * Y * H)),
      estimated: cartons.estimated,
      unpackable: unpackable,
    };
  }

  // Everything the cart and the checkout need: pallets and the pallet shipping price in the charged currency
  // (convert: optional exchange-rate function, see palletPriceFor)
  function quote(lines, settings, cartCurrency, shopCurrency, convert) {
    settings = settings || {};
    var result = packPallets(lines, { boxDimensions: settings.boxDimensions, pallet: settings.pallet });
    var price = palletPriceFor(settings.palletPrices || parsePalletPrices(''), cartCurrency, shopCurrency, convert);
    result.currency = price ? price.currency : null;
    result.basePrice = price && price.base ? price.base : null;
    result.pricePerPalletCents = price ? price.cents : 0;
    result.shippingCents = price ? price.cents * result.pallets : 0;
    return result;
  }

  // Test helper: every carton inside the footprint, no two cartons of a layer overlapping, every pallet within the
  // load height, and exactly the requested number of cartons per type. Returns a list of problems (empty = valid).
  function validatePlan(result, pallet) {
    pallet = pallet || parsePallet('');
    var problems = [];
    var seen = new Map();
    result.plan.forEach(function (p, pi) {
      if (p.height > pallet.h + 1e-9) problems.push('pallet ' + pi + ' is ' + p.height + ' cm high');
      var sum = p.layers.reduce(function (a, l) { return a + l.height; }, 0);
      if (Math.abs(sum - p.height) > 1e-9) problems.push('pallet ' + pi + ' height mismatch');
      p.layers.forEach(function (layer, li) {
        layer.boxes.forEach(function (b, bi) {
          seen.set(b.key, (seen.get(b.key) || 0) + 1);
          if (b.x < 0 || b.y < 0 || b.x + b.l > pallet.l + 1e-9 || b.y + b.w > pallet.w + 1e-9) problems.push('box outside pallet ' + pi + '/' + li);
          if (b.h > layer.height + 1e-9) problems.push('box taller than its layer ' + pi + '/' + li);
          for (var k = bi + 1; k < layer.boxes.length; k++) if (overlaps(b, layer.boxes[k])) problems.push('overlap in pallet ' + pi + ' layer ' + li);
        });
      });
    });
    result.boxTypes.forEach(function (t) {
      if (result.unpackable.indexOf(t.key) < 0 && (seen.get(t.key) || 0) !== t.count) problems.push(t.key + ': ' + (seen.get(t.key) || 0) + ' of ' + t.count + ' cartons packed');
    });
    return problems;
  }

  return {
    DEFAULT_BOX_DIMENSIONS: DEFAULT_BOX_DIMENSIONS,
    DEFAULT_PALLET: DEFAULT_PALLET,
    DEFAULT_PALLET_PRICES: DEFAULT_PALLET_PRICES,
    LOOSE_PIECES_PER_BOX: LOOSE_PIECES_PER_BOX,
    parseDims: parseDims,
    parseBoxDimensions: parseBoxDimensions,
    parsePallet: parsePallet,
    parsePalletPrices: parsePalletPrices,
    palletPriceFor: palletPriceFor,
    cartonsForLines: cartonsForLines,
    bestLayer: function (l, w, pallet) {
      pallet = pallet || parsePallet('');
      var r = bestLayer(toGrid(pallet.l), toGrid(pallet.w), toGrid(l), toGrid(w));
      return { count: r.count, rects: r.rects.map(function (q) { return { x: toCm(q.x), y: toCm(q.y), l: toCm(q.l), w: toCm(q.w) }; }) };
    },
    packPallets: packPallets,
    quote: quote,
    validatePlan: validatePlan,
  };
});
