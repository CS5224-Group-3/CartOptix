import { type Static, Type } from "@sinclair/typebox";
import { closedObject } from "./schema.ts";

export const DependencyCheckSchema = closedObject({
  status: Type.Union([Type.Literal("ok"), Type.Literal("unavailable")]),
  detail: Type.Optional(Type.String()),
});
export type DependencyCheck = Static<typeof DependencyCheckSchema>;
export const LivenessResponseSchema = closedObject({ status: Type.Literal("ok") });
export type LivenessResponse = Static<typeof LivenessResponseSchema>;

export const ReadinessResponseSchema = closedObject({
  status: Type.Union([Type.Literal("ok"), Type.Literal("unavailable")]),
  checks: closedObject({
    database: DependencyCheckSchema,
    /** Foundation compatibility: required by serving policy when shopper routes
     * are enabled. #4 supplies the active-dataset check at integration. */
    activeDataset: Type.Optional(DependencyCheckSchema),
  }),
});
export type ReadinessResponse = Static<typeof ReadinessResponseSchema>;
