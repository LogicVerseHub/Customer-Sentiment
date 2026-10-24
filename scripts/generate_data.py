"""Generate a synthetic customer-sentiment dataset: 1,000 users with their orders and reviews.

Output: data/customers.json (read by index.html at runtime).

Usage (from the project root):
    python scripts/generate_data.py            # default seed, 1000 users
    python scripts/generate_data.py --users 500 --seed 7

The data is fictional. Review text is assembled from templates so that each review
mentions one topic; the dashboard re-derives that topic from keywords (see TOPICS in
assets/app.js), the same way the original project derives it in its build script.
"""
import argparse
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "customers.json"

START = datetime(2025, 10, 1)
END = datetime(2026, 9, 30, 23, 59)

# name, sku, price, base quality (rating shift), topic weights for complaints
PRODUCTS = [
    ("Oversized Fleece Hoodie", "UTC-HDY", 64, 0.25, {"fabric": 3, "size": 3, "design": 1}),
    ("Boxy Heavyweight Tee", "UTC-BXY", 29, 0.30, {"size": 3, "fabric": 2, "design": 1}),
    ("Graphic Print Tee", "UTC-GRT", 32, -0.10, {"design": 4, "fabric": 2, "size": 1}),
    ("Loose Cargo Pants", "UTC-CRG", 58, 0.05, {"size": 4, "fabric": 1, "design": 2}),
    ("Washed Baggy Jeans", "UTC-BGJ", 72, -0.05, {"size": 4, "fabric": 2, "design": 1}),
    ("Nylon Coach Jacket", "UTC-JKT", 89, 0.10, {"fabric": 2, "design": 3, "size": 1}),
    ("Plaid Flannel Shirt", "UTC-FLN", 48, -0.35, {"fabric": 4, "size": 2, "design": 1}),
    ("Washed Crewneck", "UTC-CRW", 54, 0.00, {"fabric": 3, "size": 1, "design": 2}),
    ("Denim Baggy Jorts", "UTC-JRT", 42, 0.15, {"size": 3, "fabric": 1, "design": 1}),
    ("Oversized Bowling Shirt", "UTC-SHT", 46, 0.05, {"design": 3, "size": 2, "fabric": 1}),
]
PRODUCT_WEIGHTS = [16, 15, 12, 10, 11, 7, 8, 9, 6, 6]

# city, weight, extra lateness probability
CITIES = [
    ("New York", 16, 0.04), ("Los Angeles", 14, 0.06), ("Chicago", 11, 0.05),
    ("Houston", 9, 0.10), ("Phoenix", 7, 0.12), ("Philadelphia", 8, 0.05),
    ("San Diego", 7, 0.06), ("Seattle", 9, 0.08), ("Austin", 10, 0.09), ("Denver", 9, 0.14),
]
# channel, weight, rating shift
CHANNELS = [("Website", 34, 0.15), ("Amazon", 28, -0.05), ("Instagram Shop", 18, 0.0), ("TikTok Shop", 20, -0.25)]
PAYMENTS = [("Credit Card", 30), ("PayPal", 22), ("Apple Pay", 16), ("Debit Card", 14), ("Google Pay", 10), ("Klarna", 8)]

FIRST = ("Aiden Alex Amara Ava Ben Bianca Caleb Chloe Daniel Diana Eli Emma Ethan Fatima Felix Grace Hana Hugo Isaac Isla "
         "Jade Jamal Jasmine Jonah Kai Kara Leo Lena Liam Lucia Maya Marco Mia Milo Nadia Noah Nora Omar Olivia Owen "
         "Priya Quinn Rafael Riley Rosa Ryan Sam Sara Sofia Theo Tara Uma Victor Vera Wes Willa Xavier Yara Zane Zoe").split()
LAST = ("Adams Ahmed Bailey Brooks Carter Chen Cruz Davis Diaz Evans Fischer Foster Garcia Gray Hughes Ito Jensen Kim "
        "Khan Lee Lopez Martin Morales Nguyen Novak Ortiz Patel Perez Price Reed Reyes Rivera Ross Sanders Silva Singh "
        "Stone Sullivan Tanaka Torres Turner Walker Ward Watson Wong Young").split()

