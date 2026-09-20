import { COOKIE_NAME } from "@shared/const";
import { DEMO_BASKET, DEMO_SCENARIOS, PRODUCTS, compareBasket, getOffersForQuantity, getProduct } from "@shared/cartoptix";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";

const basketLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  catalogue: publicProcedure
    .input(z.object({ search: z.string().optional(), category: z.string().optional() }).optional())
    .query(({ input }) => {
      const search = input?.search?.trim().toLowerCase() ?? "";
      return PRODUCTS.filter((product) => {
        const matchesSearch = !search || `${product.name} ${product.brand} ${product.variant}`.toLowerCase().includes(search);
        const matchesCategory = !input?.category || input.category === "All" || product.category === input.category;
        return matchesSearch && matchesCategory;
      });
    }),
  product: publicProcedure
    .input(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20).default(1) }))
    .query(({ input }) => {
      const product = getProduct(input.productId);
      if (!product) return null;
      return { product, offers: getOffersForQuantity(input.productId, input.quantity) };
    }),
  compare: publicProcedure
    .input(z.object({ lines: z.array(basketLineSchema).min(1).max(50), retailerLimit: z.union([z.literal(1), z.literal(2), z.literal(3)]), datasetVersion: z.literal("prototype-2026-09") }))
    .mutation(({ input }) => compareBasket(input.lines, input.retailerLimit)),
  demo: publicProcedure.query(() => ({ basket: DEMO_BASKET, scenarios: DEMO_SCENARIOS })),
  outboundClick: publicProcedure
    .input(z.object({ retailer: z.string(), productId: z.string(), destination: z.string().url() }))
    .mutation(({ input }) => {
      console.info(`[outbound-click] ${input.retailer} ${input.productId}`);
      return { accepted: true } as const;
    }),
});

export type AppRouter = typeof appRouter;
