import { Schema, SchemaDefinition, SchemaOptions } from 'mongoose';
import { auditable } from './auditable';
import { softDelete } from './softDelete';
import { tenantScoped } from './tenantScoped';

export interface TenantSchemaOptions extends SchemaOptions {
  softDelete?: boolean;
  auditable?: boolean;
}

/** Standard schema factory for every tenant-owned collection. */
export function createTenantSchema(definition: SchemaDefinition, opts: TenantSchemaOptions = {}): Schema {
  const { softDelete: sd = false, auditable: au = true, ...schemaOptions } = opts;
  const schema = new Schema(definition as any, { timestamps: true, versionKey: false, ...schemaOptions });
  tenantScoped(schema);
  if (sd) softDelete(schema);
  if (au) auditable(schema);
  return schema;
}

/** Schema for platform-level collections (no tenantId). Their models must be listed in PLATFORM_MODELS. */
export function createPlatformSchema(definition: SchemaDefinition, opts: SchemaOptions = {}): Schema {
  return new Schema(definition as any, { timestamps: true, versionKey: false, ...opts });
}

export const PLATFORM_MODELS = [
  'Plan',
  'Tenant',
  'PlatformAdmin',
  'SubscriptionPayment',
  'RefreshToken',
  'GovNotice',
  'TestPlatformThing',
];
