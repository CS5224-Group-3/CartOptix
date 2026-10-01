// Renders the CartOptix basket comparison home page.

import { SNAPSHOT_DISCLAIMER } from "@cartoptix/contracts";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Leaf,
  Scale,
  ShieldCheck,
  Sparkles,
  Truck,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { HowItWorks, useBasket } from "@/App";
import { DEMO_BASKET } from "@/demo";
import { RETAILER_DISPLAY, RETAILER_IDS } from "@/lib/format";

export default function Home() {
  const [, navigate] = useLocation();
  const { loadScenario } = useBasket();
  return (
    <main>
      <section className="hero-section">
        <div className="hero-texture" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="trust-kicker">
              <span>
                <Sparkles size={14} /> Prototype project
              </span>
              <span>Singapore grocery planning</span>
            </div>
            <h1>
              Find the smartest way to fill your <em>grocery basket.</em>
            </h1>
            <p className="hero-lede">
              CartOptix compares estimated basket costs across Singapore supermarkets — including
              delivery fees and minimum orders — so you can decide with more clarity before
              checkout.
            </p>
            <div className="hero-actions">
              <Link href="/catalogue" className="button button--primary button--large">
                Start comparing <ArrowRight size={18} />
              </Link>
              <a href="#how-it-works" className="button button--ghost button--large">
                How it works <ChevronRight size={17} />
              </a>
            </div>
            <div className="hero-boundary">
              <ShieldCheck size={17} />
              <span>Fixed dataset prototype. Estimates only. No checkout or payment.</span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-visual__glow" />
            <div className="basket-art">
              <div className="basket-art__top">
                <span>Basket snapshot</span>
                <span className="basket-art__live">
                  <span /> prototype
                </span>
              </div>
              <div className="basket-art__total">
                <small>Cheapest complete basket</small>
                <strong>S$62.48</strong>
                <span>FairPrice · 13 products</span>
              </div>
              <div className="basket-art__plan">
                <div className="art-row">
                  <span className="art-icon art-icon--red">R</span>
                  <div>
                    <strong>RedMart</strong>
                    <small>13 products</small>
                  </div>
                  <b>S$65.10</b>
                </div>
                <div className="art-row">
                  <span className="art-icon art-icon--green">F</span>
                  <div>
                    <strong>FairPrice</strong>
                    <small>13 products</small>
                  </div>
                  <b>S$62.48</b>
                </div>
              </div>
              <div className="basket-art__footer">
                <Check size={15} /> Delivery fees included · whole packs only
              </div>
            </div>
            <div className="hero-float hero-float--top">
              <Scale size={18} />
              <div>
                <strong>Retailer vs retailer</strong>
                <span>Complete basket totals</span>
              </div>
            </div>
            <div className="hero-float hero-float--bottom">
              <WalletCards size={18} />
              <div>
                <strong>No hidden ranking</strong>
                <span>Retailer payments never influence results</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="retailer-strip">
        <div className="container retailer-strip__inner">
          <span className="retailer-strip__label">Compare demo offers from</span>
          <div className="retailer-badges">
            {RETAILER_IDS.map((retailerId) => {
              const retailer = RETAILER_DISPLAY[retailerId];
              return (
                <div key={retailerId} className={`retailer-badge ${retailer.badgeClass}`}>
                  <span className="retailer-badge__logo">{retailer.initial}</span>
                  <div>
                    <strong>{retailer.name}</strong>
                    <small>{retailer.tagline}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section className="value-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">A calmer way to compare</p>
              <h2>Clarity for the part before checkout.</h2>
            </div>
            <p>
              Build a complete basket once. CartOptix does the arithmetic at every retailer —
              without moving carts or making promises it cannot verify.
            </p>
          </div>
          <div className="value-grid">
            <ValueCard
              icon={<Scale />}
              number="01"
              title="Compare every retailer"
              text="See the complete basket priced at each retailer, with the cheapest one recommended."
            />
            <ValueCard
              icon={<Truck />}
              number="02"
              title="See the full cost"
              text="Delivery fees, free-delivery thresholds and mandatory charges are modelled separately."
            />
            <ValueCard
              icon={<CircleHelp />}
              number="03"
              title="Make an informed call"
              text="Promotions that cannot be verified are shown as excluded, never quietly applied."
            />
          </div>
        </div>
      </section>
      <section className="demo-callout">
        <div className="container demo-callout__inner">
          <div>
            <p className="eyebrow">Want to see it in action?</p>
            <h2>Load a realistic 20-line demo basket.</h2>
            <p>
              It stays in this browser tab only, and you can edit every quantity before comparing.
            </p>
          </div>
          <button
            type="button"
            className="button button--dark button--large"
            onClick={() => {
              loadScenario(DEMO_BASKET);
              toast.success("20-line demo basket loaded");
              navigate("/basket");
            }}
          >
            Load demo basket <ArrowRight size={18} />
          </button>
        </div>
      </section>
      <HowItWorks />
      <section className="trust-section">
        <div className="container trust-section__inner">
          <div className="trust-section__icon">
            <Leaf size={24} />
          </div>
          <div>
            <p className="eyebrow">Important to know</p>
            <h2>CartOptix is a decision aid, not a retailer checkout.</h2>
            <p>
              It does not purchase groceries, transfer carts, reserve stock, coordinate delivery
              slots or accept payment. Rebuild your basket and complete checkout on the retailer’s
              website.
            </p>
          </div>
          <Link href="/catalogue" className="text-link">
            Explore the prototype <ArrowRight size={16} />
          </Link>
        </div>
      </section>
      <section className="visible-trust">
        <div className="container">
          <p>
            <ShieldCheck size={16} /> {SNAPSHOT_DISCLAIMER}
          </p>
        </div>
      </section>
    </main>
  );
}

function ValueCard({
  icon,
  number,
  title,
  text,
}: {
  icon: React.ReactNode;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <article className="value-card">
      <div className="value-card__top">
        <div className="value-card__icon">{icon}</div>
        <span>{number}</span>
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
