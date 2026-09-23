/**
 * TypeBox helpers used to build the shared schemas.
 *
 * Internal to this package: `index.ts` does not re-export them, so
 * `@cartoptix/contracts` exposes contracts rather than schema-building tools.
 */
import Type, { type TProperties, type TSchema } from "typebox";

/** Rejects unknown fields, so a response cannot grow undeclared data such as dates. */
export const closedObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

export const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