# Review templates per topic and polarity. Each template only uses keywords of its own topic
# (and of no topic ranked above it in assets/app.js), so keyword matching recovers the topic.
T = {
    "service": {
        "pos": ["Customer service sorted out my exchange within a day.", "The support team replied fast and was super friendly.",
                "Had a question about my {p} and the support agent was really helpful."],
        "neu": ["Support replied after two days; the answer was okay.", "Customer service was polite but the response took a while."],
        "neg": ["Customer service never replied to my emails about the {p}.", "Still waiting on a refund, support keeps ignoring me.",
                "Tried to complain about my {p} and the agent was dismissive."],
    },
    "packaging": {
        "pos": ["The packaging was neat and the {p} was folded perfectly.", "Lovely packaging, recyclable mailer and a thank-you card."],
        "neu": ["Packaging was basic, nothing special.", "Plain packaging, the {p} was wrapped in a simple bag."],
        "neg": ["The parcel was torn open and the {p} was dirty.", "Terrible packaging, the box was crushed on one side.",
                "The {p} came badly wrapped and got wet in the rain."],
    },
    "delivery": {
        "pos": ["Shipping was quick, arrived a day before the estimate.", "Fast delivery and tracking updates the whole way.",
                "My {p} arrived early, very impressed with the shipping."],
        "neu": ["Delivery took about as long as the estimate said.", "Shipping was average, arrived on the last estimated day."],
        "neg": ["The {p} arrived days late with no tracking updates.", "Shipping was really slow, way past the estimate.",
                "The courier lost my order for a week, delivery was a mess."],
    },
    "price": {
        "pos": ["Great value for money, the {p} feels premium.", "Totally worth the price, would buy again on the next sale.",
                "Good deal for this quality, worth every dollar."],
        "neu": ["Price is fair, nothing more.", "Okay value, a bit expensive without a discount."],
        "neg": ["Way too expensive for what you get.", "Not worth the price at all, the {p} looks cheap.",
                "Overpriced, I expected more for this money."],
    },
    "fabric": {
        "pos": ["The fabric is thick and soft, feels very durable.", "Heavy cotton, solid stitching, the {p} holds up great.",
                "Material is soft and breathable, comfortable all day."],
        "neu": ["Fabric is okay, a little thinner than I expected.", "Material feels average, stitching looks fine."],
        "neg": ["The fabric started pilling after one wash.", "It shrank and faded after the first wash.",
                "Material feels thin and rough, stitching came loose on the {p}."],
    },
    "size": {
        "pos": ["The fit is spot on, perfectly oversized.", "Size chart was accurate, the {p} fits just right.",
                "Love the relaxed fit, the length is perfect for layering."],
        "neu": ["Fit is slightly loose, but wearable.", "Size is okay, sleeves are a bit long on the {p}."],
        "neg": ["Runs small, had to return it for a bigger size.", "The fit is way off, too tight across the shoulders.",
                "Waist is tight and the length is too short, size chart is wrong."],
    },
    "design": {
        "pos": ["The color is exactly like the photos, love the design.", "The print looks sharp and the details are clean.",
                "Great design, the pockets and buttons look high-end."],
        "neu": ["Design is nice, the color is a little darker than the photos.", "The graphic is okay, simpler than I expected."],
        "neg": ["The print started cracking quickly.", "The color looks nothing like the photos.",
                "A button fell off and the zipper on the {p} feels flimsy."],
    },
}
OPENERS = ["", "", "", "Honestly, ", "Just got my order. ", "Second time buying here. ", "Quick review: ", "After a few weeks, "]
CLOSERS = {
    "pos": ["", "", " Would buy again.", " Highly recommend!", " Very happy overall."],
    "neu": ["", "", " It's fine.", " No strong feelings either way."],
    "neg": ["", " Disappointed overall.", " Won't order again.", " Not happy."],
}


def pick(pairs):
    return random.choices([p[0] for p in pairs], weights=[p[1] for p in pairs])[0]


