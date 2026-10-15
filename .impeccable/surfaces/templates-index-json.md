---
version: 1
slug: "templates-index-json"
primary_target: "templates/index.json"
related_targets: ["templates/collection.json","templates/product.json","templates/cart.json","templates/page.b2b.json"]
---

# Storefront (homepage, collections, product, cart, B2B)

Scope: the whole naturepick.se storefront look - homepage (Persuade) leading; collection, Quick Order, product, cart
drawer, cart page and B2B page (Operate) inherit the same world. Visual-only redesign: copy, navigation, links,
functionality, apps and SEO stay exactly as they are; new labels only through sv/en locales.

Audience: Swedish (and EU) home cooks buying spices, nuts, dried fruit and tea; business buyers re-ordering cartons.
Action: add to cart from cards and product pages; B2B: sign in, order cartons, always see the price they pay.
Proof on hand: real Fergana Valley / Uzbekistan origin, real products and packshots, Judge.me ratings. Never invent
reviews, awards or counts.
Constraints: Shopify theme; markup comes from Liquid sections; the compiled Tailwind file is frozen, so the world is
laid as a hand-written layer (assets/np-design.css) over existing hooks; Fraunces/Manrope are the brand's self-hosted
faces (no new font files).

Unattended run: the owner asked to proceed without questions; the assigned direction was built without a decision
round, code-led (no image generation on this machine).

## Direction contract

THESIS: The shop is glazed like a Rishtan dish from the Fergana Valley, where its products come from: one clay body,
one deep green glaze, ochre brushwork. It refuses the category default of white rounded cards on beige, gold pill
buttons, icon trust rows and soft drop shadows everywhere.

OWN-WORLD: Two inks carry everything - glaze green (#2f4a33 / #273e2b) owns whole fields (header, hero, origin, B2B,
footer) and clay cream (#f6f1e7 ground, #fcfaf7 raised) owns the shop floor. Ochre (#f5b82e / #9c6508) appears only as
brushwork: hairline rim bands, the one primary action, ratings. Sage wash (#b8cbb4) is the packshots' own ground.
At rest, depth only by overlapping flat planes (raise from the Łowicz papercut: never by tone or blur); a lifted
card on hover is the one place a soft green-tinted shadow appears. Media sit in dish rims:
large radius, an inner ochre ring. Controls are glazed tiles: 0.75rem radius, not pills. Fraunces display at strong
scale steps, tracked tight; Manrope body; small labels in tracked caps.

STORY: A visitor sees origin and real products at once, trusts the quality, adds to cart without leaving the grid; a
business buyer sees the same world with its own unmistakable lane and price.

FIRST VIEWPORT: Full-bleed hero photo under a deep glaze field, headline left at display scale (to 6rem), ochre
brush rule instead of a border, one ochre glazed-tile CTA; the header is one glaze band with the B2B lane visible.
The top of the B2B band starts below, as a section.

FORM: Rishtan ceramics (lyagan dish), position 6 of 7 on the grounded list, seed key 3811936f. Raises: one axis per
section (Versailles); a strict 4-column card grid with equal cells (teletext); the hero as one single-hue field
(shader portal); numbered stagger order for every reveal (desert neon chase); total two-ink commitment (duotone spread).
Signature interaction: category dishes - the painted ochre rim ring turns slowly like the potter's wheel on hover
while the dish rises over its plane; reveals settle like a dish onto the wheel (expo ease-out, staggered in order),
reduced motion keeps fades only.

OWNER AMENDMENT (after the first build): "you didn't really change the design, it needs to be unique, a lot of animations
and smooth things, not too much, but the website needs to feel more modern". Accordingly: the category grid becomes a bento
(first dish 2x2, last dish 2 wide) instead of strict equal cells; motion grows beyond the wheel into one family - ordered
settles, word-by-word headings, a slowly turning lyagan medallion, origin pictures drifting at their own depth, the header
stepping aside while reading, a slow announcement band, and on fine pointers a magnetic hero action, tilting category dishes
and a glaze sheen on the primary action. All expo ease-out; reduced motion keeps the order as fades. The header stays an
opaque glaze band (no glass blur).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
