/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: AUTH_PASSWORD_MIN_LENGTH, signInSchema,
 *   signUpSchema, SignInValues, SignUpValues, AuthFormMode, AuthValuesByMode,
 *   authSchemaFor, createOrganizationSchema, CreateOrganizationValues,
 *   inviteMemberSchema, updateMemberSchema, removeMemberSchema,
 *   cancelInvitationSchema, resendInvitationSchema, createRoleSchema,
 *   updateRoleSchema, deleteRoleSchema, roleNameSchema, permissionStringSchema,
 *   createSubscriptionSchema, upgradeSubscriptionSchema, billingIntervalSchema,
 *   planKeySchema, CreateSubscriptionValues, UpgradeSubscriptionValues,
 *   projectKindSchema, projectStatusSchema, aspectRatioSchema, createProjectSchema,
 *   listProjectsSchema, renameProjectSchema, duplicateProjectSchema,
 *   jsonValueSchema, JsonValue, CANVAS_BY_ASPECT,
 *   assetKindSchema, createUploadUrlSchema, completeUploadSchema,
 *   listAssetsSchema, renameAssetSchema, CONTENT_TYPE_ALLOWLIST,
 *   UPLOAD_BYTES_PER_PLAN, VARIANT_NAMES, ASSET_TABS
 *
 * WHAT:  Barrel re-export for `src/lib/types/*` — the single import surface
 *        for custom (non-Prisma) types and their backing zod schemas.
 * WHY:   Per CLAUDE.md, custom types live under `lib/types` exclusively.
 *        Routing every consumer through `@/lib/types` keeps that constraint
 *        easy to enforce: imports from anywhere else are a code-smell flag.
 * WHERE: Imported by client + server code that needs auth (or future)
 *        input contracts.
 */

export {
  AUTH_PASSWORD_MIN_LENGTH,
  signInSchema,
  signUpSchema,
  authSchemaFor,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth'
export type {
  SignInValues,
  SignUpValues,
  AuthFormMode,
  AuthValuesByMode,
  ForgotPasswordValues,
  ResetPasswordValues,
} from './auth'
export { jsonValueSchema, jsonObjectSchema } from './json'
export type { JsonValue, JsonObject } from './json'
export {
  PROJECT_KINDS,
  PROJECT_STATUSES,
  ASPECT_RATIOS,
  CANVAS_BY_ASPECT,
  PROJECT_PAGE_SIZE,
  projectKindSchema,
  projectStatusSchema,
  aspectRatioSchema,
  projectTitleSchema,
  createProjectSchema,
  listProjectsSchema,
  getProjectSchema,
  renameProjectSchema,
  deleteProjectSchema,
  duplicateProjectSchema,
  projectFilterSchema,
  normalizeProjectFilters,
  PROJECT_FILTER_ALL,
  PROJECT_FILTER_DEFAULTS,
  PROJECT_SEARCH_MAX,
} from './project'
export type {
  ProjectKind,
  ProjectStatus,
  AspectRatio,
  CreateProjectValues,
  ListProjectsValues,
  RenameProjectValues,
  DuplicateProjectValues,
  ProjectFilterValues,
} from './project'
export {
  ASSET_KINDS,
  ASSET_SOURCES,
  ASSET_STATUSES,
  ASSET_TABS,
  ASSET_PAGE_SIZE,
  ASSET_FILTER_ALL,
  ASSET_FILTER_DEFAULTS,
  ASSET_SEARCH_MAX,
  CONTENT_TYPE_ALLOWLIST,
  MEDIA_FAMILIES,
  MODERATION_STATUSES,
  UPLOADABLE_ASSET_KINDS,
  UPLOAD_BYTES_CEILING,
  UPLOAD_BYTES_PER_PLAN,
  UPLOAD_CONTENT_TYPES,
  VARIANT_NAMES,
  assetFilenameSchema,
  assetFilterSchema,
  assetKindSchema,
  assetSourceSchema,
  assetStatusSchema,
  assetTabSchema,
  completeUploadSchema,
  createUploadUrlSchema,
  deleteAssetSchema,
  extensionForContentType,
  getAssetSchema,
  isUploadContentType,
  kindForContentType,
  listAssetsSchema,
  maxUploadBytesForPlan,
  mediaFamilyOf,
  mediaFamilySchema,
  moderationStatusSchema,
  normalizeAssetFilters,
  renameAssetSchema,
  uploadContentTypeSchema,
  uploadableAssetKindSchema,
  variantNameSchema,
} from './asset'
export type {
  AssetFilterValues,
  AssetKind,
  AssetSource,
  AssetStatus,
  AssetTabKey,
  CompleteUploadValues,
  CreateUploadUrlValues,
  ListAssetsValues,
  MediaFamily,
  ModerationStatus,
  RenameAssetValues,
  UploadContentType,
  UploadableAssetKind,
  VariantName,
} from './asset'
export { createOrganizationSchema, updateOrganizationSettingsSchema } from './organization'
export type {
  CreateOrganizationValues,
  UpdateOrganizationSettingsValues,
} from './organization'
export {
  inviteMemberSchema,
  updateMemberSchema,
  removeMemberSchema,
  cancelInvitationSchema,
  resendInvitationSchema,
  createRoleSchema,
  updateRoleSchema,
  deleteRoleSchema,
  roleNameSchema,
  permissionStringSchema,
  RESERVED_ROLE_NAMES,
  VALID_PERMISSION_STRINGS,
} from './team'
export type {
  InviteMemberValues,
  UpdateMemberValues,
  CreateRoleValues,
  UpdateRoleValues,
} from './team'
export {
  billingIntervalSchema,
  planKeySchema,
  createSubscriptionSchema,
  upgradeSubscriptionSchema,
  paymentMethodIdSchema,
  isPurchasablePlan,
} from './billing'
export type {
  CreateSubscriptionValues,
  UpgradeSubscriptionValues,
  PurchasablePlanKey,
  PlanPrice,
  AvailablePlan,
} from './billing'
