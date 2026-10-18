import { check } from "k6";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

const baseUrl = (__ENV.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const profile = __ENV.PROFILE === "surge" ? "surge" : "normal";
const mode = __ENV.MODE || "mixed";
const target = __ENV.TARGET || "";
const basketSizeInput = __ENV.BASKET_SIZE || "20";
const clickRpm = Number(__ENV.CLICK_RPM || 0);
const rampStepRpm = Number(__ENV.RAMP_STEP_RPM || 60);
const rampStageDuration = __ENV.RAMP_STAGE_DURATION || "2m";
const rampSteps = Number(__ENV.RAMP_STEPS || 4);
const rampTarget = target;
const validModes = new Set(["mixed", "isolated", "ramp"]);
const validTargets = new Set(["catalogue", "products", "offers", "basket"]);

if (!validModes.has(mode)) {
  throw new Error("MODE must be mixed, isolated, or ramp");
}
if (!["20", "50", "both"].includes(basketSizeInput)) {
  throw new Error("BASKET_SIZE must be 20, 50 or both");
}
if (!Number.isInteger(clickRpm) || clickRpm < 0) {
  throw new Error("CLICK_RPM must be a non-negative integer");
}
if ((mode === "isolated" || mode === "ramp") && !validTargets.has(target)) {
  throw new Error(`TARGET must be one of catalogue, products, offers, or basket when MODE=${mode}`);
}
if (!Number.isFinite(rampStepRpm) || rampStepRpm <= 0) {
  throw new Error("RAMP_STEP_RPM must be a positive number");
}
if (!Number.isInteger(rampSteps) || rampSteps < 1) {
  throw new Error("RAMP_STEPS must be a positive integer");
}

const productIds = [
  // Keep the first 20 aligned with DEMO_BASKET; k6 cannot import the TS fixture.
  "calbee-black-pepper-prawn-crackers-90g",
  "calbee-original-prawn-crackers-90g",
  "calbee-spicy-prawn-crackers-90g",
  "carnation-low-fat-evaporated-milk-405g",
  "doritos-nacho-cheese-tortilla-chips-190g",
  "heinz-no-salt-added-tomato-ketchup-397g",
  "heinz-no-sugar-added-tomato-ketchup-369g",
  "hershey-s-kisses-creamy-milk-chocolate-146g",
  "kellogg-s-rice-krispies-cereal-130g",
  "lay-s-stax-original-potato-chips-100g",
  "lay-s-hot-and-spicy-potato-chips-50g",
  "lay-s-nori-seaweed-potato-chips-170g",
  "lay-s-salted-egg-potato-chips-170g",
  "lay-s-sour-cream-and-onion-potato-chips-170g",
  "lay-s-sour-cream-and-onion-potato-chips-50g",
  "lee-kum-kee-gluten-free-soy-sauce-500ml",
  "munchy-s-lexus-dark-chocolate-cookies-189g",
  "maggi-premium-oyster-sauce-500g",
  "marigold-hl-chocolate-milk-946ml",
  "milkmaid-low-fat-sweetened-condensed-skimmed-milk-392g",
  "bcrs-evian-natural-mineral-water-6-x-1-5l",
  "bcrs-farmhouse-fresh-milk-1-89l",
  "bcrs-magnolia-high-protein-chocolate-milk-375ml",
  "bcrs-monster-pipeline-punch-energy-drink-can-355ml",
  "bcrs-pokka-lychee-oolong-tea-1-5l",
  "bcrs-sunsweet-prune-juice-946ml",
  "bcrs-volvic-natural-mineral-water-6-x-1-5l",
  "bcrs-yeo-s-first-harvest-green-tea-no-sugar-1-5l",
  "beryl-s-assorted-almond-chocolate-370g",
  "bio-home-multi-surface-cleaner-500ml-lavender-and-bergamot",
  "biograde-fresh-lemongrass-dishwashing-liquid",
  "biograde-fresh-lime-dishwashing-liquid",
  "blue-elephant-hot-red-chilli-sauce-190ml",
  "blue-elephant-sweet-chilli-sauce-190ml",
  "blue-frog-keto-almond-peanut-and-raspberry-cereal-300g",
  "blue-frog-macadamia-almond-and-manuka-honey-cereal-350g",
  "bob-s-red-mill-classic-instant-oatmeal-6-x-45g",
  "boxgreen-honey-mustard-soy-crisps-130g",
  "boxgreen-peanut-pretzel-dark-chocolate-130g",
  "breeze-anti-bacterial-and-colour-protect-liquid-detergent-3-6kg",
  "breeze-colour-care-liquid-detergent-refill-1-5kg",
  "breeze-gentle-on-skin-liquid-detergent-3-6kg",
  "colavita-linguine-pasta",
  "colgate-gentle-sensitive-expert-toothbrush-1pcs",
  "colgate-max-fresh-cool-mint-toothpaste-160g",
  "colgate-max-fresh-peach-passion-toothpaste-100g",
  "cocobella-chocolate-coconut-water-1l",
  "cirio-chopped-tomatoes-400g",
  "cloversoft-2-in-1-bleach-free-toilet-cleaner-rosemary-and-ginger-500ml",
  "campbell-s-real-stock-salt-reduced-beef-stock-1l",
];

const baskets = {
  20: productIds.slice(0, 20).map((productId) => ({ productId, quantity: 1 })),
  50: productIds.slice(0, 50).map((productId) => ({ productId, quantity: 1 })),
};

const rates =
  profile === "surge"
    ? // k6 requires an integer rate; these are the agreed RPS values expressed
      // per minute: 1/5/5/1 RPS = 60/300/300/60 RPM.
      { catalogue: 60, products: 300, offers: 300, basket: 60 }
    : // 0.2/1/1/0.2 RPS = 12/60/60/12 RPM.
      { catalogue: 12, products: 60, offers: 60, basket: 12 };

export const unexpectedFailures = new Counter("unexpected_failures");
export const requestErrors = new Counter("request_errors");
export const requestTimeouts = new Counter("request_timeouts");
export const basket20Duration = new Trend("basket_20_duration", true);
export const basket50Duration = new Trend("basket_50_duration", true);

function request(name, method, path, body) {
  const response =
    method === "POST"
      ? http.post(`${baseUrl}${path}`, JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
          tags: { endpoint: name },
        })
      : http.get(`${baseUrl}${path}`, { tags: { endpoint: name } });
  const valid = check(response, { "expected response": (r) => r.status >= 200 && r.status < 300 });
  const timedOut = response.status === 0 && /timeout/i.test(response.error || "");
  if (timedOut) requestTimeouts.add(1, { endpoint: name });
  if (!valid) requestErrors.add(1, { endpoint: name });
  if (!valid || response.status >= 500) unexpectedFailures.add(1, { endpoint: name });
  return response;
}

