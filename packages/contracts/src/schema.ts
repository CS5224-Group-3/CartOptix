/**
 * TypeBox helpers used to build the shared schemas.
 *
 * Internal to this package: `index.ts` deliberately does not re-export them, so
 * `@cartoptix/contracts` exposes contracts rather than schema-building tools.
 */
import { type TProperties, type TSchema, Type } from "@sinclair/typebox";

/** Rejects unknown fields, so a client cannot smuggle prices past validation. */
export const closedObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

export const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