def order_date(month_weights):
    m = random.choices(range(12), weights=month_weights)[0]
    y, mo = 2025 + (9 + m) // 12, (9 + m) % 12 + 1
    first = datetime(y, mo, 1)
    nxt = datetime(y + mo // 12, mo % 12 + 1, 1)
    return first + timedelta(seconds=random.randrange(int((nxt - first).total_seconds()))), m


def build(n_users):
    # steady growth plus a holiday peak in Nov/Dec
    month_weights = [8, 11, 13, 7, 7, 8, 8, 9, 9, 10, 10, 11]
    users, oid = [], 0
    for u in range(1, n_users + 1):
        city, _, city_late = random.choices(CITIES, weights=[c[1] for c in CITIES])[0]
        n_orders = random.choices([1, 2, 3, 4], weights=[58, 26, 11, 5])[0]
        dates = sorted((order_date(month_weights) for _ in range(n_orders)), key=lambda x: x[0])
        loyal = 0.15 * (n_orders - 1)  # repeat buyers rate slightly higher
        orders = []
        for dt, m in dates:
            oid += 1
            pi = random.choices(range(len(PRODUCTS)), weights=PRODUCT_WEIGHTS)[0]
            name, sku, price, quality, issues = PRODUCTS[pi]
            channel, _, ch_shift = random.choices(CHANNELS, weights=[c[1] for c in CHANNELS])[0]
            qty = random.choices([1, 2, 3], weights=[70, 22, 8])[0]
            holiday = m in (1, 2)
            disc = random.choices([0, 10, 15, 20, 25], weights=[40, 20, 20, 15, 5] if holiday else [75, 12, 8, 4, 1])[0]
            est = random.randint(2, 6)
            # lateness improves over the year (logistics fix), worse in holiday peak
            p_late = 0.16 + city_late + (0.10 if holiday else 0) - 0.010 * m
            late = random.random() < p_late
            act = est + random.randint(1, 4) if late else max(1, est - random.choices([0, 1, 2], weights=[55, 30, 15])[0])
            gross = price * qty
            disc_amt = round(gross * disc / 100, 2)
            order = {
                "order_id": f"ORD-{oid:05d}",
                "order_date": dt.strftime("%Y-%m-%dT%H:%M"),
                "channel": channel,
                "payment": pick(PAYMENTS),
                "product": name, "sku": sku, "unit_price": price, "quantity": qty,
                "discount_pct": disc, "discount_amount": disc_amt, "total": round(gross - disc_amt, 2),
                "est_delivery_days": est, "actual_delivery_days": act,
                "review": None,
            }
            if random.random() < 0.74:
                score = 3.95 + quality + ch_shift + loyal + 0.03 * m - (1.3 if late else 0) + random.gauss(0, 1.05)
                rating = max(1, min(5, round(score)))
                pol = "pos" if rating >= 4 else "neu" if rating == 3 else "neg"
                if pol == "neg" and late and random.random() < 0.3:
                    topic = "delivery"
                else:
                    w = {"service": 0.8, "packaging": 1, "delivery": 0.6, "price": 1.4, **{k: v * 1.6 for k, v in issues.items()}}
                    if pol == "pos":
                        w["price"] += 1
                    topic = random.choices(list(w), weights=list(w.values()))[0]
                text = (random.choice(OPENERS) + random.choice(T[topic][pol]).format(p=name) + random.choice(CLOSERS[pol])).strip()
                text = text[0].upper() + text[1:]
                rdate = dt + timedelta(days=act + random.randint(1, 9), hours=random.randint(0, 23))
                order["review"] = {
                    "rating": rating, "text": text,
                    "sentiment": {"pos": "Positive", "neu": "Neutral", "neg": "Negative"}[pol],
                    "date": min(rdate, END + timedelta(days=20)).strftime("%Y-%m-%d"),
                }
            orders.append(order)
        users.append({
            "user_id": f"U-{u:04d}",
            "name": f"{random.choice(FIRST)} {random.choice(LAST)}",
            "city": city,
            "joined": (dates[0][0] - timedelta(days=random.randint(0, 200))).strftime("%Y-%m-%d"),
            "orders": orders,
        })
    # order ids follow purchase date, as in a real order log
    flat = sorted((o for u in users for o in u["orders"]), key=lambda o: o["order_date"])
    for i, o in enumerate(flat, 1):
        o["order_id"] = f"ORD-{i:05d}"
    return users


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    random.seed(args.seed)
    users = build(args.users)
    data = {
        "store": {"name": "Urban Thread Co.", "currency": "USD"},
        "description": "Synthetic customer feedback dataset: users, their orders, and reviews.",
        "users": users,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    n_orders = sum(len(u["orders"]) for u in users)
    n_rev = sum(1 for u in users for o in u["orders"] if o["review"])
    print(f"{len(users)} users, {n_orders} orders, {n_rev} reviews -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
