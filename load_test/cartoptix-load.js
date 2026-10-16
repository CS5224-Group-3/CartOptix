import { check } from "k6";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

const baseUrl = (__ENV.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const profile = __ENV.PROFILE === "surge" ? "surge" : "normal";
const mode = __ENV.MODE || "mixed";
const target = __ENV.TARGET || "all";
const basketSize = __ENV.BASKET_SIZE === "50" ? 50 : 20;
const rampTarget = target === "all" ? "basket" : target;
const rampStepRpm = Number(__ENV.RAMP_STEP_RPM || 60);
const rampStageDuration = __ENV.RAMP_STAGE_DURATION || "2m";

const productIds = [
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
  "munchy-s-lexus-mixed-nuts-cookies-189g",
  "naturel-organic-brown-rice-2kg",
  "naturel-organic-brown-rice-750g",
  "new-moon-premium-oyster-sauce-510g",
  "post-great-grains-banana-nut-crunch-cereal-439g",
  "post-great-grains-blueberry-morning-cereal-382g",
  "post-great-grains-cranberry-almond-crunch-cereal-396g",
  "ruffles-sour-cream-and-onion-potato-chips-170g",
  "songhe-glutinous-rice-1kg",
  "songhe-noble-brown-rice-5kg",
  "tai-hua-special-dark-soy-sauce-640ml",
  "tai-hua-special-light-soy-sauce-640ml",
  "tai-hua-superior-dark-soy-sauce-640ml",
  "tai-hua-superior-light-soy-sauce-640ml",
  "woh-hup-extra-flavour-oyster-sauce-500g",
  "aaa-pickled-mustard-170g",
  "ah-huat-extra-rich-white-coffee-13-x-36g",
  "alpen-no-added-sugar-swiss-style-muesli",
  "anlene-actifit-3x-plain-milk-powder-1kg",
  "australia-s-own-a2-protein-full-cream-uht-milk-1l",
  "aveeno-skin-relief-body-wash-1l",
  "ayam-brand-pulled-chicken-buffalo-150g",
  "ayam-brand-pulled-chicken-cajun-150g",
  "ayam-brand-pulled-chicken-honey-mustard-150g",
  "ayam-brand-pulled-chicken-truffle-mayonnaise-150g",
  "ayam-brand-sardines-in-tomato-sauce-155g",
  "bahlsen-zoo-jungle-cocoa-biscuits-100g",
  "barilla-italian-pasta-maccheroni-500g",
  "barilla-italian-pasta-pappardelle-with-eggs-250g",
  "barilla-italian-pasta-penne-rigate-500g",
  "barilla-italian-pasta-spaghetti-no-5-500g",
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
  if (!valid || response.status >= 500) unexpectedFailures.add(1, { endpoint: name });
  if (name === "basket")
    (basketSize === 50 ? basket50Duration : basket20Duration).add(response.timings.duration);
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
  request("basket", "POST", "/api/v1/basket/compare", { lines: baskets[basketSize] });
}

export function ramp() {
  if (rampTarget === "catalogue") return catalogue();
  if (rampTarget === "products") return products();
  if (rampTarget === "offers") return offers();
  return basket();
}

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
          stages: [1, 2, 3, 4].map((multiplier) => ({
            target: rampStepRpm * multiplier,
            duration: rampStageDuration,
          })),
        },
      }
    : constantRateScenarios;

export const options = { scenarios, thresholds: { http_req_failed: ["rate<0.001"] } };