export function catalogue() {
  request("catalogue", "GET", "/api/v1/catalogue");
}
export function products() {
  request("products", "GET", "/api/v1/products?q=milk");
}
export function offers() {
  request(
    "offers",
    "GET",
    `/api/v1/products/${productIds[__ITER % productIds.length]}/offers?quantity=1`,
  );
}
export function basket() {
  // "both" alternates sizes so one run reports each size's p99 separately.
  const size = basketSizeInput === "both" ? (__ITER % 2 ? 50 : 20) : Number(basketSizeInput);
  const response = request("basket", "POST", "/api/v1/basket/compare", { lines: baskets[size] });
  (size === 50 ? basket50Duration : basket20Duration).add(response.timings.duration);
}

// Real seed listings. The endpoint answers 204 whatever happens (excluded from
// SC-06), so lost clicks are read from the server logs, not from k6.
const listingIds = [
  "cold-storage-calbee-prawn-crackers-original-90g",
  "fairprice-calbee-prawn-crackers---original-13146781",
  "redmart-pdp-i301134522-s527214284",
];
export function click() {
  request("click", "POST", "/api/v1/events/outbound-click", {
    listingId: listingIds[__ITER % listingIds.length],
  });
}

export function ramp() {
  if (rampTarget === "catalogue") return catalogue();
  if (rampTarget === "products") return products();
  if (rampTarget === "offers") return offers();
  return basket();
}

if (mode === "mixed" && clickRpm > 0) rates.click = clickRpm;

const constantRateScenarios = Object.fromEntries(
  (mode === "isolated" ? [target] : Object.keys(rates)).map((name) => [
    name,
    {
      executor: "constant-arrival-rate",
      exec: name,
      rate: rates[name],
      timeUnit: "1m",
      duration: __ENV.DURATION || "2m",
      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  ]),
);

const scenarios =
  mode === "ramp"
    ? {
        ramp: {
          executor: "ramping-arrival-rate",
          exec: "ramp",
          startRate: rampStepRpm,
          timeUnit: "1m",
          preAllocatedVUs: 10,
          maxVUs: 100,
          stages: Array.from({ length: rampSteps }, (_, index) => {
            const stepTarget = rampStepRpm * (index + 1);
            return [
              { target: stepTarget, duration: "5s" },
              { target: stepTarget, duration: rampStageDuration },
            ];
          }).flat(),
        },
      }
    : constantRateScenarios;

export const options = {
  scenarios,
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  thresholds: {
    http_req_failed: ["rate<0.001"],
    "http_req_duration{endpoint:catalogue}": ["p(99)<1000"],
    "http_req_duration{endpoint:products}": ["p(99)<1000"],
    "http_req_duration{endpoint:basket}": ["p(99)<2000"],
    // No agreed target; k6 only reports a tag's latency when a threshold names it.
    "http_req_duration{endpoint:offers}": ["max>=0"],
    "http_req_duration{endpoint:click}": ["max>=0"],
    basket_20_duration: ["p(99)<2000"],
    basket_50_duration: ["p(99)<2000"],
  },
};
