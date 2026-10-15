# Product

<!-- impeccable:product-schema 1 -->

> Written by `/impeccable init` from the owner's brief and the repository, without an interview round (the owner asked
> to proceed without questions). Facts marked *(inferred)* come from the code or the live store, not from the owner.

## Platform

web

## Users

- **Retail shoppers in Sweden** (and EU markets via Shopify Markets) buying spices, dried fruit and vegetables, nuts
  and teas for their own kitchen or as gifts. Mostly on phones *(inferred)*.
- **Business customers (B2B)**: shops, cafés, restaurants and other HoReCa buyers who register their company, wait
  for approval, sign in and order whole cartons at wholesale prices, with a minimum order and pallet shipping. They
  re-order known products quickly (Quick Order collection) and need to know at every step exactly what they pay.

## Product Purpose

Nature Pick (NP Market AB, Sweden) sells natural spices, dried fruit and vegetables, nuts and teas online, to consumers
and to businesses. Success: a shopper finds a product, trusts its quality and buys without confusion; a business
re-orders in minutes and never doubts which price applies.

## Positioning

A direct importer with its own origin story (default origin Uzbekistan, origin page with QR codes on packaging) and a
real wholesale channel in the same shop: the same products for a home kitchen and, by the carton, for a restaurant.

## Operating Context

- Shopify Online Store 2.0 theme (custom Liquid sections `np-*`, Tailwind-compiled `assets/naturepick.css`,
  hand-written `assets/np-price.css`, `assets/naturepick.js`), synced with GitHub `noapaska11-cell/nature-pick`.
- Languages live: Swedish (default) and English. Currency/country through Shopify Markets.
- B2B approval, sign-in and checkout run through a separate verification service (Netlify) that creates draft orders
  at price-list prices; the price list, carton sizes, minimum order and pallet settings live in Theme settings.
- Apps on the storefront: Judge.me (reviews), Kaching Bundles, Profit Pumper, Shopify Forms, PreOrder Globo, GemPages.

## Capabilities and Constraints

- Cart drawer + cart page, quick view, predictive search, wishlist, gift box builder, newsletter, FAQ, origin pages,
  B2B registration / sign-in / quote, HoReCa products for approved businesses only, pre-orders with deposit.
- B2B: whole cartons only, minimum order (EUR 1000 / SEK 11000), pallet shipping promotion, prices excl. VAT.
- **Redesign scope set by the owner:** visual only. Product texts, names, descriptions, prices, images, navigation,
  categories, links, functionality (cart, checkout, sign-in, B2B registration, Quick Order, language/currency,
  wishlist), apps and their settings, and SEO (titles, meta, URLs) must not change. New labels only through locale
  files (sv + en).
- Checkout is Shopify-hosted and cannot be styled from the theme.

## Brand Commitments

- Name and logo: Nature Pick (`assets/np-logo.webp`).
- Brand colours taken from the original store and kept on purpose by the owner: deep green `#2f4a33`, gold `#e9a824` /
  `#f5b82e`, cream `#f6f1e7`, brown `#5a3a2e`, light green `#b8cbb4` (Theme settings → Colors).
- Owner's brief for the look: premium, recognisable, a serious natural-food brand; warm, natural, high quality, lots
  of space, clear hierarchy; very easy to use so no customer is ever confused; smooth, polished motion.

## Evidence on Hand

- Real products, prices, photos and descriptions come live from Shopify; product photography is not professional
  *(inferred, owner's earlier audit)*.
- Real ratings only through Judge.me metafields. The homepage testimonials section is switched off because its quotes
  were placeholders - never present invented reviews, customer counts or awards.

## Product Principles

1. The price a customer pays is always the most obvious number, labelled, with its VAT status.
2. Calm, warm and generous beats busy: the products and their origin carry the brand, not decoration.
3. Every shopper - retail or business, phone or desktop, Swedish or English - completes their task without guessing.
4. Change the look, never the behaviour or the content.

## Accessibility & Inclusion

No specific standard was stated *(inferred target: WCAG 2.2 AA contrast and keyboard access, reduced-motion support)*.
