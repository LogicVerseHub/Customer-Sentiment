# Customer Sentiment Dashboard

Interactive dashboard for reading customer reviews of **Urban Thread Co.**, a fictional streetwear store.
The input is a single JSON file with **1,000 users**, their orders (≈1,600) and reviews (≈1,150) across
10 products, October 2025 to September 2026.

Plain HTML, CSS and JavaScript: no framework, no build step, no chart library (charts are hand-drawn SVG).

## What's in the dashboard   ## https://logicversehub.github.io/Customer-Sentiment/#reviews

- Filters for period, product, channel and city that apply to every card
- Average rating, star distribution, and four KPIs with monthly sparklines and change vs. the prior 3 months
- Sentiment mix, purchase frequency per user, and **user-level sentiment** (each user's average rating)
- Sales, rating and top complaint per product
- Key insights computed from the data under the active filters
- Sentiment per review topic, and delivery accuracy (actual vs. estimated days)
- Sortable performance table by city, channel, product, payment, discount and customer type
- Review table with search, sentiment filter and paging
- Light/dark theme, print / PDF, and **Load JSON** (button or drag & drop) to view your own data file

## Project structure

```
index.html              dashboard page
assets/style.css        styling (light and dark theme)
assets/app.js           JSON loading, topic rules, metrics, SVG charts, interaction
data/customers.json     input data: 1,000 users with orders and reviews
scripts/generate_data.py  regenerates data/customers.json (synthetic, seeded)
```

## Run it

**GitHub Pages:** push the repo, then *Settings → Pages → Deploy from a branch → main / root*.
The dashboard is served at `https://<your-user>.github.io/<repo-name>/`.

**Locally:** browsers block `fetch()` from `file://`, so serve the folder:

```bash
python -m http.server 8000
```

then open http://localhost:8000. (Opening `index.html` directly still works: click **Load JSON** and pick
`data/customers.json`.)

To point the page at another file in the repo, use `?data=`, e.g. `index.html?data=data/other.json`.

## Input format

```json
{
  "store": { "name": "Urban Thread Co.", "currency": "USD" },
  "users": [
    {
      "user_id": "U-0001",
      "name": "Maya Chen",
      "city": "Seattle",
      "joined": "2025-06-14",
      "orders": [
        {
          "order_id": "ORD-00042",
          "order_date": "2025-10-03T14:21",
          "channel": "Website",
          "payment": "PayPal",
          "product": "Oversized Fleece Hoodie",
          "sku": "UTC-HDY",
          "unit_price": 64,
          "quantity": 1,
          "discount_pct": 0,
          "discount_amount": 0,
          "total": 64,
          "est_delivery_days": 4,
          "actual_delivery_days": 3,
          "review": {
            "rating": 5,
            "text": "The fabric is thick and soft, feels very durable.",
            "sentiment": "Positive",
            "date": "2025-10-09"
          }
        }
      ]
    }
  ]
}
```

- `review` is `null` when an order was not reviewed.
- `sentiment` is optional; if missing it is derived from the rating (4–5 Positive, 3 Neutral, 1–2 Negative).
- `total` and `discount_amount` are optional; they are computed from price, quantity and discount if missing.
- A top-level array of users (without the `store` wrapper) is also accepted.

## Calculation notes

- Rating and sentiment shares are computed only from orders that have a review.
- An order is late when actual delivery days exceed the estimate.
- Review topics are not a field in the JSON. They are grouped from keywords in the review text, with the
  product name removed first; the first matching rule wins. Rules are in `TOPICS` at the top of `assets/app.js`.
- Groups with fewer than 20 reviews are greyed out as a small sample and are not used for insights.
- KPI changes compare the last 3 months with the 3 months before.
- User-level sentiment: a user's average rating across their reviews in scope (≥ 3.5 Positive, ≥ 2.5 Neutral,
  otherwise Negative).

## Regenerating the data

```bash
python scripts/generate_data.py --users 1000 --seed 42
```

All names, orders and reviews are synthetic.
